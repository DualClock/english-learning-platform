#!/usr/bin/env python3
"""Генератор офлайн-пака озвучки слов нейроголосами Microsoft Edge.

Зачем офлайн: серверный Edge-TTS — неофициальный WebSocket-протокол с меняющимся
антибот-токеном (Sec-MS-GEC), а на боевом VPS 1 ядро и <400 МБ свободной памяти.
Генерируем файлы один раз на машине разработчика, кладём на сервер — клик по слову
становится мгновенным, не тратит квоту Gemini и не зависит от провайдера.

Формат файла — общий с бэкендом (SpeechService.GetPackKey / FindPackFile):
    <sha256("pack|" + слово в нижнем регистре, пробелы схлопнуты)>.mp3

Ключ в паке всегда строится из нижнего регистра, потому что сервер ищет слово
дважды: как есть («Alice» из книги) и в нижнем регистре («alice» из словаря),
и второй кандидат попадает в тот же файл.

Использование:
    pip install edge-tts
    # прикидка объёма без сети и без записи файлов
    python tools/tts-pack/generate.py --words Data/Seed/wordlists.json --out uploads/tts-pack --dry-run
    # пилот: первые 30 слов (rank 1–30)
    python tools/tts-pack/generate.py --words Data/Seed/wordlists.json --out uploads/tts-pack --limit 30
    # полный прогон (останавливать/перезапускать можно в любой момент)
    python tools/tts-pack/generate.py --words Data/Seed/wordlists.json --out uploads/tts-pack

--words принимает и txt (по слову в строке), и Data/Seed/wordlists.json напрямую.

Список слов выгружается с прода:
    select lower(trim("Text")) from "WordLevels" order by 1
"""
import argparse
import asyncio
import hashlib
import json
import sys
import time
from pathlib import Path
from types import ModuleType

# edge-tts нужен только для записи файлов: --dry-run считает по сиду и
# работает в окружении без установленных зависимостей.
edge_tts: ModuleType | None
try:
    import edge_tts
except ImportError:
    edge_tts = None

MIN_BYTES = 1024
MIN_DURATION_S = 0.3
# за этими рамками файл считается битым, а не «просто коротким»
MAX_BYTES = 512 * 1024
MAX_DURATION_S = 30.0

# кГц -> кбит/с. Поток Edge отдаёт 24 кГц моно 48 кбит/с — это же тариф Azure
# audio-24khz-48kbitrate-mono-mp3, на него опирается оценка объёма в --dry-run.
BITRATE_KBPS = {16000: 32, 22050: 32, 24000: 48, 44100: 128, 48000: 128}
DEFAULT_BITRATE_KBPS = 48
# темп AriaNeural при rate=-10%: ~15 символов в секунду (замер по паку)
CHARS_PER_SECOND = 15.0


def normalize_word(word: str) -> str:
    """Та же нормализация, что NormalizeText в SpeechService: пробелы схлопнуты."""
    return " ".join(word.strip().split()).lower()


def pack_name(word: str) -> str:
    normalized = normalize_word(word)
    return hashlib.sha256(f"pack|{normalized}".encode("utf-8")).hexdigest() + ".mp3"


def load_words(path: Path) -> list[str]:
    """Слова из txt (по одному в строке) или из сида wordlists.json.

    Поддерживаются обе формы JSON: {wordLevels: [{text, cefr, rank}]} и просто
    массив строк. Порядок сида сохраняется (rank идёт по возрастанию), дубли
    после нормализации выбрасываются: два слова с одним ключом — один файл.
    """
    raw = path.read_text(encoding="utf-8-sig")

    words: list[str] = []
    stripped = raw.lstrip()
    if stripped.startswith("{") or stripped.startswith("["):
        data = json.loads(stripped)
        if isinstance(data, dict):
            entries = data.get("wordLevels") or data.get("wordlevels") or []
        else:
            entries = data
        for entry in entries:
            if isinstance(entry, str):
                words.append(entry)
            elif isinstance(entry, dict):
                text = entry.get("text") or entry.get("Text")
                if isinstance(text, str):
                    words.append(text)
    else:
        words = raw.splitlines()

    seen: set[str] = set()
    unique: list[str] = []
    for word in words:
        normalized = normalize_word(word)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        unique.append(normalized)
    return unique


# --- разбор MP3 -----------------------------------------------------------
# Длительность нужна настоящая, а не по размеру файла: если Edge вернул
# HTML-заглушку или оборванный поток, размер может быть «нормальным», а звука
# — ноль. Читаем заголовки кадров, без внешних зависимостей.

_MP3_BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
_MP3_BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
_MP3_RATES = {3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000]}


def _id3_size(data: bytes) -> int:
    if len(data) >= 10 and data[:3] == b"ID3":
        size = (data[6] << 21) | (data[7] << 14) | (data[8] << 7) | data[9]
        return 10 + size
    return 0


def _frame(data: bytes, offset: int):
    """(длина кадра, длительность кадра) или None, если заголовок не кадр MP3."""
    if offset + 4 > len(data):
        return None
    b1, b2 = data[offset + 1], data[offset + 2]
    if data[offset] != 0xFF or (b1 & 0xE0) != 0xE0:
        return None

    version_bits = (b1 >> 3) & 0x03   # 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
    layer_bits = (b1 >> 1) & 0x03     # 1 = Layer III
    bitrate_index = (b2 >> 4) & 0x0F
    rate_index = (b2 >> 2) & 0x03
    padding = (b2 >> 1) & 0x01

    if layer_bits != 1 or bitrate_index in (0, 15) or rate_index == 3:
        return None
    if version_bits not in (3, 2, 0):
        return None

    table = _MP3_BITRATES_V1_L3 if version_bits == 3 else _MP3_BITRATES_V2_L3
    bitrate = table[bitrate_index] * 1000
    sample_rate = _MP3_RATES[version_bits][rate_index]
    samples = 1152 if version_bits == 3 else 576

    length = int(samples / 8 * bitrate / sample_rate) + padding
    return length, samples / sample_rate


def mp3_duration(data: bytes) -> float:
    """Суммарная длительность найденных кадров; 0.0 — если кадров нет."""
    offset = _id3_size(data)
    total = 0.0
    frames = 0

    while offset < len(data):
        parsed = _frame(data, offset)
        if parsed is None:
            break
        length, seconds = parsed
        total += seconds
        frames += 1
        offset += length

    # Единичный кадр на 24 кГц — это ~24 мс: битый файл, а не слово
    return 0.0 if frames < 2 else total


def file_duration(path: Path) -> float:
    return mp3_duration(path.read_bytes())


def validate(path: Path) -> tuple[bool, str]:
    """(годен, причина отказа). Именно это мешает положить в пак нули."""
    if not path.exists():
        return False, "файл не создан"

    size = path.stat().st_size
    if size < MIN_BYTES:
        return False, f"размер {size} Б < {MIN_BYTES} Б"
    if size > MAX_BYTES:
        return False, f"размер {size} Б > {MAX_BYTES} Б"

    duration = file_duration(path)
    if duration < MIN_DURATION_S:
        return False, f"длительность {duration:.2f} c < {MIN_DURATION_S} c"
    if duration > MAX_DURATION_S:
        return False, f"длительность {duration:.2f} c > {MAX_DURATION_S} c (не слово?)"

    return True, f"{size} Б, {duration:.2f} c"


def is_present(path: Path) -> bool:
    """«Уже есть» — только если файл прошёл валидацию. Иначе его перезапишем."""
    return validate(path)[0]


class Progress:
    """Прогресс со скоростью и ETA: полный прогон идёт десятки минут."""

    def __init__(self, total: int):
        self.total = total
        self.finished = 0
        self.started = time.monotonic()

    def step(self, word: str, ok: bool, detail: str) -> None:
        self.finished += 1
        if not ok:
            print(f"БРАК {word!r}: {detail}", file=sys.stderr, flush=True)

        # На 4500 слов строка на каждый файл — шум, поэтому раз в 25 и в конце.
        # Ошибки печатаются сразу и всегда.
        if self.finished % 25 == 0 or self.finished == self.total:
            elapsed = time.monotonic() - self.started
            per_item = elapsed / max(1, self.finished)
            left = per_item * (self.total - self.finished)
            speed = 1 / per_item if per_item > 0 else 0.0
            print(
                f"[{self.finished}/{self.total}] {self.finished / max(1, self.total):5.1%} "
                f"{speed:5.1f} слов/с, осталось ~{left:4.0f} с",
                flush=True,
            )


async def render(
    word: str,
    out_dir: Path,
    voice: str,
    rate: str,
    sem: asyncio.Semaphore,
    stats: dict,
    progress: Progress,
) -> None:
    target = out_dir / pack_name(word)

    if is_present(target):
        stats["skipped"] += 1
        progress.step(word, True, "уже есть")
        return

    # Огрызок от прерванного прогона убираем: иначе он навсегда остался бы
    # «существующим» для следующих запусков.
    target.unlink(missing_ok=True)

    async with sem:
        try:
            communicate = edge_tts.Communicate(word, voice, rate=rate)
            audio = bytearray()
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    audio.extend(chunk["data"])

            # Пишем через .tmp и проверяем ДО переименования: Ctrl+C посреди
            # прогона не оставит в паке половину файла. Склейка строкой, а не
            # with_suffix: у имени из hex-точек with_suffix меняет не то расширение.
            temp = target.with_name(target.name + ".tmp")
            temp.write_bytes(bytes(audio))
            ok, detail = validate(temp)
            if not ok:
                temp.unlink(missing_ok=True)
                stats["failed"] += 1
                progress.step(word, False, detail)
                return

            temp.replace(target)
            stats["done"] += 1
            progress.step(word, True, detail)
        except Exception as exc:  # сеть/лимиты Microsoft — не роняем весь прогон
            stats["failed"] += 1
            progress.step(word, False, f"{type(exc).__name__} {exc}")
            await asyncio.sleep(2)


async def main() -> int:
    parser = argparse.ArgumentParser(description="Пак озвучки слов (Edge-TTS)")
    parser.add_argument("--words", required=True, help="txt со словами или wordlists.json")
    parser.add_argument("--out", required=True, help="каталог для mp3")
    parser.add_argument("--voice", default="en-US-AriaNeural")
    parser.add_argument("--rate", default="-10%", help="медленнее обычного: слова учат")
    parser.add_argument("--concurrency", type=int, default=8)
    parser.add_argument("--limit", type=int, default=0, help="только первые N слов (пилот)")
    parser.add_argument("--dry-run", action="store_true", help="только посчитать, без сети")
    args = parser.parse_args()

    words_path = Path(args.words)
    if not words_path.exists():
        print(f"нет файла слов: {words_path}", file=sys.stderr)
        return 2

    words = load_words(words_path)
    if args.limit and args.limit > 0:
        words = words[: args.limit]

    out_dir = Path(args.out)
    valid = [w for w in words if is_present(out_dir / pack_name(w))]
    valid_set = set(valid)
    pending = [w for w in words if w not in valid_set]
    broken = [w for w in pending if (out_dir / pack_name(w)).exists()]

    if args.dry_run:
        est_chars = sum(len(w) for w in pending)
        est_seconds = est_chars / CHARS_PER_SECOND
        est_bytes = est_seconds * DEFAULT_BITRATE_KBPS * 1000 / 8
        print(f"слов в списке:   {len(words)}")
        print(f"уже в паке:      {len(valid)}")
        print(f"надо озвучить:   {len(pending)}")
        print(f"огрызков в паке: {len(broken)} (будут перезаписаны)")
        print(f"каталог:         {out_dir}")
        print(
            f"оценка:          ~{est_bytes / 1024 / 1024:.1f} МиБ, "
            f"~{est_seconds / 60:.1f} мин аудио, голос {args.voice} {args.rate}"
        )
        return 0

    if edge_tts is None:
        print("не установлен edge-tts: pip install edge-tts", file=sys.stderr)
        return 2

    out_dir.mkdir(parents=True, exist_ok=True)

    sem = asyncio.Semaphore(max(1, args.concurrency))
    stats = {"done": 0, "skipped": 0, "failed": 0}
    progress = Progress(len(words))

    print(
        f"слов: {len(words)}, уже готовы: {len(valid)}, "
        f"голос: {args.voice} {args.rate}, каталог: {out_dir}",
        flush=True,
    )

    await asyncio.gather(
        *(render(w, out_dir, args.voice, args.rate, sem, stats, progress) for w in words)
    )

    print(
        f"итог: записано {stats['done']}, уже было {stats['skipped']}, брак {stats['failed']}",
        flush=True,
    )
    return 0 if stats["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
