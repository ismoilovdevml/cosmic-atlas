"""Measure the black hole captures (figures/bh-*.png) against the formulas.

- Shadow radius: along 720 directions from the screen centre (the hole), the first pixel brighter
  than a threshold; the median radius vs Synge's sin(a) = (sqrt27/2)(r_s/r)sqrt(1 - r_s/r), converted
  to pixels with the capture's projection (vertical fov, 900 CSS px tall, DPR 1).
- Disk brightness asymmetry (Earth views): mean luminance in an annulus as a function of the sky
  position angle (east of north; north/east screen axes printed by capture_blackholes.mjs), its
  peak PA and max/min ratio.
usage: .venv/bin/python -I web/scripts/measure_blackholes.py figures
"""
import math
import sys

import numpy as np
from PIL import Image

D = sys.argv[1] if len(sys.argv) > 1 else '../figures'
H = 900


def lum(path):
    a = np.asarray(Image.open(path).convert('RGB')).astype(float) / 255.0
    lin = np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)
    return lin @ np.array([0.2126, 0.7152, 0.0722])


def synge_px(x, fov_deg=55.0):
    a = math.asin(min(1.0, (math.sqrt(27) / 2) / x * math.sqrt(1 - 1 / x)))
    return math.tan(a) * (H / 2) / math.tan(math.radians(fov_deg / 2)), math.degrees(a)


def shadow_radius(L, thr, cx=720, cy=450, rmax=440):
    rs = []
    for k in range(720):
        t = 2 * math.pi * k / 720
        for r in np.arange(1, rmax, 0.25):
            x = int(round(cx + r * math.cos(t)))
            y = int(round(cy + r * math.sin(t)))
            if x < 0 or y < 0 or x >= L.shape[1] or y >= L.shape[0]:
                break
            if L[y, x] > thr:
                rs.append(r)
                break
    rs = np.array(rs)
    return float(np.median(rs)), float(np.percentile(rs, 5)), float(np.percentile(rs, 95)), len(rs)


def pa_profile(L, north, east, r0, r1, cx=720, cy=450):
    yy, xx = np.mgrid[0:L.shape[0], 0:L.shape[1]]
    dx = xx - cx
    dy = yy - cy
    r = np.hypot(dx, dy)
    m = (r >= r0) & (r <= r1)
    n = np.array(north) / np.hypot(*north)
    e = np.array(east) / np.hypot(*east)
    pa = (np.degrees(np.arctan2(dx * e[0] + dy * e[1], dx * n[0] + dy * n[1])) + 360) % 360
    bins = np.zeros(36)
    cnt = np.zeros(36)
    idx = (pa[m] // 10).astype(int)
    np.add.at(bins, idx, L[m])
    np.add.at(cnt, idx, 1)
    prof = bins / np.maximum(cnt, 1)
    k = int(np.argmax(prof))
    return k * 10 + 5, float(prof.max() / max(prof.min(), 1e-9)), prof


if __name__ == '__main__':
    for name, x, fov in [('gaia-bh3-40rs', 40, 55), ('gaia-bh3-10rs', 10, 55), ('sgra-noDisk-10rs', 10, 55)]:
        L = lum(f'{D}/bh-{name}.png')
        exp_px, exp_deg = synge_px(x, fov)
        med, p5, p95, n = shadow_radius(L, thr=0.004)
        print(f'{name}: shadow radius median {med:.1f} px (5-95% {p5:.1f}-{p95:.1f}, {n} rays); Synge {exp_px:.1f} px ({exp_deg:.3f} deg); diff {100 * (med / exp_px - 1):+.1f} %')
    # Earth views: screen north/east from the capture log (sky axes), annulus over the disk's inner part
    axes = {
        'm87-earth-25rs': ((797.535 - 720, 202.529 - 450), (472.529 - 720, 372.465 - 450)),
        'sgra-earth-25rs': ((498.636 - 720, 314.902 - 450), (584.902 - 720, 671.364 - 450)),
    }
    for name, (north, east) in axes.items():
        L = lum(f'{D}/bh-{name}.png')
        exp_px, _ = synge_px(25)
        for r0, r1 in [(exp_px * 1.05, exp_px * 1.25), (exp_px * 1.5, exp_px * 3.0)]:
            pk, ratio, _ = pa_profile(L, north, east, r0, r1)
            print(f'{name}: annulus {r0:.0f}-{r1:.0f} px: brightest PA {pk} deg E of N, max/min {ratio:.2f}')
