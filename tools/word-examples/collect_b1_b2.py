"""
Сбор примеров к словам B1/B2 из Tatoeba.

Зачем: у слов A1/A2 примеры есть (1423 пары), у B1/B2 — ноль на 3000 слов.
Карточка слова без примера учит переводу, а не употреблению: человек видит
«peak — вершина» и не знает, что слово живёт в «at its peak», «peak hours».

Откуда примеры: Tatoeba (CC BY 2.0 FR) — краудсорсинговый корпус с русскими
переводами. Выбор пал на него, потому что:
  * лицензия позволяет использовать в продукте;
  * есть готовые пары en→ru, а не только английский;
  * предложения короткие и бытовые, а не литературные.

Почему не LLM: B1/B2 — 3000 слов, Gemini на таком объёме выжег бы бюджет
проекта. Tatoeba бесплатна и не требует ключей.

Ограничения (честно):
  * Tatoeba — предложения реальных людей, а не учебный корпус. Иногда они
    странноватые. Поэтому берётся КОРОТКОЕ предложение с переводом и
    проверяется, что слово в нём встречается как отдельный токен.
  * Покрытие неполное: редких слов вроде «interracial» в корпусе может не
    быть вовсе. Отсутствие примера честнее выдуманного.

Запуск:
    python tools/word-examples/collect_b1_b2.py            # собрать
    python tools/word-examples/collect_b1_b2.py --dry-run  # посчитать без записи
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SEED = REPO / "EnglishLearningPlatform.API" / "Data" / "Seed"
WORDLISTS = SEED / "wordlists.json"
EXAMPLES = SEED / "word-examples.json"

API = "https://tatoeba.org/en/api_v0/search"

# Сколько предложений просить за раз. Больше 10 не отдаёт и с limit.
PER_PAGE = 10

# Пауза между запросами: Tatoeba — волонтёрский сервис, стучать очередью
# 3000 запросов без паузы некрасиво и приведёт к блокировке.
DELAY_SECONDS = 0.35

# Слово должно быть отдельным токеном, а не частью другого: «ink» не должен
# находиться внутри «thinking».
WORD_RE_CACHE: dict[str, re.Pattern[str]] = {}


def word_pattern(word: str) -> re.Pattern[str]:
    if word not in WORD_RE_CACHE:
        WORD_RE_CACHE[word] = re.compile(
            rf"(?<![A-Za-z]){re.escape(word)}(?![A-Za-z])", re.IGNORECASE
        )
    return WORD_RE_CACHE[word]


def is_real_word(word: str) -> bool:
    """Отсеивает мусор справочника: сокращения, домены, аббревиатуры.

    В wordlists.json рядом с настоящими словами живут `prev`, `ads`, `tn`,
    `il` — огрызки парсера. Пример к ним не нужен: учить этому нельзя.
    """
    return bool(re.fullmatch(r"[a-zA-Z][a-zA-Z\-']{2,}", word))


def pick_sentence(word: str, results: list[dict]) -> dict | None:
    """Выбирает лучшую пару «предложение + перевод» для слова.

    Критерии в порядке важности:
      1. слово встречается отдельным токеном (иначе это не пример этого слова);
      2. есть русский перевод (без него пример бесполезен для новичка);
      3. предложение короткое — длинная цитата в карточке не поместится.
    """
    pattern = word_pattern(word)
    best: dict | None = None
    best_score = -1

    for item in results:
        text = (item.get("text") or "").strip()
        if not text or not pattern.search(text):
            continue

        # Имена собственные не годятся: «Mary chuckled.» — это пример имени,
        # а не нарицательного слова «mary». У Tatoeba в предложении есть
        # разметка собственных, но надёжнее правило: слово в начале
        # предложения с заглавной буквы и больше нигде — считаем именем.
        stripped = text.lstrip("\"'«“")
        if stripped.startswith(word[0].upper() + word[1:]) and not pattern.search(stripped[1:]):
            continue

        russian = ""
        for group in item.get("translations") or []:
            for translation in group:
                if translation.get("lang") == "rus":
                    candidate = (translation.get("text") or "").strip()
                    if candidate:
                        russian = candidate
                        break
            if russian:
                break

        if not russian:
            continue

        # Перевод не должен обрываться на середине — в корпусе бывает.
        if russian.endswith(("…", "...")) or not russian.endswith((".", "!", "?", "»", '"', ")", ":")):
            continue

        # 40–120 символов — золотая середина: контекст есть, карточка не ломается.
        length = len(text)
        score = 100 - abs(length - 70)
        if length > 160:
            score -= 200

        if score > best_score:
            best_score = score
            best = {"text": word, "example": text, "exampleRu": russian}

    return best


def fetch(word: str) -> list[dict]:
    query = urllib.parse.urlencode(
        {
            "from": "eng",
            "to": "rus",
            "query": word,
            "orphans": "no",
            "unapproved": "no",
        }
    )
    url = f"{API}?{query}"
    request = urllib.request.Request(url, headers={"User-Agent": "Lexicon/1.0 (education project)"})

    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        print(f"  ! {word}: HTTP {error.code}", file=sys.stderr)
        return []
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
        print(f"  ! {word}: {type(error).__name__}", file=sys.stderr)
        return []

    return payload.get("results") or []


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="посчитать слова без запросов")
    parser.add_argument("--limit", type=int, default=0, help="ограничить число слов (для проб)")
    parser.add_argument("--output", type=Path, default=None, help="куда писать результат")
    args = parser.parse_args()

    words = json.loads(WORDLISTS.read_text(encoding="utf-8"))["wordLevels"]
    existing_rows = json.loads(EXAMPLES.read_text(encoding="utf-8"))
    existing = {row["text"] for row in existing_rows}

    targets = [
        word["text"]
        for word in words
        if word["cefr"] in ("b1", "b2")
        and word["text"] not in existing
        and is_real_word(word["text"])
    ]

    skipped_garbage = sum(
        1
        for word in words
        if word["cefr"] in ("b1", "b2")
        and word["text"] not in existing
        and not is_real_word(word["text"])
    )

    print(f"B1/B2 без примера: {len(targets)}")
    print(f"Отсеяно как не-слова: {skipped_garbage}")

    if args.dry_run:
        print("--dry-run: запросов не делаю")
        return 0

    if args.limit:
        targets = targets[: args.limit]
        print(f"Ограничение --limit: {len(targets)} слов")

    collected: list[dict] = []
    not_found: list[str] = []

    for index, word in enumerate(targets, start=1):
        results = fetch(word)
        pair = pick_sentence(word, results)

        if pair:
            collected.append(pair)
        else:
            not_found.append(word)

        if index % 50 == 0 or index == len(targets):
            print(f"  {index}/{len(targets)}: найдено {len(collected)}, без примера {len(not_found)}")

        time.sleep(DELAY_SECONDS)

    output = args.output or EXAMPLES
    merged = existing_rows + collected
    output.write_text(
        json.dumps(merged, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print()
    print(f"Собрано новых пар: {len(collected)}")
    print(f"Без примера в Tatoeba: {len(not_found)}")
    print(f"Всего в файле: {len(merged)}")
    print(f"Записано: {output}")

    if not_found:
        (output.parent / "word-examples-missing.txt").write_text(
            "\n".join(sorted(not_found)) + "\n", encoding="utf-8"
        )
        print("Слова без примера выписаны в word-examples-missing.txt")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
