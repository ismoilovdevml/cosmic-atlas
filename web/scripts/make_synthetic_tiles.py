#!/usr/bin/env python3
"""Emit contract-compliant synthetic octree tiles for viewer development.

Writes data/tiles/synthetic-stars/ and data/tiles/synthetic-galaxies/ following
docs/data-contract.md sections 1 and 3 (heliocentric Galactic frame, parsec, 16-byte
render records, 16-byte pick records, Potree-style node names, importance-sorted
additive LOD).

The point distributions are synthetic. They are shaped to look plausible, not to be used
for science:
  * stars: thin + thick exponential disc inside a 1 kpc sphere, a weak gradient toward
    the Galactic Centre, a few dozen open clusters, a crude Gaia G-band luminosity
    function, BP-RP from an approximate main-sequence relation, Gaia-like G < 20 cut.
  * galaxies: a jittered lattice of nodes ("clusters") joined by randomly kept edges
    ("filaments") plus a field population, Schechter luminosity function, a flux limit
    r < 19.5, comoving distances from astropy Planck18, Galactic zone of avoidance.

Usage (from the repo root or web/):
    .venv/bin/python web/scripts/make_synthetic_tiles.py [--stars N] [--galaxies N] [--seed S]
"""

from __future__ import annotations

import argparse
import json
import shutil
import time
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[2]
TILES = REPO / "data" / "tiles"
NODE_CAPACITY = 20_000
MAX_DEPTH = 22


# --------------------------------------------------------------------------- octree


def build_octree(pos: np.ndarray, order: np.ndarray, half: float, cap: int):
    """Potree-style insertion of points already sorted by importance.

    pos   (N,3) float64, heliocentric Galactic pc
    order indices of pos sorted by descending importance
    Returns a list of (name, center, half, indices) in breadth-first order.
    Each node keeps the first `cap` points that fall into it; the rest descend to the
    children, split by (x>=cx)<<2 | (y>=cy)<<1 | (z>=cz) with the original order kept.
    """
    out = []
    stack = [("r", np.zeros(3), half, order)]
    while stack:
        name, c, h, idx = stack.pop()
        depth = len(name) - 1
        if len(idx) <= cap or depth >= MAX_DEPTH:
            out.append((name, c, h, idx))
            continue
        keep, rest = idx[:cap], idx[cap:]
        out.append((name, c, h, keep))
        p = pos[rest]
        child = ((p[:, 0] >= c[0]).astype(np.int8) << 2) | ((p[:, 1] >= c[1]).astype(np.int8) << 1) | (
            p[:, 2] >= c[2]
        ).astype(np.int8)
        for k in range(7, -1, -1):
            sel = rest[child == k]  # boolean mask keeps importance order
            if len(sel) == 0:
                continue
            off = np.array([(k >> 2) & 1, (k >> 1) & 1, k & 1], dtype=float) * 2 - 1
            stack.append((name + str(k), c + off * h / 2, h / 2, sel))
    out.sort(key=lambda n: (len(n[0]), n[0]))
    return out


def write_layer(layer, title, pos, rgb, lum, ids, mag, color, importance, half, id_prefix, extra):
    d = TILES / layer
    if d.exists():
        shutil.rmtree(d)
    (d / "n").mkdir(parents=True)
    order = np.argsort(-importance, kind="stable")
    nodes = build_octree(pos, order, half, NODE_CAPACITY)
    names = {n[0] for n in nodes}
    meta_nodes = []
    for name, c, h, idx in nodes:
        mask = 0
        for k in range(8):
            if name + str(k) in names:
                mask |= 1 << k
        rec = np.zeros(len(idx), dtype=[("xyz", "<f4", 3), ("rgb", "u1", 3), ("lum", "u1")])
        rec["xyz"] = (pos[idx] - c).astype("<f4")
        rec["rgb"] = rgb[idx]
        rec["lum"] = lum[idx]
        assert rec.itemsize == 16
        rec.tofile(d / "n" / f"{name}.bin")
        ext = np.zeros(len(idx), dtype=[("id", "<u8"), ("mag", "<f4"), ("color", "<f4")])
        ext["id"], ext["mag"], ext["color"] = ids[idx], mag[idx], color[idx]
        assert ext.itemsize == 16
        ext.tofile(d / "n" / f"{name}.ext.bin")
        meta_nodes.append(
            {"name": name, "center": [float(v) for v in c], "half": float(h), "count": int(len(idx)), "children": mask}
        )
    meta = {
        "layer": layer,
        "title": title,
        "unit": "pc",
        "frame": "galactic-helio",
        "count": int(len(pos)),
        "nodeCapacity": NODE_CAPACITY,
        "record": "xyz_f32_rgb_u8_lum_u8",
        "bytesPerPoint": 16,
        "extRecord": "id_u64_mag_f32_color_f32",
        "extBytesPerPoint": 16,
        "idPrefix": id_prefix,
        "synthetic": True,
        **extra,
        "nodes": meta_nodes,
    }
    (d / "meta.json").write_text(json.dumps(meta, separators=(",", ":")))
    depth = max(len(n[0]) for n in nodes) - 1
    print(f"  {layer}: {len(pos):,} points, {len(nodes)} nodes, depth {depth}")


# --------------------------------------------------------------------------- colour


def bp_rp_to_teff(c):
    """Approximate Teff from Gaia BP-RP (dwarf colour-Teff polynomial, clamped)."""
    c = np.clip(c, -0.4, 4.5)
    theta = 0.4929 + 0.5092 * c - 0.0353 * c**2
    return np.clip(5040.0 / theta, 2400.0, 40000.0)


def blackbody_srgb(teff):
    """Approximate sRGB of a blackbody (Tanner Helland fit to the Charity table)."""
    t = teff / 100.0
    r = np.where(t <= 66, 255.0, 329.698727446 * np.power(np.maximum(t - 60, 1e-6), -0.1332047592))
    g = np.where(
        t <= 66,
        99.4708025861 * np.log(np.maximum(t, 1e-6)) - 161.1195681661,
        288.1221695283 * np.power(np.maximum(t - 60, 1e-6), -0.0755148492),
    )
    b = np.where(
        t >= 66, 255.0, np.where(t <= 19, 0.0, 138.5177312231 * np.log(np.maximum(t - 10, 1e-6)) - 305.0447927307)
    )
    rgb = np.stack([r, g, b], axis=1)
    return np.clip(rgb, 0, 255).astype(np.uint8)


def redshift_ramp(z):
    """Galaxy colour ramp by redshift (contract: 'redshift ramp for galaxies')."""
    stops_z = np.array([0.0, 0.05, 0.15, 0.3, 0.5, 0.8])
    stops = np.array(
        [[190, 210, 255], [225, 232, 255], [255, 244, 228], [255, 214, 170], [255, 170, 120], [240, 120, 100]], float
    )
    out = np.stack([np.interp(z, stops_z, stops[:, i]) for i in range(3)], axis=1)
    return np.clip(out, 0, 255).astype(np.uint8)


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
    rgb = blackbody_srgb(bp_rp_to_teff(col))
    lum = np.clip(np.round((20.0 - M) * 10.0), 0, 255).astype(np.uint8)
    ids = rng.choice(2**62, len(pos), replace=False).astype(np.uint64)
    print(f"  stars generated in {time.time() - t0:.1f}s")
    return pos, rgb, lum, ids, mag.astype(np.float32), col.astype(np.float32), lum.astype(float) + rng.random(len(pos))


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
    zobs = z + rng.normal(0, 0.0002, len(z))
    rgb = redshift_ramp(z)
    lum = np.clip(np.round((-14.0 - M) * 20.0), 0, 255).astype(np.uint8)
    ids = rng.choice(2**62, len(pos), replace=False).astype(np.uint64)
    print(f"  galaxies generated in {time.time() - t0:.1f}s ({len(edges):,} filaments)")
    return pos, rgb, lum, ids, mag.astype(np.float32), zobs.astype(np.float32), -z


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--stars", type=int, default=3_600_000)
    ap.add_argument("--galaxies", type=int, default=1_800_000)
    ap.add_argument("--seed", type=int, default=20261113)
    a = ap.parse_args()
    rng = np.random.default_rng(a.seed)
    print("synthetic stars")
    pos, rgb, lum, ids, mag, col, imp = make_stars(rng, a.stars)
    write_layer("synthetic-stars", "Synthetic stars (dev data, not real)", pos, rgb, lum, ids, mag, col, imp,
                1000.0, "SYN-S ", {"kind": "stars", "band": "G"})
    print("synthetic galaxies")
    pos, rgb, lum, ids, mag, zc, imp = make_galaxies(rng, a.galaxies)
    write_layer("synthetic-galaxies", "Synthetic galaxies (dev data, not real)", pos, rgb, lum, ids, mag, zc, imp,
                2.5e9, "SYN-G ", {"kind": "galaxies", "band": "r"})


if __name__ == "__main__":
    main()
