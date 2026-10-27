"""Контактный лист категории для приёмки: сетка 5×4 с подписями.

Usage:
    python contact_sheet.py <category-slug> [--root <repo>] [--out <png>]
"""
import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

CELL, PAD, LABEL = 220, 12, 26
COLS = 5


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("category")
    ap.add_argument("--root", default=str(Path(__file__).resolve().parents[3]))
    ap.add_argument("--out")
    args = ap.parse_args()

    root = Path(args.root)
    src = root / "frontend" / "public" / "words" / args.category
    files = sorted(src.glob("*.webp")) if src.is_dir() else []
    if not files:
        print(f"нет картинок в {src}")
        return

    rows = (len(files) + COLS - 1) // COLS
    W = COLS * (CELL + PAD) + PAD
    H = rows * (CELL + LABEL + PAD) + PAD
    sheet = Image.new("RGB", (W, H), "#FBF6EA")
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("arial.ttf", 14)
    except OSError:
        font = ImageFont.load_default()

    for i, f in enumerate(files):
        x = PAD + (i % COLS) * (CELL + PAD)
        y = PAD + (i // COLS) * (CELL + LABEL + PAD)
        im = Image.open(f).convert("RGB").resize((CELL, CELL), Image.LANCZOS)
        sheet.paste(im, (x, y))
        draw.rectangle([x, y, x + CELL - 1, y + CELL - 1], outline="#E5E7EB")
        draw.text((x + 4, y + CELL + 5), f.stem, fill="#17314C", font=font)

    out = Path(args.out) if args.out else root / "docs" / "word-illustrations" / f"sheet-{args.category}.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out)
    print(f"{out}  {len(files)} шт.")


if __name__ == "__main__":
    main()
