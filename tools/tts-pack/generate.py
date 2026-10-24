#!/usr/bin/env python3
"""Генератор офлайн-пака озвучки слов нейроголосами Microsoft Edge.

Зачем офлайн: серверный Edge-TTS — неофициальный WebSocket-протокол с меняющимся
антибот-токеном (Sec-MS-GEC), а на боевом VPS 1 ядро и <400 МБ свободной памяти.
Генерируем файлы один раз на машине разработчика, кладём на сервер — клик по слову
становится мгновенным, не тратит квоту Gemini и не зависит от провайдера.

Формат файла — общий с бэкендом (SpeechService.GetPackKey):
    <sha256("pack|" + слово в нижнем регистре)>.mp3

Использование:
    pip install edge-tts
    python tools/tts-pack/generate.py --words words.txt --out uploads/tts-pack \
        --voice en-US-AriaNeural --concurrency 8

Список слов выгружается с прода:
    select lower(trim("Text")) from "WordLevels" order by 1
"""
import argparse
import asyncio
import hashlib
import sys
from pathlib import Path

import edge_tts


def pack_name(word: str) -> str:
    normalized = " ".join(word.strip().split()).lower()
    return hashlib.sha256(f"pack|{normalized}".encode("utf-8")).hexdigest() + ".mp3"


async def render(word: str, out_dir: Path, voice: str, rate: str, sem: asyncio.Semaphore, stats: dict):
    word = word.strip()
    if not word:
        return
    target = out_dir / pack_name(word)
    if target.exists() and target.stat().st_size > 1024:
        stats["skipped"] += 1
        return

    async with sem:
        try:
            communicate = edge_tts.Communicate(word, voice, rate=rate)
            audio = bytearray()
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    audio.extend(chunk["data"])
            if len(audio) < 1024:
                stats["failed"] += 1
                print(f"ПУСТО {word!r}", file=sys.stderr)
                return
            target.write_bytes(audio)
            stats["done"] += 1
            if stats["done"] % 100 == 0:
                print(f"готово {stats['done']}, пропущено {stats['skipped']}, ошибок {stats['failed']}", flush=True)
        except Exception as exc:  # сеть/лимиты Microsoft — не роняем весь прогон
            stats["failed"] += 1
            print(f"ОШИБКА {word!r}: {type(exc).__name__} {exc}", file=sys.stderr)
            await asyncio.sleep(2)


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--words", required=True, help="файл со словами, по одному в строке")
    parser.add_argument("--out", required=True, help="каталог для mp3")
    parser.add_argument("--voice", default="en-US-AriaNeural")
    parser.add_argument("--rate", default="-10%", help="медленнее обычного: слова учат")
    parser.add_argument("--concurrency", type=int, default=8)
    args = parser.parse_args()

    words = [line for line in Path(args.words).read_text(encoding="utf-8").splitlines() if line.strip()]
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    sem = asyncio.Semaphore(max(1, args.concurrency))
    stats = {"done": 0, "skipped": 0, "failed": 0}

    print(f"слов: {len(words)}, голос: {args.voice}, каталог: {out_dir}", flush=True)
    await asyncio.gather(*(render(w, out_dir, args.voice, args.rate, sem, stats) for w in words))

    print(f"итог: записано {stats['done']}, уже было {stats['skipped']}, ошибок {stats['failed']}", flush=True)
    return 0 if stats["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
