"""Build octree point tiles for one layer (format: docs/data-contract.md, section 3).

Input : data/raw/<layer>/*.parquet with contract columns (ra, dec, dist_pc, mag, color, kind, id ...)
Output: data/tiles/<layer>/meta.json + n/<node>.bin (render) + n/<node>.ext.bin (pick)

Algorithm: points are ordered by importance (stars: luminosity, galaxies: seeded shuffle), then a
top-down split: each node keeps the first `capacity` points of its (still importance-ordered) list and
hands the rest to its 8 children by octant. Stable sorts keep the importance order inside children,
so the LOD is additive (parent + children drawn together).

Usage:
  python pipeline/build_tiles.py stars-gaia --order lum --kind-model star
  python pipeline/build_tiles.py galaxies-desi --order random --kind-model galaxy
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
import time
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parents[1]

# ICRS -> Galactic rotation, astropy 7 (see data-contract.md). xyz_gal = M @ xyz_icrs
ICRS_TO_GAL = np.array([
    [-0.05487565771259165, -0.8734370519556157, -0.48383507361671546],
    [0.49410943719272676, -0.4448297212232951, 0.7469821839866675],
    [-0.8676661375596576, -0.19807633727300059, 0.4559838136873016],
])

RENDER_DTYPE = np.dtype([("x", "<f4"), ("y", "<f4"), ("z", "<f4"),
                         ("r", "u1"), ("g", "u1"), ("b", "u1"), ("lum", "u1")])
EXT_DTYPE = np.dtype([("id", "<u8"), ("mag", "<f4"), ("color", "<f4")])
assert RENDER_DTYPE.itemsize == 16 and EXT_DTYPE.itemsize == 16

MAX_DEPTH = 24


# --------------------------------------------------------------------------- coordinates
def radec_dist_to_galactic_xyz(ra_deg, dec_deg, dist_pc) -> np.ndarray:
    """Heliocentric Galactic Cartesian (pc), shape (N, 3), float64."""
    ra = np.radians(np.asarray(ra_deg, dtype=np.float64))
    dec = np.radians(np.asarray(dec_deg, dtype=np.float64))
    d = np.asarray(dist_pc, dtype=np.float64)
    cd = np.cos(dec)
    icrs = np.stack([cd * np.cos(ra), cd * np.sin(ra), np.sin(dec)], axis=1) * d[:, None]
    return icrs @ ICRS_TO_GAL.T


# --------------------------------------------------------------------------- colours
def _cie_cmf(lam_nm: np.ndarray) -> np.ndarray:
    """CIE 1931 2-deg colour matching functions, multi-lobe Gaussian fit
    (Wyman, Sloan & Shirley 2013, JCGT 2(2)). Returns (len(lam), 3)."""
    def g(x, mu, s1, s2):
        s = np.where(x < mu, s1, s2)
        return np.exp(-0.5 * ((x - mu) / s) ** 2)
    x = 1.056 * g(lam_nm, 599.8, 37.9, 31.0) + 0.362 * g(lam_nm, 442.0, 16.0, 26.7) \
        - 0.065 * g(lam_nm, 501.1, 20.4, 26.2)
    y = 0.821 * g(lam_nm, 568.8, 46.9, 40.5) + 0.286 * g(lam_nm, 530.9, 16.3, 31.1)
    z = 1.217 * g(lam_nm, 437.0, 11.8, 36.0) + 0.681 * g(lam_nm, 459.0, 26.0, 13.8)
    return np.stack([x, y, z], axis=1)


def blackbody_srgb(teff: np.ndarray) -> np.ndarray:
    """Perceived colour of a blackbody (normalised so the brightest channel = 1), sRGB-encoded."""
    lam = np.linspace(380, 780, 81)  # nm
    cmf = _cie_cmf(lam)
    h, c, k = 6.62607015e-34, 2.99792458e8, 1.380649e-23
    lm = lam * 1e-9
    t = np.asarray(teff, dtype=np.float64)[:, None]
    planck = 1.0 / (lm ** 5 * np.expm1(h * c / (lm * k * t)))
    xyz = planck @ cmf
    m = np.array([[3.2406, -1.5372, -0.4986], [-0.9689, 1.8758, 0.0415], [0.0557, -0.2040, 1.0570]])
    rgb = np.clip(xyz @ m.T, 0, None)
    rgb /= rgb.max(axis=1, keepdims=True)
    return np.where(rgb <= 0.0031308, 12.92 * rgb, 1.055 * rgb ** (1 / 2.4) - 0.055)


# Approximate Gaia BP-RP -> Teff for dwarfs, read off the Pecaut & Mamajek (2013, ApJS 208, 9;
# online table v2022) mean dwarf sequence. Used ONLY for display colour, never for science.
_BPRP_TEFF = np.array([
    (-0.40, 40000), (-0.30, 31000), (-0.13, 15700), (0.00, 9700), (0.18, 8180), (0.38, 7220),
    (0.59, 6510), (0.74, 5920), (0.84, 5660), (0.97, 5280), (1.43, 4440), (1.84, 3850),
    (2.18, 3550), (2.73, 3210), (3.16, 3060), (3.60, 2810), (4.30, 2570), (5.00, 2300),
])


def bprp_to_teff(bp_rp: np.ndarray) -> np.ndarray:
    c = np.asarray(bp_rp, dtype=np.float64)
    lt = np.interp(c, _BPRP_TEFF[:, 0], np.log10(_BPRP_TEFF[:, 1]))
    return np.where(np.isfinite(c), 10 ** lt, 5800.0)


def star_rgb(bp_rp: np.ndarray) -> np.ndarray:
    # blackbody colours via a 1 K-resolution-equivalent lookup table (fast for 1e7+ points)
    grid = np.geomspace(2000, 40000, 512)
    table = blackbody_srgb(grid)
    teff = bprp_to_teff(bp_rp)
    idx = np.clip(np.searchsorted(grid, teff), 0, len(grid) - 1)
    return np.round(table[idx] * 255).astype(np.uint8)


def galaxy_rgb(z: np.ndarray, kind: np.ndarray) -> np.ndarray:
    """Muted redshift ramp: warm ivory (z=0) -> rose -> violet (z>=1.5); QSOs pale cyan."""
    stops_z = np.array([0.0, 0.1, 0.4, 0.8, 1.5])
    stops = np.array([[255, 236, 205], [255, 205, 170], [235, 150, 160], [175, 130, 215], [120, 120, 235]], float)
    zz = np.nan_to_num(np.asarray(z, dtype=np.float64), nan=0.05)
    rgb = np.stack([np.interp(zz, stops_z, stops[:, i]) for i in range(3)], axis=1)
    rgb[np.asarray(kind) == "qso"] = (150, 230, 255)
    return np.round(rgb).astype(np.uint8)


# --------------------------------------------------------------------------- brightness code
def lum_code(mag, dist_pc, model: str) -> np.ndarray:
    mag = np.asarray(mag, dtype=np.float64)
    dm = 5.0 * np.log10(np.maximum(np.asarray(dist_pc, dtype=np.float64), 1e-6) / 10.0)
    m_abs = mag - dm
    if model == "star":  # no extinction correction (display only)
        code = (20.0 - m_abs) * 10.0
        default = (20.0 - 5.0) * 10.0
    else:
        code = (-14.0 - m_abs) * 20.0
        default = (-14.0 + 19.0) * 20.0  # unknown magnitude -> typical M ~ -19
    code = np.where(np.isfinite(code), code, default)
    return np.clip(np.round(code), 0, 255).astype(np.uint8)


# --------------------------------------------------------------------------- ids
_DIGITS = re.compile(r"(\d+)\s*$")


def numeric_ids(table_cols: dict) -> np.ndarray:
    for col in ("source_id", "targetid", "numeric_id"):
        if col in table_cols:
            v = np.asarray(table_cols[col], dtype=np.float64 if np.asarray(table_cols[col]).dtype == object else None)
            if v.dtype.kind in "iu":
                return v.astype(np.uint64)
            raise SystemExit(f"column {col} has nulls/non-integers: build mixed-id inputs as separate layers")
    out = np.empty(len(table_cols["id"]), dtype=np.uint64)
    for i, s in enumerate(table_cols["id"]):
        m = _DIGITS.search(str(s))
        if m and len(m.group(1)) <= 19:
            out[i] = np.uint64(int(m.group(1)))
        else:
            out[i] = np.frombuffer(hashlib.blake2b(str(s).encode(), digest_size=8).digest(), "<u8")[0]
    return out


# --------------------------------------------------------------------------- octree
def build_octree(xyz: np.ndarray, capacity: int):
    """Return list of (name, center, half, indices) with indices into xyz.
    `xyz` must already be in importance order."""
    span = float(np.max(np.abs(xyz))) if len(xyz) else 1.0
    half = 2.0 ** np.ceil(np.log2(max(span, 1e-3) * 1.0001))
    nodes = []
    stack = [("r", np.zeros(3), half, np.arange(len(xyz), dtype=np.int64))]
    while stack:
        name, center, h, idx = stack.pop()
        depth = len(name) - 1
        if len(idx) <= capacity or depth >= MAX_DEPTH:
            nodes.append((name, center, h, idx))
            continue
        keep, rest = idx[:capacity], idx[capacity:]
        nodes.append((name, center, h, keep))
        p = xyz[rest]
        code = ((p[:, 0] >= center[0]).astype(np.int8) << 2) | \
               ((p[:, 1] >= center[1]).astype(np.int8) << 1) | \
               (p[:, 2] >= center[2]).astype(np.int8)
        order = np.argsort(code, kind="stable")
        code_sorted = code[order]
        rest_sorted = rest[order]
        bounds = np.searchsorted(code_sorted, np.arange(9))
        for c in range(8):
            a, b = bounds[c], bounds[c + 1]
            if b > a:
                off = np.array([1 if c & 4 else -1, 1 if c & 2 else -1, 1 if c & 1 else -1]) * (h / 2)
                stack.append((name + str(c), center + off, h / 2, rest_sorted[a:b]))
    return nodes


# --------------------------------------------------------------------------- main
def load_layer(layer: str, files: list[Path]):
    cols_wanted = ["id", "ra", "dec", "dist_pc", "mag", "color", "kind", "source_id", "targetid", "z"]
    parts = []
    for f in files:
        schema = pq.read_schema(f)
        cols = [c for c in cols_wanted if c in schema.names]
        parts.append(pq.read_table(f, columns=cols))
    import pyarrow as pa
    tab = pa.concat_tables(parts, promote_options="default")
    out = {c: tab.column(c).to_numpy(zero_copy_only=False) for c in tab.column_names}
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("layer")
    ap.add_argument("--src", help="raw dir (default data/raw/<layer>)")
    ap.add_argument("--out", help="tile dir (default data/tiles/<layer>)")
    ap.add_argument("--order", choices=["lum", "random"], default="lum")
    ap.add_argument("--kind-model", choices=["star", "galaxy"], default="star")
    ap.add_argument("--capacity", type=int, default=20000)
    ap.add_argument("--title", default=None)
    ap.add_argument("--id-prefix", default="")
    ap.add_argument("--max-dist-pc", type=float, default=None)
    ap.add_argument("--seed", type=int, default=20261113)
    ap.add_argument("--glob", default="*.parquet", help="input file pattern inside --src")
    ap.add_argument("--exclude", action="append", default=[], help="glob(s) to skip, repeatable")
    a = ap.parse_args(argv)

    src = Path(a.src) if a.src else ROOT / "data/raw" / a.layer
    out = Path(a.out) if a.out else ROOT / "data/tiles" / a.layer
    files = sorted(f for f in src.glob(a.glob) if not any(f.match(x) for x in a.exclude))
    if not files:
        sys.exit(f"no parquet in {src}")
    t0 = time.time()
    cols = load_layer(a.layer, files)
    n0 = len(cols["ra"])

    dist = np.asarray(cols["dist_pc"], dtype=np.float64)
    ok = np.isfinite(dist) & (dist > 0) & np.isfinite(cols["ra"]) & np.isfinite(cols["dec"])
    if a.max_dist_pc:
        ok &= dist <= a.max_dist_pc
    cols = {k: np.asarray(v)[ok] for k, v in cols.items()}
    dist = dist[ok]
    n = len(dist)
    print(f"[{a.layer}] {len(files)} files, {n0} rows, {n} with valid distance ({time.time()-t0:.1f}s)")

    xyz = radec_dist_to_galactic_xyz(cols["ra"], cols["dec"], dist)
    mag = np.asarray(cols.get("mag", np.full(n, np.nan)), dtype=np.float64)
    kind = np.asarray(cols.get("kind", np.full(n, a.kind_model)), dtype=object).astype(str)
    lum = lum_code(mag, dist, a.kind_model)
    if a.kind_model == "star":
        color = np.asarray(cols.get("color", np.full(n, np.nan)), dtype=np.float64)
        rgb = star_rgb(color)
        ext_color = color
    else:
        z = np.asarray(cols.get("z", np.full(n, np.nan)), dtype=np.float64)
        rgb = galaxy_rgb(z, kind)
        ext_color = z
    ids = numeric_ids(cols)

    rng = np.random.default_rng(a.seed)
    if a.order == "lum":
        # brightest first; small jitter breaks ties without spatial bias
        order = np.argsort(-(lum.astype(np.float64) + rng.random(n)), kind="stable")
    else:
        order = rng.permutation(n)
    xyz, rgb, lum, ids, mag, ext_color = xyz[order], rgb[order], lum[order], ids[order], mag[order], ext_color[order]
    print(f"[{a.layer}] colours/ordering done ({time.time()-t0:.1f}s)")

    nodes = build_octree(xyz, a.capacity)
    print(f"[{a.layer}] octree: {len(nodes)} nodes, max depth {max(len(nm) for nm, *_ in nodes) - 1} ({time.time()-t0:.1f}s)")

    if out.exists():
        shutil.rmtree(out)
    (out / "n").mkdir(parents=True)
    names = {nm for nm, *_ in nodes}
    meta_nodes, total = [], 0
    for name, center, half, idx in sorted(nodes, key=lambda t: (len(t[0]), t[0])):
        rec = np.empty(len(idx), dtype=RENDER_DTYPE)
        rel = (xyz[idx] - center).astype(np.float32)
        rec["x"], rec["y"], rec["z"] = rel[:, 0], rel[:, 1], rel[:, 2]
        rec["r"], rec["g"], rec["b"] = rgb[idx, 0], rgb[idx, 1], rgb[idx, 2]
        rec["lum"] = lum[idx]
        rec.tofile(out / "n" / f"{name}.bin")
        ext = np.empty(len(idx), dtype=EXT_DTYPE)
        ext["id"], ext["mag"], ext["color"] = ids[idx], mag[idx].astype(np.float32), ext_color[idx].astype(np.float32)
        ext.tofile(out / "n" / f"{name}.ext.bin")
        mask = sum(1 << c for c in range(8) if f"{name}{c}" in names)
        meta_nodes.append({"name": name, "center": [round(float(v), 6) for v in center],
                           "half": float(half), "count": int(len(idx)), "children": mask})
        total += len(idx)
    assert total == n, (total, n)

    meta = {
        "layer": a.layer, "title": a.title or a.layer, "unit": "pc", "frame": "galactic-helio",
        "count": int(n), "nodeCapacity": a.capacity,
        "record": "xyz_f32_rgb_u8_lum_u8", "bytesPerPoint": 16,
        "extRecord": "id_u64_mag_f32_color_f32", "extBytesPerPoint": 16,
        "idPrefix": a.id_prefix, "lumModel": a.kind_model, "order": a.order,
        "extColorField": "bp_rp" if a.kind_model == "star" else "z",
        "built": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "nodes": meta_nodes,
    }
    (out / "meta.json").write_text(json.dumps(meta, separators=(",", ":")))
    size = sum(p.stat().st_size for p in out.rglob("*") if p.is_file())
    print(f"[{a.layer}] wrote {total} points, {len(meta_nodes)} nodes, {size/1e6:.1f} MB -> {out} ({time.time()-t0:.1f}s)")


if __name__ == "__main__":
    main()
