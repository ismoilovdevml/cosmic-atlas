"""Build octree point tiles for one layer (format: docs/data-contract.md, section 3).

Input : data/raw/<layer>/*.parquet with contract columns (ra, dec, dist_pc, mag, color, kind, id ...)
Output: data/tiles/<layer>/meta.json + n/<node>.bin (render) + n/<node>.ext.bin (pick)
        + n/<node>.vel.bin (optional space velocities, when the input has pmra/pmdec; --velocity)

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
EXT_DTYPE = np.dtype([("id", "<u8"), ("mag", "<f4"), ("color", "<f4"),
                      ("dist_lo", "<f4"), ("dist_hi", "<f4")])
# optional velocity stream n/<node>.vel.bin (data-contract.md section 3): vx, vy, vz in km/s
# (Galactic Cartesian), q = what is known about the velocity (VEL_Q_*), all IEEE float16
VEL_DTYPE = np.dtype([("vx", "<f2"), ("vy", "<f2"), ("vz", "<f2"), ("q", "<f2")])
assert RENDER_DTYPE.itemsize == 16 and EXT_DTYPE.itemsize == 24 and VEL_DTYPE.itemsize == 8
VEL_ENCODING = "vx_vy_vz_q_f16"
VEL_Q_FULL = 1.0      # proper motion + parallax/distance + radial velocity: full 3D space velocity
VEL_Q_TANGENTIAL = 0.0  # no radial velocity: only the on-sky (tangential) part, line of sight unknown
VEL_Q_NONE = -1.0     # no proper motion either: stored as 0, the point does not move

# k = 1 mas/yr at 1 pc in km/s, from astropy: (1 mas/yr * 1 pc).to(km/s, dimensionless_angles())
KMS_PER_MASYR_PC = 4.740470463533349e-3
# 1 km/s for 1 Myr in pc: (1 km/s * 1 Myr).to(pc), Julian year
PC_PER_KMS_MYR = 1.022712165045695
# Solar motion relative to the Local Standard of Rest, (U, V, W) km/s in the contract's Galactic
# axes (+x to the Galactic Centre, +y with rotation, +z to the NGP): Schoenrich, Binney & Dehnen 2010,
# MNRAS 403, 1829 (also astropy's GalacticLSR default v_bary)
SUN_LSR_SCHOENRICH2010 = np.array([11.1, 12.24, 7.25])

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


def space_velocity_galactic(ra_deg, dec_deg, dist_pc, pmra_masyr, pmdec_masyr, rv_kms,
                            frame: str = "helio") -> tuple[np.ndarray, np.ndarray]:
    """Galactic Cartesian space velocity (km/s), shape (N, 3), and the quality code q per point.

    v = k d (pmra e_ra + pmdec e_dec) + rv r_hat in ICRS axes, rotated to Galactic with ICRS_TO_GAL;
    pmra is mu_alpha* (= mu_alpha cos dec, as Gaia gives it), k = 4.74047e-3 km/s per mas/yr per pc.
    Vectorised; matches astropy SkyCoord(...).galactic.velocity (tests/test_build_tiles.py).
    Missing rv -> tangential part only, q = VEL_Q_TANGENTIAL. Missing proper motion -> 0, q = VEL_Q_NONE.
    frame 'helio': relative to the Sun (Gaia is barycentric; Sun - barycentre is ~0.01 km/s, ignored).
    frame 'lsr'  : relative to the LSR, i.e. heliocentric + the Sun's own motion (Schoenrich et al. 2010).
    """
    ra = np.radians(np.asarray(ra_deg, dtype=np.float64))
    dec = np.radians(np.asarray(dec_deg, dtype=np.float64))
    d = np.asarray(dist_pc, dtype=np.float64)
    pmra = np.asarray(pmra_masyr, dtype=np.float64)
    pmdec = np.asarray(pmdec_masyr, dtype=np.float64)
    rv = np.asarray(rv_kms, dtype=np.float64)
    has_pm = np.isfinite(pmra) & np.isfinite(pmdec) & np.isfinite(d)
    has_rv = np.isfinite(rv)
    pmra, pmdec, rv = np.where(has_pm, pmra, 0.0), np.where(has_pm, pmdec, 0.0), np.where(has_rv & has_pm, rv, 0.0)
    sa, ca, sd, cd = np.sin(ra), np.cos(ra), np.sin(dec), np.cos(dec)
    e_ra = np.stack([-sa, ca, np.zeros_like(ra)], axis=1)
    e_dec = np.stack([-sd * ca, -sd * sa, cd], axis=1)
    r_hat = np.stack([cd * ca, cd * sa, sd], axis=1)
    kd = KMS_PER_MASYR_PC * np.where(has_pm, d, 0.0)
    v_icrs = (kd * pmra)[:, None] * e_ra + (kd * pmdec)[:, None] * e_dec + rv[:, None] * r_hat
    v = v_icrs @ ICRS_TO_GAL.T
    if frame == "lsr":
        v = v + SUN_LSR_SCHOENRICH2010
    elif frame != "helio":
        raise ValueError(f"velocity frame {frame!r}")
    q = np.where(~has_pm, VEL_Q_NONE, np.where(has_rv, VEL_Q_FULL, VEL_Q_TANGENTIAL))
    return v, q


def closest_approach(xyz_pc, v_kms) -> tuple[np.ndarray, np.ndarray]:
    """Linear-motion closest approach to the origin: time (Myr, + = future) and distance (pc).
    x(t) = x0 + v t with t in Myr and v in km/s (1 km/s * 1 Myr = PC_PER_KMS_MYR pc)."""
    x = np.atleast_2d(np.asarray(xyz_pc, dtype=np.float64))
    v = np.atleast_2d(np.asarray(v_kms, dtype=np.float64)) * PC_PER_KMS_MYR
    vv = np.einsum("ij,ij->i", v, v)
    t = np.where(vv > 0, -np.einsum("ij,ij->i", x, v) / np.where(vv > 0, vv, 1.0), 0.0)
    return t, np.linalg.norm(x + v * t[:, None], axis=1)


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
def abs_mag(mag, dist_pc, z=None) -> np.ndarray:
    """Display absolute magnitude. Stars: M = m - DM(d). Galaxies: the distance modulus uses the
    luminosity distance d_L = (1+z) d_C (d_C = comoving dist_pc); no K-correction, no extinction,
    so this is a rendering proxy, not a science-grade absolute magnitude."""
    d = np.maximum(np.asarray(dist_pc, dtype=np.float64), 1e-6)
    if z is not None:
        zz = np.asarray(z, dtype=np.float64)
        d = d * np.where(np.isfinite(zz) & (zz > 0), 1.0 + zz, 1.0)
    return np.asarray(mag, dtype=np.float64) - 5.0 * np.log10(d / 10.0)


def lum_code(mag, dist_pc, model: str, z=None) -> np.ndarray:
    m_abs = abs_mag(mag, dist_pc, z if model == "galaxy" else None)
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


def subtree_aggregates(nodes, xyz, rgb, lin_l) -> dict:
    """Per node, summed light of the node and ALL its descendants: point count n, total luminosity L
    (units of an M=0 source), light-weighted centroid c (pc, relative to the node centre), and
    light-weighted mean colour rgb, light-weighted RMS radius about the centroid (pc). Lets the renderer draw one 'blob' for an unloaded subtree so
    distant views keep their total brightness (idea from skymap, MIT, cut.wesl)."""
    own = {}
    for name, center, half, idx in nodes:
        w = lin_l[idx]
        own[name] = (len(idx), w.sum(), (xyz[idx] * w[:, None]).sum(0), (rgb[idx].astype(np.float64) * w[:, None]).sum(0),
                     (w * np.einsum("ij,ij->i", xyz[idx], xyz[idx])).sum(), center)
    acc = {}
    for name in sorted(own, key=len, reverse=True):
        n, L, wx, wc, wxx, center = own[name]
        for c in range(8):
            ch = acc.get(name + str(c))
            if ch:
                n, L, wx, wc, wxx = n + ch[0], L + ch[1], wx + ch[2], wc + ch[3], wxx + ch[4]
        acc[name] = (n, L, wx, wc, wxx, center)
    out = {}
    for name, (n, L, wx, wc, wxx, center) in acc.items():
        if L > 0:
            mean = wx / L
            cen, col = mean - center, wc / L
            rms = float(np.sqrt(max(wxx / L - float(mean @ mean), 0.0)))
        else:
            cen, col, rms = np.zeros(3), np.array([255.0, 255.0, 255.0]), 0.0
        out[name] = {"n": int(n), "L": float(f"{L:.6g}"), "c": [round(float(v), 4) for v in cen],
                     "rgb": [int(round(v)) for v in col], "rms": float(f"{rms:.5g}")}
    return out


# --------------------------------------------------------------------------- main
def load_layer(layer: str, files: list[Path]):
    cols_wanted = ["id", "ra", "dec", "dist_pc", "dist_lo_pc", "dist_hi_pc", "mag", "color", "kind",
                   "source_id", "targetid", "z", "pmra", "pmdec", "radial_velocity"]
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
    ap.add_argument("--velocity", choices=["auto", "off", "helio", "lsr"], default="auto",
                    help="write n/<node>.vel.bin: 'helio' = relative to the Sun, 'lsr' = relative to the LSR "
                         "(Sun's motion from Schoenrich et al. 2010 added); 'auto' = helio when pmra/pmdec exist")
    ap.add_argument("--note", default=None, help="free-text caveat stored in meta.json (e.g. partial sky)")
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
    zcol = np.asarray(cols["z"], dtype=np.float64) if "z" in cols else None
    lum = lum_code(mag, dist, a.kind_model, zcol)
    dlo = np.asarray(cols.get("dist_lo_pc", np.full(n, np.nan)), dtype=np.float64)
    dhi = np.asarray(cols.get("dist_hi_pc", np.full(n, np.nan)), dtype=np.float64)
    if a.kind_model == "star":
        color = np.asarray(cols.get("color", np.full(n, np.nan)), dtype=np.float64)
        rgb = star_rgb(color)
        ext_color = color
    else:
        z = np.asarray(cols.get("z", np.full(n, np.nan)), dtype=np.float64)
        rgb = galaxy_rgb(z, kind)
        ext_color = z
    ids = numeric_ids(cols)
    vel_frame = a.velocity
    if vel_frame == "auto":
        vel_frame = "helio" if ("pmra" in cols and "pmdec" in cols) else "off"
    if vel_frame != "off":
        if not ("pmra" in cols and "pmdec" in cols):
            sys.exit(f"--velocity {vel_frame}: input has no pmra/pmdec columns")
        rv = np.asarray(cols.get("radial_velocity", np.full(n, np.nan)), dtype=np.float64)
        vel, vel_q = space_velocity_galactic(cols["ra"], cols["dec"], dist, cols["pmra"], cols["pmdec"], rv, vel_frame)
    else:
        vel = vel_q = None

    rng = np.random.default_rng(a.seed)
    if a.order == "lum":
        # brightest first; small jitter breaks ties without spatial bias
        order = np.argsort(-(lum.astype(np.float64) + rng.random(n)), kind="stable")
    else:
        order = rng.permutation(n)
    xyz, rgb, lum, ids, mag, ext_color = xyz[order], rgb[order], lum[order], ids[order], mag[order], ext_color[order]
    dlo, dhi = dlo[order], dhi[order]
    if vel is not None:
        vel, vel_q = vel[order], vel_q[order]
    # linear luminosity (units of an M=0 source) recovered from the lum code, for subtree aggregates
    m_from_code = (20.0 - lum / 10.0) if a.kind_model == "star" else (-14.0 - lum / 20.0)
    lin_l = 10.0 ** (-0.4 * m_from_code)
    print(f"[{a.layer}] colours/ordering done ({time.time()-t0:.1f}s)")

    nodes = build_octree(xyz, a.capacity)
    print(f"[{a.layer}] octree: {len(nodes)} nodes, max depth {max(len(nm) for nm, *_ in nodes) - 1} ({time.time()-t0:.1f}s)")

    agg = subtree_aggregates(nodes, xyz, rgb, lin_l)
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
        ext["dist_lo"], ext["dist_hi"] = dlo[idx].astype(np.float32), dhi[idx].astype(np.float32)
        ext.tofile(out / "n" / f"{name}.ext.bin")
        mask = sum(1 << c for c in range(8) if f"{name}{c}" in names)
        node = {"name": name, "center": [round(float(v), 6) for v in center],
                "half": float(half), "count": int(len(idx)), "children": mask, "agg": agg[name]}
        if vel is not None:
            vr = np.empty(len(idx), dtype=VEL_DTYPE)
            v16 = vel[idx].astype(np.float16)
            vr["vx"], vr["vy"], vr["vz"], vr["q"] = v16[:, 0], v16[:, 1], v16[:, 2], vel_q[idx].astype(np.float16)
            vr.tofile(out / "n" / f"{name}.vel.bin")
            # fastest point of this node (as stored), km/s, rounded up: lets the viewer grow the node's
            # bounding sphere by vmax |dt| so moving points are not culled with their node
            node["vmax"] = float(np.ceil(np.max(np.linalg.norm(v16.astype(np.float64), axis=1), initial=0.0) * 10) / 10)
        meta_nodes.append(node)
        total += len(idx)
    assert total == n, (total, n)

    meta = {
        "layer": a.layer, "title": a.title or a.layer, "unit": "pc", "frame": "galactic-helio",
        "count": int(n), "nodeCapacity": a.capacity,
        "record": "xyz_f32_rgb_u8_lum_u8", "bytesPerPoint": 16,
        "extRecord": "id_u64_mag_f32_color_f32_distlo_f32_disthi_f32", "extBytesPerPoint": 24,
        "idPrefix": a.id_prefix, "lumModel": a.kind_model, "order": a.order,
        "extColorField": "bp_rp" if a.kind_model == "star" else "z",
        "built": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "nodes": meta_nodes,
    }
    if a.note:
        meta["note"] = a.note
    if vel is not None:
        n_full = int(np.sum(vel_q == VEL_Q_FULL))
        n_tan = int(np.sum(vel_q == VEL_Q_TANGENTIAL))
        meta["velocity"] = {
            "unit": "km/s", "frame": "galactic", "origin": "sun" if vel_frame == "helio" else "lsr",
            "encoding": VEL_ENCODING, "bytesPerPoint": VEL_DTYPE.itemsize,
            "rvMissing": "tangential",
            "q": {"full": VEL_Q_FULL, "tangential": VEL_Q_TANGENTIAL, "none": VEL_Q_NONE},
            # velocity of the Sun in this stream's frame: add it to the Sun, or subtract it from every
            # point to get motion relative to the Sun (the viewer does the latter)
            "sunVelocity": [0.0, 0.0, 0.0] if vel_frame == "helio" else [float(x) for x in SUN_LSR_SCHOENRICH2010],
            "sunVelocityRef": None if vel_frame == "helio" else "Schoenrich, Binney & Dehnen 2010, MNRAS 403, 1829",
            "counts": {"full": n_full, "tangential": n_tan, "none": int(n - n_full - n_tan)},
            "pcPerKmsMyr": PC_PER_KMS_MYR,
        }
    (out / "meta.json").write_text(json.dumps(meta, separators=(",", ":")))
    size = sum(p.stat().st_size for p in out.rglob("*") if p.is_file())
    print(f"[{a.layer}] wrote {total} points, {len(meta_nodes)} nodes, {size/1e6:.1f} MB -> {out} ({time.time()-t0:.1f}s)")


if __name__ == "__main__":
    main()
