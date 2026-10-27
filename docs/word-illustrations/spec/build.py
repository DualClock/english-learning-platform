"""Собирает docs/word-illustrations/art-direction.json из ручных сцен.

Сцены лежат в scenes_01..06.py (по 4-6 категорий), здесь только сборка и
жёсткая проверка спеки. Запуск:
    python docs/word-illustrations/spec/build.py
"""
import importlib
import json
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
SRC = ROOT / "EnglishLearningPlatform.API" / "Data" / "Seed" / "categories.json"
OUT = ROOT / "docs" / "word-illustrations" / "art-direction.json"

TYPES = {"object", "action", "abstract", "trait", "place", "relation"}
# Стиль задаётся шаблоном промпта, в сцене этих слов быть не должно.
BANNED = [
    "beautiful", "stylized", "styled", "cute", "kawaii", "cartoon", "illustration",
    "aesthetic", "artistic", "pretty", "nice", "lovely", "charming", "adorable",
    "vibrant", "colorful", "colourful", "masterpiece", "detailed", "high quality",
]
MIN_W, MAX_W = 8, 16


def slugify(word: str) -> str:
    """Правило из tools/build_manifest.py — должно совпадать с именами файлов."""
    s = unicodedata.normalize("NFD", word.lower())
    s = re.sub(r"[\u0300-\u036f]", "", s)
    s = re.sub(r"['’]", "", s)
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return re.sub(r"^-+|-+$", "", s)


def load_scenes() -> dict[str, dict[str, tuple[str, str]]]:
    merged: dict[str, dict[str, tuple[str, str]]] = {}
    for i in range(1, 7):
        mod = importlib.import_module(f"scenes_{i:02d}")
        for cat, words in mod.DATA.items():
            if cat in merged:
                sys.exit(f"категория {cat} описана дважды")
            merged[cat] = words
    return merged


def main() -> None:
    data = json.loads(SRC.read_text(encoding="utf-8"))
    scenes = load_scenes()
    errors: list[str] = []
    out_cats = []
    type_counter: Counter[str] = Counter()
    all_scenes: dict[str, str] = {}

    src_slugs = [c["slug"] for c in data["categories"]]
    extra_cats = set(scenes) - set(src_slugs)
    if extra_cats:
        errors.append(f"лишние категории в спеке: {sorted(extra_cats)}")

    for cat in data["categories"]:
        cslug = cat["slug"]
        spec = scenes.get(cslug, {})
        src_words = [w["english"] for w in cat["words"]]
        missing = [w for w in src_words if w not in spec]
        extra = [w for w in spec if w not in src_words]
        if missing:
            errors.append(f"{cslug}: нет сцен для {missing}")
        if extra:
            errors.append(f"{cslug}: слова не из JSON — {extra}")

        seen: dict[str, str] = {}
        words_out = []
        for w in cat["words"]:
            eng = w["english"]
            if eng not in spec:
                continue
            wtype, scene = spec[eng]
            if wtype not in TYPES:
                errors.append(f"{cslug}/{eng}: тип {wtype!r}")
            n = len(scene.split())
            if not MIN_W <= n <= MAX_W:
                errors.append(f"{cslug}/{eng}: {n} слов в сцене (нужно {MIN_W}-{MAX_W})")
            low = scene.lower()
            for bad in BANNED:
                if re.search(rf"\b{bad}\b", low):
                    errors.append(f"{cslug}/{eng}: запрещённое слово {bad!r} в сцене")
            if re.search(r"\d", scene):
                errors.append(f"{cslug}/{eng}: цифра в сцене")
            if re.search(r"\b(text|letters?|words?|numbers?|inscription|caption)\b", low):
                errors.append(f"{cslug}/{eng}: упоминание текста в сцене")
            if not scene[0].islower():
                errors.append(f"{cslug}/{eng}: сцена с заглавной буквы")
            if scene.endswith("."):
                errors.append(f"{cslug}/{eng}: точка в конце сцены")
            if scene in all_scenes:
                errors.append(f"{cslug}/{eng}: сцена дублирует {all_scenes[scene]}")
            all_scenes[scene] = f"{cslug}/{eng}"
            sl = slugify(eng)
            if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", sl):
                errors.append(f"{cslug}/{eng}: плохой slug {sl!r}")
            if sl in seen:
                errors.append(f"{cslug}: slug {sl!r} совпал у {seen[sl]!r} и {eng!r}")
            seen[sl] = eng
            type_counter[wtype] += 1
            words_out.append(
                {"english": eng, "slug": sl, "type": wtype, "scene": scene}
            )

        out_cats.append({"slug": cslug, "name": cat["name"], "words": words_out})

    if errors:
        print(f"ОШИБОК: {len(errors)}")
        for e in errors:
            print(" -", e)
        sys.exit(1)

    payload = {"categories": out_cats}
    OUT.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    total = sum(len(c["words"]) for c in out_cats)
    print(f"{OUT.relative_to(ROOT)}: {total} слов\n")
    print(f"{'категория':<16}{'слов':>6}{'исходник':>10}")
    for c, src in zip(out_cats, data["categories"]):
        mark = "ok" if len(c["words"]) == len(src["words"]) else "MISMATCH"
        print(f"{c['slug']:<16}{len(c['words']):>6}{len(src['words']):>10}  {mark}")
    print(f"\nвсего {total}, категорий {len(out_cats)}")
    print("типы:", ", ".join(f"{k}={v}" for k, v in sorted(type_counter.items())))
    print(f"уникальных сцен: {len(all_scenes)}")


if __name__ == "__main__":
    main()
