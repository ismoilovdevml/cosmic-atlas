#!/usr/bin/env python3
"""Progressive-loading variants of the Gaia all-sky image (web/public/sky/).

  <name>_lo.jpg   small preview (default 1440x720, JPEG q80, progressive, ~200 KB), shown first
  <name>.webp     the full image as WebP (q90), loaded after the layer metas and catalogues;
                  the original JPEG stays as the fallback for browsers that cannot decode WebP

The source JPEG is the master (it is not regenerated here), so the WebP is a re-encode: the
script prints its PSNR against the JPEG. Measured 2026-11-14: 2985 KB, 40.7 dB.

usage: .venv/bin/python -I scripts/make_sky_variants.py [web/public/sky/gaia_dr3_sky_l9.jpg] [--width 1440]
"""
import argparse
import io
from pathlib import Path

import numpy as np
from PIL import Image


def psnr(a: Image.Image, b: Image.Image) -> float:
    x = np.asarray(a.convert('RGB'), dtype=np.float32)
    y = np.asarray(b.convert('RGB'), dtype=np.float32)
    mse = float(((x - y) ** 2).mean())
    return float('inf') if mse == 0 else 10 * np.log10(255 ** 2 / mse)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('src', nargs='?', default='web/public/sky/gaia_dr3_sky_l9.jpg')
    ap.add_argument('--width', type=int, default=1440)
    ap.add_argument('--webp-quality', type=int, default=90)
    a = ap.parse_args()
    src = Path(a.src)
    im = Image.open(src).convert('RGB')
    w, h = im.size
    if w != 2 * h:
        raise SystemExit(f'{src}: expected a 2:1 Hammer-Aitoff image, got {w}x{h}')

    lo = im.resize((a.width, a.width // 2), Image.LANCZOS)
    lo_path = src.with_name(src.stem + '_lo.jpg')
    lo.save(lo_path, 'JPEG', quality=80, optimize=True, progressive=True)

    webp_path = src.with_suffix('.webp')
    buf = io.BytesIO()
    im.save(buf, 'WEBP', quality=a.webp_quality, method=6)
    webp_path.write_bytes(buf.getvalue())

    print(f'{src}: {w}x{h}, {src.stat().st_size / 1024:.0f} KB')
    print(f'{lo_path}: {lo.size[0]}x{lo.size[1]}, {lo_path.stat().st_size / 1024:.0f} KB')
    print(f'{webp_path}: {webp_path.stat().st_size / 1024:.0f} KB, PSNR vs JPEG {psnr(im, Image.open(webp_path)):.1f} dB')


if __name__ == '__main__':
    main()
