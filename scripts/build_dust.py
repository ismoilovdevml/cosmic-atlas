#!/usr/bin/env python
"""data/tiles/dust/: the Edenhofer et al. (2024) 3D dust map as two browser 3D textures.

SOURCE
  Edenhofer, Zucker, Frank, Saydjari, Speagle, Finkbeiner & Ensslin 2024, A&A 685, A82,
  "A parsec-scale Galactic 3D dust map out to 1.25 kpc from the Sun" (arXiv:2308.01295).
  Zenodo record 8187943 (v1.0, CC BY 4.0), file `mean_and_std_healpix.fits`: posterior MEAN and STD
  of the differential extinction on 516 HEALPix spheres (Nside 256, NESTED, 14') at log-spaced
  distances 68.8-1248 pc, plus the radial bin boundaries and the extinction integrated inside
  68.8 pc. Units: "E of Zhang, Green, and Rix (2023)" per pc. A_V = 2.8 E (paper, Sect. 7).
  The whole 3.25 GB file is downloaded (scripts/zenodo_fetch.py), its md5 is checked against the
  Zenodo record and its sha256 is written to PROVENANCE.json.
  Radcliffe Wave overlay for the check figure: Alves et al. 2020 best-fit model (Harvard Dataverse
  doi:10.7910/DVN/OE51SZ, CC0, file Radcliffe_Wave_Best_Fit.tab).

RESAMPLING (HEALPix x distance -> heliocentric Galactic Cartesian, contract section 1)
  Each HEALPix cell (pixel x radial bin) is split radially into ceil(dr / 3 pc) parts and its
  centre(s) deposited into the 6 pc grid with weight = cell volume r^2 dr dOmega; a voxel's value
  is the volume-weighted mean of the cells whose centres fall in it (an area-weighted box average).
  The few voxels inside the data shell that get no cell centre are filled from the cell at their
  centre. Inside 68.8 pc the map has only the integrated extinction per pixel; it is spread
  uniformly along the radius (an assumption, labelled in meta.json). Outside 1248 pc: 0 (no data).
  The 12 pc grid is the 2x2x2 volume-weighted average of the 6 pc grid's cells. Its STD channel is
  the volume-weighted mean of the per-cell posterior std: equal to the std of the average when the
  cells' errors are fully correlated, an upper bound otherwise.

OUTPUT (all little endian, x fastest, then y, then z)
  mean_u8.bin   418 x 418 x 134 uint8, 6 pc voxels, A_V per kpc, log code (meta.mean.encoding)
  aux_rgba8.bin 209 x 209 x 67 x RGBA8, 12 pc voxels:
                R = mean A_V/kpc (same code as mean_u8), G = std A_V/kpc (log code, meta.std),
                B,A = A_V (mag) from the Sun to the voxel centre, 16-bit fixed point (hi byte B):
                A = (256 B + A) / 65535 * meta.sunAv.max, marched through the decoded 6 pc grid
                with trilinear sampling, the same field the viewer marches.
  meta.json, PROVENANCE.json

Usage: .venv/bin/python -I scripts/build_dust.py [--cache data/cache/dust] [--out data/tiles/dust]
Figures from the written files: scripts/plot_dust_check.py (needs matplotlib).
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from healpix_nest import pix2vec_nest, vec2pix_nest  # noqa: E402
from zenodo_fetch import fetch  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
RECORD = "8187943"
KEY = "mean_and_std_healpix.fits"
E_TO_AV = 2.8          # Edenhofer+2024 Sect. 7: A_V(540 nm) = 2.8 x ZGR23 E
AVKPC = E_TO_AV * 1e3  # E per pc -> A_V mag per kpc
NSIDE = 256

# grid: 6 pc fine (418 x 418 x 134) nested 2:1 in a 12 pc coarse grid (209 x 209 x 67)
VOX = 6.0
NX, NY, NZ = 418, 418, 134
ORIGIN = np.array([-NX * VOX / 2, -NY * VOX / 2, -NZ * VOX / 2])  # min corner: (-1254, -1254, -402) pc

CITATION = ("Edenhofer, G., Zucker, C., Frank, P., Saydjari, A. K., Speagle, J. S., Finkbeiner, D., "
            "& Ensslin, T. A. 2024, A&A 685, A82, \"A parsec-scale Galactic 3D dust map out to 1.25 kpc "
            "from the Sun\"")
DOI = "10.1051/0004-6361/202347628"

# Validation targets: direction toward the cloud and its literature distance (pc).
# tol = how far the map's peak may sit from the literature value and still count as agreement.
CLOUDS = [
    {"name": "Taurus (L1495/B213)", "l": 169.6, "b": -16.1, "d": 141, "tol": 25,
     "ref": "Zucker et al. 2019, ApJ 879, 125 (Taurus 141 pc); Galli et al. 2019, A&A 630, A137"},
    {"name": "Ophiuchus (L1688)", "l": 353.1, "b": 16.9, "d": 139, "tol": 25,
     "ref": "Ortiz-Leon et al. 2017, ApJ 834, 141 (137 pc); Zucker et al. 2019 (139 pc)"},
    {"name": "Perseus (NGC 1333 - IC 348)", "l": 159.4, "b": -19.8, "d": 294, "tol": 40,
     "ref": "Zucker et al. 2018, ApJ 869, 83 (294 pc); Ortiz-Leon et al. 2018, ApJ 865, 73"},
    {"name": "Orion A (ONC to L1641)", "l": 210.5, "b": -19.6, "d": 400, "tol": 60,
     "ref": "Grossschedl et al. 2018, A&A 619, A106 (390-470 pc along the cloud); Kounkel et al. 2017 (ONC 388 pc)"},
    {"name": "Chamaeleon I", "l": 297.1, "b": -15.6, "d": 190, "tol": 30,
     "ref": "Zucker et al. 2019 (Cha I 179-192 pc); Dzib et al. 2018, ApJ 867, 151"},
    {"name": "Lupus I-IV", "l": 339.5, "b": 15.5, "d": 155, "tol": 30,
     "ref": "Zucker et al. 2019; Galli et al. 2020, A&A 643, A148 (155-160 pc)"},
]


def ccm89(lam_nm: float, rv: float = 3.1) -> float:
    """Cardelli, Clayton & Mathis 1989 optical A(lambda)/A(V)"""
    x = 1e3 / lam_nm
    y = x - 1.82
    a = 1 + 0.17699 * y - 0.50447 * y**2 - 0.02427 * y**3 + 0.72085 * y**4 + 0.01979 * y**5 - 0.77530 * y**6 + 0.32999 * y**7
    b = 1.41338 * y + 2.28305 * y**2 + 1.07233 * y**3 - 5.38434 * y**4 - 0.62251 * y**5 + 5.30260 * y**6 - 2.09002 * y**7
    return a + b / rv


def lb_to_vec(l_deg, b_deg):
    l, b = np.radians(l_deg), np.radians(b_deg)
    return np.array([np.cos(b) * np.cos(l), np.cos(b) * np.sin(l), np.sin(b)])


def load(path: Path):
    from astropy.io import fits
    t0 = time.time()
    with fits.open(path, memmap=True) as f:
        mean = np.asarray(f["MEAN"].data, dtype=np.float32)
        std = np.asarray(f["STD."].data, dtype=np.float32)
        rc = np.asarray(f["RADIAL PIXEL CENTERS"].data["radial pixel centers"], dtype=np.float64)
        rb = np.asarray(f["RADIAL PIXEL BOUNDARIES"].data["radial pixel boundaries"], dtype=np.float64)
        inner_m = np.asarray(f["MEAN OF INTEGRATED INNER 68.8 PC"].data, dtype=np.float64)
        inner_s = np.asarray(f["STD. OF INTEGRATED INNER 68.8 PC"].data, dtype=np.float64)
        unit = f["MEAN"].header.get("CUNIT")
    print(f"loaded {path.name}: MEAN {mean.shape} in {time.time() - t0:.0f} s; r {rc[0]:.2f}..{rc[-1]:.2f} pc, "
          f"edges {rb[0]:.2f}..{rb[-1]:.2f}", flush=True)
    return mean, std, rc, rb, inner_m, inner_s, unit


def splat(mean, std, rb, inner_m, inner_s, vec):
    """volume-weighted deposit of HEALPix cells into the 6 pc grid -> (W, M, S) sums (E/pc units)"""
    n = NX * NY * NZ
    W = np.zeros(n)
    M = np.zeros(n)
    S = np.zeros(n)
    dOmega = 4 * np.pi / vec.shape[0]
    vx, vy, vz = (vec[:, i].astype(np.float64) for i in range(3))

    buf: list = []
    held = [0]

    def flush():
        if not buf:
            return
        idx = np.concatenate([b[0] for b in buf])
        vol = np.concatenate([b[1] for b in buf])
        W[:] += np.bincount(idx, weights=vol, minlength=n)
        M[:] += np.bincount(idx, weights=np.concatenate([b[2] for b in buf]) * vol, minlength=n)
        S[:] += np.bincount(idx, weights=np.concatenate([b[3] for b in buf]) * vol, minlength=n)
        buf.clear()
        held[0] = 0

    def deposit(r, vol, m, s):
        ix = np.floor((r * vx - ORIGIN[0]) / VOX).astype(np.int64)
        iy = np.floor((r * vy - ORIGIN[1]) / VOX).astype(np.int64)
        iz = np.floor((r * vz - ORIGIN[2]) / VOX).astype(np.int64)
        ok = (ix >= 0) & (ix < NX) & (iy >= 0) & (iy < NY) & (iz >= 0) & (iz < NZ)
        idx = (iz[ok] * NY + iy[ok]) * NX + ix[ok]
        buf.append((idx, np.full(idx.size, vol), m[ok], s[ok]))
        held[0] += idx.size
        if held[0] > 30_000_000:
            flush()

    t0 = time.time()
    # inside 68.8 pc: integrated E per pixel spread uniformly along the radius (assumption)
    r_in = rb[0]
    k_in = int(math.ceil(r_in / 3.0))
    dm, ds = inner_m / r_in, inner_s / r_in
    for j in range(k_in):
        a, b = j * r_in / k_in, (j + 1) * r_in / k_in
        r = 0.5 * (a + b)
        deposit(r, r * r * (b - a) * dOmega, dm, ds)
    for k in range(mean.shape[0]):
        a, b = rb[k], rb[k + 1]
        parts = max(1, int(math.ceil((b - a) / 3.0)))
        m = mean[k].astype(np.float64)
        s = std[k].astype(np.float64)
        for j in range(parts):
            a2, b2 = a + j * (b - a) / parts, a + (j + 1) * (b - a) / parts
            r = 0.5 * (a2 + b2)
            deposit(r, r * r * (b2 - a2) * dOmega, m, s)
        if k % 64 == 0:
            print(f"  splat bin {k}/{mean.shape[0]} r={a:.0f} pc, {time.time() - t0:.0f} s", flush=True)
    flush()
    return W.reshape(NZ, NY, NX), M.reshape(NZ, NY, NX), S.reshape(NZ, NY, NX)


def centres(n, o, v):
    return o + (np.arange(n) + 0.5) * v


def gather(mean, rc, rb, inner, pts):
    """point lookup (nearest pixel, piecewise-constant radial bin) of a HEALPix x distance field"""
    r = np.linalg.norm(pts, axis=1)
    pix = vec2pix_nest(NSIDE, pts[:, 0], pts[:, 1], pts[:, 2])
    k = np.searchsorted(rb, r) - 1
    out = np.zeros(len(r))
    ok = (k >= 0) & (k < mean.shape[0])
    out[ok] = mean[k[ok], pix[ok]]
    ins = r < rb[0]
    out[ins] = inner[pix[ins]] / rb[0]
    return out


def log_code(v, lo, hi):
    """0 = below 10^lo (zero); 1..255 = log10 v linearly from lo to hi (clipped)"""
    out = np.zeros(v.shape, dtype=np.uint8)
    pos = v >= 10.0**lo
    c = 1 + np.round(254 * (np.log10(np.maximum(v[pos], 1e-30)) - lo) / (hi - lo))
    out[pos] = np.clip(c, 1, 255).astype(np.uint8)
    return out


def log_decode(c, lo, hi):
    """inverse of log_code, also valid for trilinearly filtered (fractional) codes, as in the viewer"""
    c = np.asarray(c, dtype=np.float64)
    return np.where(c >= 1.0, 10.0 ** (lo + (c - 1.0) / 254.0 * (hi - lo)), c * 10.0**lo)


def sun_av(fine_av: np.ndarray, pts: np.ndarray, steps: int = 512, chunk: int = 16384) -> np.ndarray:
    """A_V (mag) from the Sun to each point, midpoint rule through the trilinearly sampled 6 pc
    field (A_V per kpc), texel-centre convention and clamp-to-edge like the GPU sampler"""
    from scipy.ndimage import map_coordinates
    out = np.zeros(len(pts))
    f = (np.arange(steps) + 0.5) / steps
    t0 = time.time()
    for i in range(0, len(pts), chunk):
        p = pts[i:i + chunk]
        q = p[:, None, :] * f[None, :, None]  # (n, steps, 3)
        u = (q - ORIGIN) / VOX - 0.5           # index coordinates (x, y, z)
        coords = np.stack([u[..., 2].ravel(), u[..., 1].ravel(), u[..., 0].ravel()])
        s = map_coordinates(fine_av, coords, order=1, mode="nearest").reshape(len(p), steps)
        out[i:i + chunk] = s.mean(axis=1) * np.linalg.norm(p, axis=1) / 1e3
        if (i // chunk) % 40 == 0:
            print(f"  sun A_V {i}/{len(pts)} {time.time() - t0:.0f} s", flush=True)
    return out


def los_profile_native(mean, rc, vec, l, b, radius_deg=0.5):
    """mean differential extinction (A_V/kpc) vs distance in a small disc around (l, b)"""
    d = lb_to_vec(l, b)
    sel = vec @ d >= np.cos(np.radians(radius_deg))
    return mean[:, sel].mean(axis=1) * AVKPC, int(sel.sum())


def los_profile_grid(fine_av, l, b, rmax=1250.0, step=1.0):
    from scipy.ndimage import map_coordinates
    d = lb_to_vec(l, b)
    r = np.arange(step / 2, rmax, step)
    q = r[:, None] * d[None, :]
    u = (q - ORIGIN) / VOX - 0.5
    s = map_coordinates(fine_av, np.stack([u[:, 2], u[:, 1], u[:, 0]]), order=1, mode="nearest")
    return r, s


def peak_distance(r, prof):
    """distance of the strongest density peak (3-bin smoothed) and of the 50% point of the cumulative rise"""
    k = np.convolve(prof, np.ones(3) / 3, mode="same")
    i = int(np.argmax(k))
    dr = np.gradient(r)
    cum = np.cumsum(prof * dr)
    j = int(np.searchsorted(cum, 0.5 * cum[-1])) if cum[-1] > 0 else 0
    return float(r[i]), float(r[min(j, len(r) - 1)]), float(cum[-1] / 1e3)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", type=Path, default=ROOT / "data" / "cache" / "dust")
    ap.add_argument("--out", type=Path, default=ROOT / "data" / "tiles" / "dust")
    ap.add_argument("--workers", type=int, default=24)
    a = ap.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)
    src = fetch(RECORD, KEY, a.cache / KEY, a.workers)
    print(f"source verified: md5 {src['md5']} sha256 {src['sha256']}", flush=True)
    mean, std, rc, rb, inner_m, inner_s, unit = load(a.cache / KEY)
    vec = pix2vec_nest(NSIDE, np.arange(12 * NSIDE * NSIDE))

    W, M, S = splat(mean, std, rb, inner_m, inner_s, vec)
    xs, ys, zs = centres(NX, ORIGIN[0], VOX), centres(NY, ORIGIN[1], VOX), centres(NZ, ORIGIN[2], VOX)
    Z, Y, X = np.meshgrid(zs, ys, xs, indexing="ij")
    R = np.sqrt(X * X + Y * Y + Z * Z)
    in_data = R <= rb[-1]
    holes = in_data & (W <= 0)
    print(f"voxels {W.size:,}; inside data sphere {int(in_data.sum()):,}; filled by cell centres "
          f"{int((in_data & (W > 0)).sum()):,}; holes filled by lookup {int(holes.sum()):,}", flush=True)
    fine = np.where(W > 0, M / np.where(W > 0, W, 1), 0.0)
    fine_s = np.where(W > 0, S / np.where(W > 0, W, 1), 0.0)
    if holes.any():
        pts = np.stack([X[holes], Y[holes], Z[holes]], axis=1)
        fine[holes] = gather(mean, rc, rb, inner_m, pts)
        fine_s[holes] = gather(std, rc, rb, inner_s, pts)
    fine[~in_data] = 0.0
    fine_s[~in_data] = 0.0
    fine *= AVKPC
    fine_s *= AVKPC

    # coarse 12 pc: volume-weighted 2x2x2 averages
    def block(arr):
        return arr.reshape(NZ // 2, 2, NY // 2, 2, NX // 2, 2).sum(axis=(1, 3, 5))
    Wf = np.where(in_data, np.maximum(W, 0), 0) + np.where(holes, VOX**3, 0)
    Wc = block(Wf)
    coarse = np.where(Wc > 0, block(fine * Wf) / np.where(Wc > 0, Wc, 1), 0.0)
    coarse_s = np.where(Wc > 0, block(fine_s * Wf) / np.where(Wc > 0, Wc, 1), 0.0)

    # encodings from the distribution inside the data sphere
    v = fine[in_data]
    pct = {p: float(np.percentile(v, p)) for p in (0.5, 1, 5, 50, 95, 99, 99.9, 99.99)}
    pct["max"] = float(v.max())
    lo, hi = math.log10(max(pct[1], 1e-4)), math.log10(pct[99.99])
    sv = coarse_s[coarse_s > 0]
    spct = {p: float(np.percentile(sv, p)) for p in (1, 50, 99, 99.99)}
    spct["max"] = float(sv.max())
    slo, shi = math.log10(max(spct[1], 1e-4)), math.log10(spct[99.99])
    print(f"A_V/kpc percentiles inside the data sphere: {pct}", flush=True)
    print(f"std A_V/kpc percentiles (12 pc): {spct}", flush=True)
    fine_u8 = log_code(fine, lo, hi)
    fine_dec = log_decode(fine_u8, lo, hi)
    rel = np.abs(fine_dec[in_data & (fine > 10**lo)] / fine[in_data & (fine > 10**lo)] - 1)
    print(f"uint8 round trip (values above 10^lo, below the clip): median {np.median(rel):.4f}, "
          f"99th pct {np.percentile(rel, 99):.4f}; clipped above hi: {int((v > 10**hi).sum()):,}", flush=True)

    # A_V from the Sun to every coarse voxel centre, through the decoded fine field
    cx, cy, cz = centres(NX // 2, ORIGIN[0], 2 * VOX), centres(NY // 2, ORIGIN[1], 2 * VOX), centres(NZ // 2, ORIGIN[2], 2 * VOX)
    CZ, CY, CX = np.meshgrid(cz, cy, cx, indexing="ij")
    cpts = np.stack([CX.ravel(), CY.ravel(), CZ.ravel()], axis=1)
    fine_dec32 = fine_dec.astype(np.float32)
    sunA = sun_av(fine_dec32, cpts).reshape(CX.shape)
    amax = float(math.ceil(sunA.max() * 10) / 10)
    q16 = np.round(np.clip(sunA / amax, 0, 1) * 65535).astype(np.uint32)
    aux = np.zeros(CX.shape + (4,), dtype=np.uint8)
    aux[..., 0] = log_code(coarse, lo, hi)
    aux[..., 1] = log_code(coarse_s, slo, shi)
    aux[..., 2] = (q16 >> 8).astype(np.uint8)
    aux[..., 3] = (q16 & 255).astype(np.uint8)
    print(f"Sun -> voxel A_V: max {sunA.max():.2f} mag (scale {amax}), median in plane "
          f"{float(np.median(sunA[CZ.shape[0] // 2])):.2f}", flush=True)

    (a.out / "mean_u8.bin").write_bytes(np.ascontiguousarray(fine_u8).tobytes())
    (a.out / "aux_rgba8.bin").write_bytes(np.ascontiguousarray(aux).tobytes())

    # ---- validation against the literature
    checks = []
    for c in CLOUDS:
        prof, npx = los_profile_native(mean, rc, vec, c["l"], c["b"])
        pk, half, tot = peak_distance(rc, prof)
        rg, pg = los_profile_grid(fine_dec32, c["l"], c["b"])
        pkg, halfg, totg = peak_distance(rg, pg)
        ok = abs(pk - c["d"]) <= c["tol"] and abs(pkg - c["d"]) <= c["tol"]
        checks.append({**c, "native": {"peak_pc": round(pk, 1), "half_cum_pc": round(half, 1), "Av_total": round(tot, 2), "pixels": npx},
                       "grid6pc": {"peak_pc": round(pkg, 1), "half_cum_pc": round(halfg, 1), "Av_total": round(totg, 2)},
                       "xyz_peak": [round(float(v), 1) for v in pkg * lb_to_vec(c["l"], c["b"])], "agrees": bool(ok)})
        print(f"  {c['name']:30s} lit {c['d']:4d} pc | native peak {pk:6.1f} (50% {half:6.1f}, A_V {tot:.2f}) | "
              f"6 pc grid peak {pkg:6.1f} | {'OK' if ok else 'DISAGREES'}", flush=True)
    # Local Bubble: mean density inside 100 pc vs a 150-300 pc shell, from the shipped grid
    bub = float(np.median(fine_dec[(R < 100)]))
    shell = float(np.median(fine_dec[(R > 150) & (R < 300)]))
    # wall: along 360 in-plane directions, the first distance where the density exceeds 1 mag/kpc
    walls = []
    for lon in range(0, 360):
        rr, pp = los_profile_grid(fine_dec32, float(lon), 0.0, rmax=1250.0, step=2.0)
        hit = np.nonzero(pp > 1.0)[0]
        walls.append(float(rr[hit[0]]) if hit.size else float("nan"))
    walls = np.array(walls)
    fill_in = float((fine_dec[R < 100] > 1.0).mean())
    fill_sh = float((fine_dec[(R > 150) & (R < 300)] > 1.0).mean())
    wall = {"threshold_Av_per_kpc": 1.0, "median_pc": round(float(np.nanmedian(walls)), 1),
            "p10_pc": round(float(np.nanpercentile(walls, 10)), 1), "p90_pc": round(float(np.nanpercentile(walls, 90)), 1),
            "directions_never_crossing": int(np.isnan(walls).sum()),
            "volume_fraction_gt1_r_lt_100": round(fill_in, 4), "volume_fraction_gt1_150_300": round(fill_sh, 4)}
    print(f"  Local Bubble: median A_V/kpc r<100 pc {bub:.3f} vs 150-300 pc shell {shell:.3f} (ratio {shell / max(bub, 1e-9):.1f}); "
          f"in-plane wall (first > 1 mag/kpc): {wall}")
    # Radcliffe Wave: density along the model curve vs the same distances in random directions in the plane
    rw = None
    rwp = a.cache / "radcliffe_wave_best_fit.csv"
    if rwp.exists():
        from scipy.ndimage import map_coordinates
        w = np.loadtxt(rwp, delimiter=",", skiprows=1)
        def samp(p):
            u = (p - ORIGIN) / VOX - 0.5
            return map_coordinates(fine_dec32, np.stack([u[:, 2], u[:, 1], u[:, 0]]), order=1, mode="nearest")
        inside = np.linalg.norm(w, axis=1) < 1200
        on = samp(w[inside])
        rng = np.random.default_rng(0)
        ctrl = []
        for _ in range(50):
            ang = rng.uniform(0, 2 * np.pi)
            rot = np.array([[np.cos(ang), -np.sin(ang), 0], [np.sin(ang), np.cos(ang), 0], [0, 0, 1]])
            ctrl.append(samp(w[inside] @ rot.T).mean())
        rw = {"points_inside_1200pc": int(inside.sum()), "mean_Av_per_kpc_on_curve": round(float(on.mean()), 3),
              "median_on_curve": round(float(np.median(on)), 3),
              "mean_rotated_controls": round(float(np.mean(ctrl)), 3), "std_rotated_controls": round(float(np.std(ctrl)), 3)}
        print(f"  Radcliffe Wave: {rw}")

    rgb_ratio = [round(ccm89(lam) / ccm89(540.0), 4) for lam in (610.0, 540.0, 465.0)]
    meta = {
        "layer": "dust",
        "title": "3D dust, Edenhofer et al. 2024",
        "frame": "galactic-helio",
        "unit": "pc",
        "quantity": "differential extinction A_V per kpc (posterior mean), A_V = 2.8 E(ZGR23)",
        "sourceUnit": unit,
        "eToAv": E_TO_AV,
        "dataRadiusPc": [0.0, float(rb[-1])],
        "innerAssumption": f"inside {rb[0]:.1f} pc the source gives only the integrated extinction per pixel; spread uniformly along the radius",
        "fine": {"file": "mean_u8.bin", "dims": [NX, NY, NZ], "voxelPc": VOX, "origin": ORIGIN.tolist(), "format": "r8", "bytes": int(fine_u8.size)},
        "aux": {"file": "aux_rgba8.bin", "dims": [NX // 2, NY // 2, NZ // 2], "voxelPc": 2 * VOX, "origin": ORIGIN.tolist(), "format": "rgba8",
                "channels": ["mean A_V/kpc (log code, = mean)", "std A_V/kpc (log code, = std)", "A_V from Sun, high byte", "A_V from Sun, low byte"],
                "bytes": int(aux.size)},
        "mean": {"encoding": "log10", "lo": lo, "hi": hi, "note": "code 0: value < 10^lo (decoded linearly as code*10^lo); 1..255: 10^(lo + (code-1)/254 (hi-lo))"},
        "std": {"encoding": "log10", "lo": slo, "hi": shi, "aggregation": "volume-weighted mean of per-cell posterior std over the 12 pc voxel"},
        "sunAv": {"max": amax, "encoding": "uint16 fixed point (B<<8|A)/65535*max", "steps": 512},
        "percentiles": {"AvPerKpc_6pc": pct, "stdAvPerKpc_12pc": spct},
        "rgbExtinctionRatio": {"lambdaNm": [610, 540, 465], "ratioToAV": rgb_ratio, "law": "Cardelli, Clayton & Mathis 1989, R_V = 3.1"},
        "landmarks": [{"name": c["name"], "lb": [c["l"], c["b"]], "d_lit_pc": c["d"], "xyz": c["xyz_peak"], "ref": c["ref"]} for c in checks],
        "citation": CITATION, "doi": DOI, "license": "CC BY 4.0",
    }
    (a.out / "meta.json").write_text(json.dumps(meta, indent=1) + "\n")
    prov = {
        "layer": "dust",
        "built_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "script": "scripts/build_dust.py",
        "source": {"record": f"https://zenodo.org/records/{RECORD}", "doi": src.get("doi"), "version": src.get("version"),
                   "license": src.get("license"), "file": KEY, "url": src["url"], "size": src["size"],
                   "md5_zenodo": src["checksum"], "md5": src["md5"], "sha256": src["sha256"], "verified_utc": src.get("verified_utc")},
        "overlay": {"radcliffe_wave": "Alves et al. 2020, Nature 578, 237; best-fit model, Harvard Dataverse doi:10.7910/DVN/OE51SZ (CC0), "
                    "file Radcliffe_Wave_Best_Fit.tab, md5 248936d0dd29d46ddf77b22bfd7290e0"},
        "healpix": "scripts/healpix_nest.py (numpy port of healpix_base NESTED loc2pix/pix2loc), checked against healpy 1.20.1: 0/2e6 mismatches",
        "citation": CITATION, "doi": DOI,
        "checks": {"clouds": checks, "local_bubble": {"median_Av_per_kpc_r_lt_100": round(bub, 4), "median_Av_per_kpc_150_300": round(shell, 4), "wall_b0": wall},
                   "radcliffe_wave": rw},
    }
    (a.out / "PROVENANCE.json").write_text(json.dumps(prov, indent=1) + "\n")
    print(f"wrote {a.out}: {fine_u8.size + aux.size:,} B of textures; figures: scripts/plot_dust_check.py", flush=True)


if __name__ == "__main__":
    main()
