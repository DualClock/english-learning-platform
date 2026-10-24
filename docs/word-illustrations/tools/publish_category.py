"""Публикация категории: raw/<cat>/<word>/<word>.png → frontend/public/words/<cat>/<word>.webp

Usage:
    python publish_category.py food [--force]

Почему папка на слово, а не файл на слово: генератор называет файлы по секунде,
и при параллельных вызовах они затирают друг друга. Отдельный output_dir на
каждое слово — единственная надёжная защита.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("category")
    ap.add_argument("--force", action="store_true", help="перезаписать существующие .webp")
    args = ap.parse_args()

    spec = json.loads((ROOT / "docs/word-illustrations/art-direction.json").read_text(encoding="utf-8"))
    cat = next((c for c in spec["categories"] if c["slug"] == args.category), None)
    if cat is None:
        print(f"нет категории {args.category}")
        return 1

    raw = ROOT / "docs/word-illustrations/raw" / args.category
    out_dir = ROOT / "frontend/public/words" / args.category
    py = sys.executable

    done, missing, skipped = [], [], []
    for w in cat["words"]:
        slug = w["slug"]
        src_dir = raw / slug
        png = next(iter(sorted(src_dir.glob("*.png"))), None) if src_dir.is_dir() else None
        if png is None:
            missing.append(slug)
            continue
        dst = out_dir / f"{slug}.webp"
        if dst.exists() and not args.force:
            skipped.append(slug)
            continue
        r = subprocess.run([py, str(HERE / "prepare_card.py"), str(png), str(dst)],
                           capture_output=True, text=True)
        if r.returncode != 0:
            print(f"  ! {slug}: {r.stderr.strip()[:200]}")
            continue
        done.append(slug)
        print("  " + r.stdout.strip())

    print(f"\n{args.category}: готово {len(done)}, пропущено {len(skipped)}, нет исходника {len(missing)}")
    if missing:
        print("не хватает: " + ", ".join(missing))
    return 0


if __name__ == "__main__":
    sys.exit(main())
