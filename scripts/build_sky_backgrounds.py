#!/usr/bin/env python
"""Alternative sky backgrounds baked from HiPS tiles into the Gaia sky image's projection.

The viewer's sky sphere (web/src/render/post.ts) samples one Hammer-Aitoff Galactic image
(l = 0 at the centre, l increasing to the LEFT, b = +90 at the top; pixel centres
x = linspace(+2sqrt2, -2sqrt2, W), y = linspace(+sqrt2, -sqrt2, H), as web/src/math/frames.ts
hammerUV). Each background below is resampled into exactly that grid, so the shader only swaps
textures.

SURVEYS (HiPS mirrors with CORS `*`, checked 2026-11-14; CDS/alasky is down since 2026-11-09)
  erosita   eROSITA-DE DR1 eRASS1 RGB rate image (0.2-0.5 / 0.5-1.0 / 1.0-2.0 keV), J. Sanders, MPE
            https://erosita.mpe.mpg.de/erodat/static/hips/eRASS1_RGB_Rate_c010/  (equatorial, PNG, 512 px)
            Western Galactic half only (l > 180 deg, moc_sky_fraction 0.5). No licence is named; the
            eROSITA-DE acknowledgement text is required (dr1/AllSkySurveyData_dr1/acknowledgement.html).
            Merloni et al. 2024, A&A 682, A34.
  wise      AllWISE colour (W4 red, W2 green, W1 blue), CDS HiPS on the ESA mirror
            https://skies.esac.esa.int/AllWISEColor/  (equatorial, JPEG, 512 px). obs_copyright
            "IPAC/NASA"; obs_ack: WISE (UCLA, JPL/Caltech) and NEOWISE (JPL/Caltech), funded by NASA.
            Wright et al. 2010, AJ 140, 1868.
            NOT SHIPPED: baked at orders 2 and 3 (2026-11-14), the mirror's low-order AllWISE tiles show
            Moon-contamination streaks, moire rings and tile-to-tile background jumps over much of the
            sky. Kept here so it can be re-tried (--only wise) when a cleaner low-order source exists.
  planck857 Planck HFI 857 GHz (thermal dust), ESA ESDC HiPS
            https://skies.esac.esa.int/pla/HFI_SkyMap_857_2048_R3_00_full_HiPS/  (galactic, PNG, 256 px,
            grey, pixelCut -3..5 MJy/sr linear). hips_copyright "ESA", obs_ack "Planck Collaboration".
            Planck Collaboration 2020, A&A 641, A3. Coloured here with a monotonic dark-to-warm ramp.

TILE PIXEL ORDER
  A HiPS tile at order k with width w holds the HEALPix NESTED pixels of order k + log2(w) whose
  index is npix * w^2 + s. s is split into its even bits (i) and odd bits (j). Which of the eight
  (flip/transpose) placements of (i, j) is the image (column, row) is not something we wanted to
  assume: `--calibrate` bakes the Gaia DR3 RGB HiPS (ESAVO/P/GAIA/DR3-RGB, galactic) at order 2
  with all eight and correlates each with our own Gaia flux image (web/public/sky/gaia_dr3_sky_l9.jpg).
  The winner is stored in the JSON sidecar ("orientation"). Measured 2026-11-14: transpose, no
  flips, i.e. column = odd bits, row = even bits (high-pass r = 0.022 vs <= 0.0055 for the other
  seven; a visual check of the Galactic Centre dust lanes shows the other seven break into
  diamond-shaped tiles).

DISPLAY
  Each image gets a per-survey display stretch (SURVEYS[...]["stretch"] = background percentile,
  white percentile, gamma; see stretch()), so empty sky is black and the range fits 8 bits.

OUTPUT
  web/public/sky/<id>_hammer.jpg (4000 x 2000 by default, JPEG q88, <= 4 MB asserted) and
  web/public/sky/sky_backgrounds.json (per survey: source URL, order, tile count, missing tiles, bytes).
  Tiles are cached in data/cache/hips/<id>/ (gitignored).

usage: .venv/bin/python -I scripts/build_sky_backgrounds.py [--calibrate] [--only erosita,planck857] [--width 4000]
"""
from __future__ import annotations

import argparse
import io
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import requests
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from catio import CACHE, UA, utcnow  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
SKY = ROOT / "web" / "public" / "sky"
BUDGET = 4 * 1024 * 1024
SQ2 = np.sqrt(2.0)

SURVEYS = {
    "erosita": {"url": "https://erosita.mpe.mpg.de/erodat/static/hips/eRASS1_RGB_Rate_c010/", "order": 2, "width": 512,
                "fmt": "png", "frame": "equatorial", "title": "eROSITA-DE DR1 eRASS1 X-ray (0.2-2.0 keV RGB rate)",
                "stretch": (40, 99.95, 0.9)},
    "wise": {"url": "https://skies.esac.esa.int/AllWISEColor/", "order": 3, "ss": 4, "width": 512, "fmt": "jpg",
             "frame": "equatorial", "title": "AllWISE colour (W1, W2, W4)", "stretch": (5, 99.97, 0.55)},
    "planck857": {"url": "https://skies.esac.esa.int/pla/HFI_SkyMap_857_2048_R3_00_full_HiPS/", "order": 3, "width": 256,
                  "fmt": "png", "frame": "galactic", "title": "Planck HFI 857 GHz (dust)", "ramp": True,
                  "stretch": (3, 99.9, 1.6)},
}
CALIB = {"url": "https://skies.esac.esa.int/Gaia/dr3/RGB/", "order": 2, "width": 512, "fmt": "png", "frame": "galactic"}

# (transpose, flip column, flip row) applied to (i = even bits, j = odd bits); see --calibrate
ORIENTATION = None  # filled from the calibration result below (kept in sky_backgrounds.json)


def deinterleave(s: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """even bits -> i, odd bits -> j"""
    s = s.astype(np.uint64)
    i = np.zeros_like(s)
    j = np.zeros_like(s)
    for bit in range(16):
        i |= ((s >> np.uint64(2 * bit)) & np.uint64(1)) << np.uint64(bit)
        j |= ((s >> np.uint64(2 * bit + 1)) & np.uint64(1)) << np.uint64(bit)
    return i.astype(np.int64), j.astype(np.int64)


def place(i, j, w, orient):
    tr, fc, fr = orient
    c, r = (j, i) if tr else (i, j)
    if fc:
        c = w - 1 - c
    if fr:
        r = w - 1 - r
    return c, r


def hammer_grid(W: int, H: int, ss: int, r0: int = 0, r1: int | None = None):
    """Galactic (l, b) in degrees of the supersampled output grid (rows r0..r1); NaN outside the ellipse."""
    xs = np.linspace(2 * SQ2, -2 * SQ2, W)
    ys_all = np.linspace(SQ2, -SQ2, H)
    dx = (xs[1] - xs[0]) if W > 1 else 0
    dy = (ys_all[1] - ys_all[0]) if H > 1 else 0
    ys = ys_all[r0:r1]
    offs = (np.arange(ss) + 0.5) / ss - 0.5
    X = (xs[None, :, None, None] + offs[None, None, None, :] * dx)
    Y = (ys[:, None, None, None] + offs[None, None, :, None] * dy)
    X, Y = np.broadcast_arrays(X, Y)
    inside = (X / (2 * SQ2)) ** 2 + (Y / SQ2) ** 2 <= 1
    z = np.sqrt(np.clip(1 - (X / 4) ** 2 - (Y / 2) ** 2, 0, None))
    lon = np.degrees(2 * np.arctan2(z * X, 2 * (2 * z * z - 1)))
    lat = np.degrees(np.arcsin(np.clip(z * Y, -1, 1)))
    lon[~inside] = np.nan
    lat[~inside] = np.nan
    return lon, lat


def gal_to_icrs_matrix() -> np.ndarray:
    import astropy.units as u
    from astropy.coordinates import SkyCoord
    g = SkyCoord(l=[0, 90, 0] * u.deg, b=[0, 0, 90] * u.deg, frame="galactic").icrs.cartesian
    return np.array([g.x.value, g.y.value, g.z.value])  # columns: images of the galactic basis


def fetch_tiles(s: dict, cache: Path, workers: int = 8) -> tuple[dict[int, np.ndarray], list[int]]:
    import healpy as hp
    n = hp.nside2npix(2 ** s["order"])
    cache.mkdir(parents=True, exist_ok=True)
    sess = requests.Session()
    sess.headers.update(UA)

    def one(p: int):
        f = cache / f"Npix{p}.{s['fmt']}"
        if not f.exists():
            url = f"{s['url']}Norder{s['order']}/Dir{(p // 10000) * 10000}/Npix{p}.{s['fmt']}"
            for attempt in range(4):
                try:
                    r = sess.get(url, timeout=120)
                    if r.status_code == 404:
                        f.with_suffix(".missing").touch()
                        return p, None
                    r.raise_for_status()
                    f.write_bytes(r.content)
                    break
                except requests.RequestException:
                    time.sleep(3 * (attempt + 1))
            else:
                return p, None
        im = Image.open(f)
        rgba = np.asarray(im.convert("RGBA"))
        return p, rgba

    tiles, missing = {}, []
    with ThreadPoolExecutor(workers) as ex:
        for p, a in ex.map(one, range(n)):
            if a is None:
                missing.append(p)
            else:
                tiles[p] = a
    return tiles, missing


def bake(s: dict, tiles: dict, W: int, H: int, orient, ss: int = 2, rows_per_chunk: int = 100) -> np.ndarray:
    import healpy as hp
    w = s["width"]
    lw = int(np.log2(w))
    nside_pix = 2 ** (s["order"] + lw)
    M = gal_to_icrs_matrix() if s["frame"] == "equatorial" else None
    out = np.zeros((H, W, 3), np.float32)
    ss = s.get("ss", ss)
    for r0 in range(0, H, rows_per_chunk):
        lon, lat = hammer_grid(W, H, ss, r0, r0 + rows_per_chunk)  # (rows, W, ss, ss)
        ok = np.isfinite(lon)
        l, b = np.radians(np.where(ok, lon, 0)), np.radians(np.where(ok, lat, 0))
        v = np.stack([np.cos(b) * np.cos(l), np.cos(b) * np.sin(l), np.sin(b)], -1)
        if M is not None:
            v = v @ M.T
        ipix = hp.vec2pix(nside_pix, v[..., 0], v[..., 1], v[..., 2], nest=True)
        tile = ipix >> (2 * lw)
        i, j = deinterleave(ipix & ((1 << (2 * lw)) - 1))
        c, r = place(i, j, w, orient)
        acc = np.zeros(lon.shape + (3,), np.float32)
        have = np.zeros(lon.shape, bool)
        for p in np.unique(tile[ok]):
            a = tiles.get(int(p))
            if a is None:
                continue
            sel = ok & (tile == p)
            px = a[r[sel], c[sel]].astype(np.float32)
            alpha = px[:, 3] / 255.0
            acc[sel] = px[:, :3] * alpha[:, None]
            have[sel] = alpha > 0
        out[r0:r0 + rows_per_chunk] = acc.mean(axis=(2, 3))
    return out


def stretch(img: np.ndarray, inside: np.ndarray, p_lo: float, p_hi: float, gamma: float) -> np.ndarray:
    """display stretch: per-channel background (p_lo percentile of the covered sky) to black, a
    common scale so the p_hi percentile of the brightest channel is white, then a power law. Pixels
    without data (eROSITA's eastern half) stay black."""
    have = inside & (img.max(-1) > 0)
    lo = np.array([np.percentile(img[..., k][have], p_lo) for k in range(3)], np.float32)
    x = np.clip(img - lo, 0, None)
    hi = float(np.percentile(x[have].max(-1), p_hi))
    y = np.clip(x / hi, 0, 1) ** gamma * 255
    y[~have] = 0
    return y


def ramp(grey: np.ndarray) -> np.ndarray:
    """monotonic dark -> warm ramp for the grey Planck dust map (lightness rises with intensity)"""
    t = np.clip(grey / 255.0, 0, 1)
    stops = np.array([[0, 0, 0], [40, 18, 52], [120, 44, 60], [205, 104, 54], [245, 190, 110], [255, 245, 220]], np.float32)
    x = np.linspace(0, 1, len(stops))
    return np.stack([np.interp(t, x, stops[:, k]) for k in range(3)], -1)


def _highpass(img: np.ndarray, r: int = 4) -> np.ndarray:
    """log image minus its box blur (small-scale structure: dust lanes, clusters, the LMC's edge)"""
    from scipy.ndimage import uniform_filter
    x = np.log1p(img.astype(np.float64))
    return x - uniform_filter(x, 2 * r + 1)


def calibrate(W=1600) -> tuple:
    """bake the Gaia DR3 RGB HiPS with all 8 placements; correlate its small-scale structure with our Gaia image"""
    ref = np.asarray(Image.open(SKY / "gaia_dr3_sky_l9.jpg").convert("L").resize((W, W // 2), Image.LANCZOS), np.float32)
    tiles, missing = fetch_tiles(CALIB, CACHE / "hips" / f"gaia-dr3-rgb-o{CALIB['order']}")
    lon, _ = hammer_grid(W, W // 2, 1)
    inside = np.isfinite(lon[:, :, 0, 0])
    inside[:8], inside[-8:], inside[:, :8], inside[:, -8:] = False, False, False, False
    hp_ref = _highpass(ref)
    res = []
    for tr in (0, 1):
        for fc in (0, 1):
            for fr in (0, 1):
                img = bake(CALIB, tiles, W, W // 2, (tr, fc, fr), ss=1).mean(-1)
                a, b = _highpass(img)[inside], hp_ref[inside]
                cc = float(np.corrcoef(a, b)[0, 1])
                res.append(((tr, fc, fr), cc))
                print(f"  orientation transpose={tr} flipcol={fc} fliprow={fr}: r = {cc:.4f}", flush=True)
    res.sort(key=lambda x: -x[1])
    print(f"best {res[0][0]} r = {res[0][1]:.4f}; next {res[1][1]:.4f}; tiles {len(tiles)}, missing {len(missing)}")
    return res[0][0], res


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--calibrate", action="store_true")
    ap.add_argument("--only", default="erosita,planck857")
    ap.add_argument("--width", type=int, default=4000)
    ap.add_argument("--quality", type=int, default=88)
    a = ap.parse_args()
    side = SKY / "sky_backgrounds.json"
    meta = json.loads(side.read_text()) if side.exists() else {"surveys": {}}
    if a.calibrate or "orientation" not in meta:
        best, res = calibrate()
        meta["orientation"] = {"transpose_flipcol_fliprow": list(best), "method": "Gaia DR3 RGB HiPS order 2 vs gaia_dr3_sky_l9.jpg, log-luminance correlation",
                               "scores": [[list(o), round(c, 4)] for o, c in res], "date": utcnow()}
    orient = tuple(meta["orientation"]["transpose_flipcol_fliprow"])
    W, H = a.width, a.width // 2
    for sid in [x for x in a.only.split(",") if x]:
        s = SURVEYS[sid]
        t0 = time.time()
        tiles, missing = fetch_tiles(s, CACHE / "hips" / sid)
        print(f"{sid}: {len(tiles)} tiles, {len(missing)} missing ({time.time() - t0:.0f} s)", flush=True)
        img = bake(s, tiles, W, H, orient)
        lon, _ = hammer_grid(W, H, 1)
        if s.get("stretch"):
            img = stretch(img, np.isfinite(lon[:, :, 0, 0]), *s["stretch"])
        if s.get("ramp"):
            img = ramp(img.mean(-1))
        out = SKY / f"{sid}_hammer.jpg"
        Image.fromarray(np.clip(np.round(img), 0, 255).astype(np.uint8), "RGB").save(out, "JPEG", quality=a.quality, optimize=True, progressive=True)
        size = out.stat().st_size
        assert size <= BUDGET, f"{out}: {size} B > 4 MB"
        meta["surveys"][sid] = {"title": s["title"], "source": s["url"], "order": s["order"], "tile_width": s["width"], "frame": s["frame"],
                                "tiles": len(tiles), "missing_tiles": len(missing), "image": f"sky/{out.name}", "width": W, "height": H,
                                "bytes": size, "stretch_pct_lo_pct_hi_gamma": s.get("stretch"), "built": utcnow()}
        print(f"  -> {out} {size / 1024:.0f} KB", flush=True)
    side.write_text(json.dumps(meta, indent=1) + "\n")


if __name__ == "__main__":
    main()
