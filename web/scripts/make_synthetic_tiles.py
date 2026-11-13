#!/usr/bin/env python3
"""Synthetic development data for the viewer, written as contract section 2 raw tables and turned
into tiles by the project's single tile writer, pipeline/build_tiles.py.

Writes data/raw/synthetic-{stars,galaxies}/synthetic.parquet (+ PROVENANCE.json), then runs
    .venv/bin/python pipeline/build_tiles.py synthetic-stars    --order lum    --kind-model star
    .venv/bin/python pipeline/build_tiles.py synthetic-galaxies --order random --kind-model galaxy
so data/tiles/synthetic-* follow docs/data-contract.md exactly (24-byte pick records, subtree `agg`).

The point distributions are synthetic. They are shaped to look plausible, not to be used
for science:
  * stars: thin + thick exponential disc inside a 1 kpc sphere, a weak gradient toward
    the Galactic Centre, a few dozen open clusters, a crude Gaia G-band luminosity
    function, BP-RP from an approximate main-sequence relation, Gaia-like G < 20 cut.
    Distance percentiles from a Gaia-like parallax error, sigma_plx = 0.02 mas at G <= 15
    growing as 10^(0.2 (G - 15)), mapped through d = 1/plx (asymmetric 16/84 %).
  * galaxies: a jittered lattice of nodes ("clusters") joined by randomly kept edges
    ("filaments") plus a field population, Schechter luminosity function, a flux limit
    r < 19.5, comoving distances from astropy Planck18, Galactic zone of avoidance.
    Distance percentiles from a 300 km/s peculiar-velocity + 1e-4 redshift error.

Usage (from the repo root or web/):
    .venv/bin/python web/scripts/make_synthetic_tiles.py [--stars N] [--galaxies N] [--seed S]
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

REPO = Path(__file__).resolve().parents[2]
RAW = REPO / "data" / "raw"
PY = REPO / ".venv" / "bin" / "python"

# ICRS -> Galactic rotation (astropy, same matrix as pipeline/build_tiles.py); Galactic -> ICRS is M^T
ICRS_TO_GAL = np.array([
    [-0.05487565771259165, -0.8734370519556157, -0.48383507361671546],
    [0.49410943719272676, -0.4448297212232951, 0.7469821839866675],
    [-0.8676661375596576, -0.19807633727300059, 0.4559838136873016],
])


def gal_to_radec(pos):
    """heliocentric Galactic xyz (pc) -> ICRS ra, dec (deg), distance (pc)"""
    icrs = pos @ ICRS_TO_GAL  # row-vector form of M^T @ v
    d = np.linalg.norm(icrs, axis=1)
    ra = np.degrees(np.arctan2(icrs[:, 1], icrs[:, 0])) % 360.0
    dec = np.degrees(np.arcsin(np.clip(icrs[:, 2] / np.maximum(d, 1e-30), -1, 1)))
    return ra, dec, d


# --------------------------------------------------------------------------- stars


def make_stars(rng, n_target):
    t0 = time.time()
    R = 1000.0
    n_disc = int(n_target * 0.97)
    # thin (h=300 pc) and thick (h=900 pc) discs, sech-ish via Laplace, weak radial gradient
    n_draw = int(n_disc * 2.4)
    thick = rng.random(n_draw) < 0.12
    h = np.where(thick, 900.0, 300.0)
    z = rng.laplace(0, h)
    x = rng.uniform(-R, R, n_draw)
    y = rng.uniform(-R, R, n_draw)
    keep = (x * x + y * y + z * z) < R * R
    # density rises toward the GC with disc scale length 2.6 kpc
    w = np.exp(x / 2600.0)
    keep &= rng.random(n_draw) < w / np.exp(R / 2600.0)
    p = np.stack([x[keep], y[keep], z[keep]], 1)[:n_disc]
    # open clusters
    nc = 40
    cl_c = np.stack([rng.uniform(-900, 900, nc), rng.uniform(-900, 900, nc), rng.normal(0, 60, nc)], 1)
    cl_n = rng.integers(300, 4000, nc)
    cl_s = rng.uniform(1.5, 8.0, nc)
    cl = [cl_c[i] + rng.normal(0, cl_s[i], (cl_n[i], 3)) for i in range(nc)]
    cl.append(np.array([[47.0, 0.0, 17.0]]) + rng.normal(0, 3.0, (800, 3)))  # a Hyades-like group
    pc = np.concatenate(cl)
    pc = pc[np.linalg.norm(pc, axis=1) < R]
    in_cluster = np.concatenate([np.zeros(len(p), bool), np.ones(len(pc), bool)])
    pos = np.concatenate([p, pc])
    n = len(pos)

    # absolute G magnitude mixture
    kind = rng.choice(5, n, p=[0.78, 0.16, 0.035, 0.01, 0.015])  # M dwarf, FGK, giant, OB, WD
    M = np.empty(n)
    M[kind == 0] = rng.normal(10.0, 2.2, (kind == 0).sum())
    M[kind == 1] = rng.normal(4.2, 1.4, (kind == 1).sum())
    M[kind == 2] = rng.normal(0.8, 0.9, (kind == 2).sum())
    M[kind == 3] = rng.normal(-2.0, 1.3, (kind == 3).sum())
    M[kind == 4] = rng.normal(12.0, 0.9, (kind == 4).sum())
    M = np.clip(M, -7, 17)
    M[in_cluster] = np.clip(rng.normal(8.0, 3.0, in_cluster.sum()), -3, 15)
    ms_M = np.array([-5, -3, -1, 1, 3, 4.6, 6, 8, 10, 12, 14, 17])
    ms_c = np.array([-0.35, -0.25, -0.1, 0.15, 0.55, 0.82, 1.05, 1.6, 2.3, 2.9, 3.4, 4.2])
    col = np.interp(M, ms_M, ms_c) + rng.normal(0, 0.06, n)
    giants = kind == 2
    col[giants] = rng.normal(1.25, 0.18, giants.sum())
    wd = kind == 4
    col[wd] = rng.normal(0.15, 0.3, wd.sum())

    d = np.linalg.norm(pos, axis=1)
    mag = M + 5 * np.log10(np.maximum(d, 1e-3) / 10.0)
    vis = mag < 20.0
    pos, M, col, mag = pos[vis], M[vis], col[vis], mag[vis]
    d = np.linalg.norm(pos, axis=1)
    # Gaia-like parallax error -> asymmetric 16/84 % distance range
    plx = 1000.0 / np.maximum(d, 1e-3)  # mas
    s_plx = 0.02 * 10 ** (0.2 * np.maximum(mag - 15.0, 0.0)) * rng.lognormal(0, 0.25, len(d))
    lo = 1000.0 / (plx + s_plx)
    hi = np.where(plx - s_plx > 0.05, 1000.0 / np.maximum(plx - s_plx, 1e-9), np.nan)  # no upper bound
    ids = rng.choice(2**62, len(pos), replace=False).astype(np.uint64)
    print(f"  stars generated in {time.time() - t0:.1f}s")
    ra, dec, dist = gal_to_radec(pos)
    return {
        "id": np.char.add("SYN-S ", ids.astype(str)), "source_id": ids, "ra": ra, "dec": dec,
        "dist_pc": dist, "dist_lo_pc": lo, "dist_hi_pc": hi, "mag": mag.astype(np.float32),
        "color": col.astype(np.float32), "kind": np.full(len(ids), "star"),
    }


# --------------------------------------------------------------------------- galaxies


def comoving_table():
    """Planck18 comoving distance (pc) on a z grid, integrated with numpy (no scipy)."""
    from astropy.cosmology import Planck18

    zz = np.linspace(0, 1.2, 24001)
    inv = Planck18.inv_efunc(zz)
    dh = Planck18.hubble_distance.to("pc").value
    dc = dh * np.concatenate([[0], np.cumsum((inv[1:] + inv[:-1]) / 2 * np.diff(zz))])
    return zz, dc


def schechter_sampler(rng, Mstar=-21.5, alpha=-1.2, Mbright=-24.5, Mfaint=-16.0):
    Mg = np.linspace(Mbright, Mfaint, 4001)
    x = 10 ** (-0.4 * (Mg - Mstar))
    phi = x ** (alpha + 1) * np.exp(-x)
    cdf = np.cumsum(phi)
    cdf /= cdf[-1]

    def frac_brighter(Mlim):
        return np.interp(Mlim, Mg, cdf, left=0.0, right=1.0)

    def draw(Mlim):
        u = rng.random(len(Mlim)) * frac_brighter(Mlim)
        return np.interp(u, cdf, Mg)

    return frac_brighter, draw


def make_galaxies(rng, n_target):
    t0 = time.time()
    zz, dc = comoving_table()
    Rmax = 2.5e9
    frac_brighter, draw_M = schechter_sampler(rng)
    rlim = 19.5

    def visible_fraction(d):
        z = np.interp(d, dc, zz)
        dl = d * (1 + z)
        Mlim = rlim - 5 * np.log10(np.maximum(dl, 10.0) / 10.0)
        return frac_brighter(Mlim)

    # jittered lattice of nodes
    S = 45e6
    k = int(np.ceil(Rmax / S))
    g = np.arange(-k, k + 1)
    I, J, K = np.meshgrid(g, g, g, indexing="ij")
    lat = np.stack([I.ravel(), J.ravel(), K.ravel()], 1)
    node = (lat + rng.uniform(-0.42, 0.42, lat.shape)) * S
    alive = (np.linalg.norm(node, axis=1) < Rmax + S) & (rng.random(len(node)) < 0.8)
    rich = np.where(alive, (rng.pareto(1.3, len(node)) + 1) * 40, 0)  # intrinsic galaxies M<-16
    n1 = 2 * k + 1

    def flat(a):
        return ((a[:, 0] + k) * n1 + (a[:, 1] + k)) * n1 + (a[:, 2] + k)

    edges = []
    for dvec, prob in [((1, 0, 0), 0.5), ((0, 1, 0), 0.5), ((0, 0, 1), 0.5), ((1, 1, 0), 0.18), ((1, 0, 1), 0.18),
                       ((0, 1, 1), 0.18), ((1, -1, 0), 0.18), ((1, 1, 1), 0.1)]:
        nb = lat + np.array(dvec)
        ok = np.all(np.abs(nb) <= k, axis=1)
        a = np.nonzero(ok)[0]
        b = flat(nb[ok])
        sel = alive[a] & alive[b] & (rng.random(len(a)) < prob)
        edges.append(np.stack([a[sel], b[sel]], 1))
    edges = np.concatenate(edges)

    parts = []
    # cluster members: Poisson(rich * f(d)), Gaussian sigma 1.5 Mpc
    d_node = np.linalg.norm(node, axis=1)
    lam_c = rich * visible_fraction(d_node)
    # filament members: 30 per Mpc intrinsic, scaled by mean richness of the ends
    seg = node[edges[:, 1]] - node[edges[:, 0]]
    seg_len = np.linalg.norm(seg, axis=1)
    mid = (node[edges[:, 0]] + node[edges[:, 1]]) / 2
    w_f = np.sqrt(rich[edges[:, 0]] * rich[edges[:, 1]]) / 60.0
    lam_f = seg_len / 1e6 * 6.0 * np.clip(w_f, 0.3, 4) * visible_fraction(np.linalg.norm(mid, axis=1))
    # field: uniform, ~6% of the total
    # scale all expectations to hit n_target
    tot = lam_c.sum() + lam_f.sum()
    scale = n_target * 0.94 / tot
    nc = rng.poisson(lam_c * scale)
    ci = np.repeat(np.arange(len(node)), nc)
    parts.append(node[ci] + rng.normal(0, 1.0e6, (len(ci), 3)))
    nf = rng.poisson(lam_f * scale)
    fi = np.repeat(np.arange(len(edges)), nf)
    t = rng.random(len(fi))
    parts.append(node[edges[fi, 0]] + seg[fi] * t[:, None] + rng.normal(0, 1.2e6, (len(fi), 3)))
    # field population: sample radius with p(d) ~ d^2 f(d)
    rg = np.linspace(1e5, Rmax, 5000)
    pdf = rg**2 * visible_fraction(rg)
    cdf = np.cumsum(pdf)
    cdf /= cdf[-1]
    n_field = int(n_target * 0.06)
    rr = np.interp(rng.random(n_field), cdf, rg)
    v = rng.normal(size=(n_field, 3))
    parts.append(v / np.linalg.norm(v, axis=1)[:, None] * rr[:, None])
    pos = np.concatenate(parts)

    d = np.linalg.norm(pos, axis=1)
    b = np.degrees(np.arcsin(np.clip(pos[:, 2] / np.maximum(d, 1), -1, 1)))
    keep = (d < Rmax) & (d > 1.5e6) & (np.abs(b) > 8.0 + 4 * rng.random(len(pos)))
    pos, d = pos[keep], d[keep]
    z = np.interp(d, dc, zz)
    dl = d * (1 + z)
    Mlim = rlim - 5 * np.log10(dl / 10.0)
    M = draw_M(Mlim)
    mag = M + 5 * np.log10(dl / 10.0)
    zobs = z + rng.normal(0, 1e-4, len(z))
    # distance range: 300 km/s peculiar velocity + 1e-4 redshift error, through dD/dz = c/H(z)
    dz = np.hypot(300.0 / 299792.458, 1e-4)
    lo = np.interp(np.maximum(z - dz, 0.0), zz, dc)
    hi = np.interp(z + dz, zz, dc)
    ids = rng.choice(2**62, len(pos), replace=False).astype(np.uint64)
    print(f"  galaxies generated in {time.time() - t0:.1f}s ({len(edges):,} filaments)")
    ra, dec, dist = gal_to_radec(pos)
    return {
        "id": np.char.add("SYN-G ", ids.astype(str)), "targetid": ids, "ra": ra, "dec": dec,
        "dist_pc": dist, "dist_lo_pc": lo, "dist_hi_pc": hi, "mag": mag.astype(np.float32),
        "color": np.full(len(ids), np.nan, np.float32), "kind": np.full(len(ids), "galaxy"),
        "z": zobs.astype(np.float64),
    }


def write_raw(layer: str, cols: dict, note: str):
    out = RAW / layer
    out.mkdir(parents=True, exist_ok=True)
    pq.write_table(pa.table(cols), out / "synthetic.parquet")
    (out / "PROVENANCE.json").write_text(json.dumps({
        "layer": layer, "synthetic": True, "generator": "web/scripts/make_synthetic_tiles.py",
        "utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "rows": int(len(cols["ra"])),
        "note": note, "citation": "none (synthetic development data, not observations)",
    }, indent=1))
    print(f"  {layer}: {len(cols['ra']):,} rows -> {out / 'synthetic.parquet'}")


def build(layer: str, *args: str):
    cmd = [str(PY), str(REPO / "pipeline" / "build_tiles.py"), layer, *args]
    print("  $", " ".join(cmd[1:]))
    subprocess.run(cmd, check=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--stars", type=int, default=3_600_000)
    ap.add_argument("--galaxies", type=int, default=1_800_000)
    ap.add_argument("--seed", type=int, default=20261113)
    ap.add_argument("--no-build", action="store_true", help="only write the raw Parquet")
    a = ap.parse_args()
    rng = np.random.default_rng(a.seed)
    print("synthetic stars")
    write_raw("synthetic-stars", make_stars(rng, a.stars), "Gaia-like disc + clusters inside 1 kpc")
    print("synthetic galaxies")
    write_raw("synthetic-galaxies", make_galaxies(rng, a.galaxies), "lattice cosmic web, flux-limited r < 19.5")
    if a.no_build:
        return
    build("synthetic-stars", "--order", "lum", "--kind-model", "star",
          "--title", "Synthetic stars (dev data, not real)", "--id-prefix", "SYN-S ")
    build("synthetic-galaxies", "--order", "random", "--kind-model", "galaxy",
          "--title", "Synthetic galaxies (dev data, not real)", "--id-prefix", "SYN-G ")


if __name__ == "__main__":
    sys.exit(main())
