"""Нормализация иллюстрации карточки: обрезка фона → квадрат с полями → 512×512 WebP.

Usage:
    python prepare_card.py <in.png> <out.webp> [--size 512] [--pad 0.10]
"""
import argparse
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter


def border_color(img: Image.Image) -> tuple[int, int, int]:
    """Цвет фона = медиана пикселей по периметру (фон бывает и белым, и бумажным)."""
    w, h = img.size
    px = img.convert("RGB").load()
    samples = []
    step = max(1, w // 40)
    for x in range(0, w, step):
        samples.append(px[x, 1])
        samples.append(px[x, h - 2])
    for y in range(0, h, step):
        samples.append(px[1, y])
        samples.append(px[w - 2, y])
    chans = list(zip(*samples))
    return tuple(sorted(c)[len(c) // 2] for c in chans)  # type: ignore[return-value]


def trim(img: Image.Image, tolerance: int = 26) -> Image.Image:
    bg = Image.new("RGB", img.size, border_color(img))
    diff = ImageChops.difference(img.convert("RGB"), bg).convert("L")
    diff = diff.filter(ImageFilter.MedianFilter(3))
    mask = diff.point(lambda p: 255 if p > tolerance else 0)
    bbox = mask.getbbox()
    if not bbox:
        return img
    return img.crop(bbox)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--size", type=int, default=512)
    ap.add_argument(
        "--fill",
        type=float,
        default=0.78,
        help="какую долю кадра занимает объект по длинной стороне: одинаково для всего набора",
    )
    ap.add_argument(
        "--bg",
        default="auto",
        help="цвет подложки: auto — взять цвет фона самой картинки (иначе на стыке видна рамка)",
    )
    ap.add_argument(
        "--drop-corner",
        type=float,
        default=0.07,
        help="срезать долю справа и снизу до обрезки: там генератор ставит водяной знак",
    )
    args = ap.parse_args()

    img = Image.open(args.src).convert("RGB")
    if args.drop_corner > 0:
        # Знак генератора стоит в правом нижнем углу и попадает в bbox как
        # «контент» — тогда объект перестаёт быть центрированным. Срезаем угол
        # до обрезки; объект центрирован, поэтому его это не задевает.
        w0, h0 = img.size
        img = img.crop((0, 0, int(w0 * (1 - args.drop_corner)), int(h0 * (1 - args.drop_corner))))
    subject = trim(img)
    w, h = subject.size

    bg = border_color(img) if args.bg == "auto" else args.bg
    # Масштаб нормируется по ДОЛЕ кадра, а не по отступам от объекта: генератор
    # рисует одни сцены крупно, другие мелко, и при пропорциональных полях
    # тарелка с оливками оказывалась вдвое меньше пирога. Один и тот же --fill
    # выравнивает набор.
    side = int(round(max(w, h) / args.fill))
    canvas = Image.new("RGB", (side, side), bg)
    canvas.paste(subject, ((side - w) // 2, (side - h) // 2))

    out = canvas.resize((args.size, args.size), Image.LANCZOS)
    dst = Path(args.dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    out.save(dst, "WEBP", quality=88, method=6)

    print(f"{dst}  {out.size[0]}x{out.size[1]}  {dst.stat().st_size // 1024} KB  "
          f"(trim {img.size}->{subject.size})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
