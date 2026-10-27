"""Обзорный лист всего набора: 26 категорий × 20 слов.

Usage:
    python overview_sheet.py
"""
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[3]
CELL, GAP, LABEL_W = 44, 2, 132


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    for name in (("arialbd.ttf" if bold else "arial.ttf"), "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def main() -> None:
    spec = json.loads((ROOT / "docs/word-illustrations/art-direction.json").read_text(encoding="utf-8"))
    base = ROOT / "frontend/public/words"
    cols = 20
    rows = len(spec["categories"])

    W = LABEL_W + cols * (CELL + GAP) + 12
    H = 56 + rows * (CELL + GAP) + 12
    sheet = Image.new("RGB", (W, H), "#FBF6EA")
    d = ImageDraw.Draw(sheet)
    d.text((12, 14), "Lexicon · 520 иллюстраций слов · стиль B (без контура)",
           fill="#17314C", font=font(16, True))

    total = 0
    for r, cat in enumerate(spec["categories"]):
        y = 48 + r * (CELL + GAP)
        d.text((12, y + CELL // 2 - 7), f"{cat['slug']}  {len(cat['words'])}", fill="#5D6470", font=font(11))
        for c, w in enumerate(cat["words"]):
            p = base / cat["slug"] / f"{w['slug']}.webp"
            x = LABEL_W + c * (CELL + GAP)
            if not p.exists():
                d.rectangle([x, y, x + CELL, y + CELL], fill="#FDE0EC")
                continue
            sheet.paste(Image.open(p).convert("RGB").resize((CELL, CELL), Image.LANCZOS), (x, y))
            total += 1

    out = ROOT / "docs/word-illustrations/overview-all.png"
    sheet.save(out)
    print(f"{out}  {total} картинок, {cols}x{rows}")


if __name__ == "__main__":
    main()
