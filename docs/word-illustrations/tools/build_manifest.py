"""Собирает манифест наличных иллюстраций: frontend/src/lib/wordIllustrations.generated.ts

Usage:
    python build_manifest.py [--root <repo>]
"""
import argparse
import datetime
from pathlib import Path

HEADER = """// СГЕНЕРИРОВАНО docs/word-illustrations/tools/build_manifest.py — не править руками.
// Обновить: python docs/word-illustrations/tools/build_manifest.py
//
// Ключ — "<category-slug>/<word-slug>". Компонент WordIllustration проверяет
// наличие ключа и рендерит картинку только если файл реально существует,
// иначе остаётся текстовый вид карточки (без битых картинок и 404 в консоли).

export const ILLUSTRATED_AT = '__STAMP__';

const ILLUSTRATED: ReadonlySet<string> = new Set([
__KEYS__]);

export function hasIllustration(categorySlug: string, word: string): boolean {
  return ILLUSTRATED.has(`${categorySlug}/${slugifyWord(word)}`);
}

export function illustrationSrc(categorySlug: string, word: string): string {
  return `/words/${categorySlug}/${slugifyWord(word)}.webp`;
}

/** Должно совпадать с правилом имени файла в docs/word-illustrations/PLAN.md. */
export function slugifyWord(word: string): string {
  return word
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\\u0300-\\u036f]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const ILLUSTRATION_COUNT = __COUNT__;
"""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=str(Path(__file__).resolve().parents[3]))
    args = ap.parse_args()
    root = Path(args.root)

    words_dir = root / "frontend" / "public" / "words"
    out = root / "frontend" / "src" / "lib" / "wordIllustrations.generated.ts"

    keys: list[str] = []
    if words_dir.is_dir():
        for f in sorted(words_dir.rglob("*.webp")):
            rel = f.relative_to(words_dir).with_suffix("")
            parts = rel.parts
            if len(parts) == 2:
                keys.append(f"{parts[0]}/{parts[1]}")

    body = "\n".join(f"  '{k}'," for k in keys)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
    # Подстановка через replace, а не str.format: в шаблоне есть ${...} и
    # регулярки с фигурными скобками, которые format принял бы за поля.
    text = (
        HEADER.replace("__KEYS__", body)
        .replace("__STAMP__", stamp)
        .replace("__COUNT__", str(len(keys)))
    )
    out.write_text(text, encoding="utf-8")
    print(f"{out.relative_to(root)}: {len(keys)} иллюстраций")


if __name__ == "__main__":
    main()
