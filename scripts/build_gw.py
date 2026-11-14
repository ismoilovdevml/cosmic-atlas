#!/usr/bin/env python
"""gw-events.json: gravitational-wave mergers with 3D localisation volumes, kind `gw_event`.

PROVENANCE
  Event list: GWOSC cumulative GWTC event list (https://gwosc.org/eventapi/json/GWTC/, CC BY 4.0):
      every event that the list gives parameter estimates for (luminosity distance set). Those are the
      catalogues' confident events (p_astro >= 0.5 in GWTC-2.1/3/4/5; GWTC-1 confident), in the
      version GWOSC lists as current (GWTC-1 for GW170817, GWTC-2.1 for O1/O2/O3a, GWTC-3 for O3b,
      GWTC-4.1 for O4a, GWTC-5.0 for O4b). Taken per event: source-frame m1, m2, final mass,
      luminosity distance with its 90 % bounds, redshift, network SNR, FAR, p_astro.
  Sky maps: the catalogues' public 3D sky maps (multi-order HEALPix: PROBDENSITY, DISTMU, DISTSIGMA,
      DISTNORM; Singer et al. 2016 distance ansatz), CC BY 4.0, Zenodo records 6513631 (GWTC-2.1),
      8177023 (GWTC-3), 20275769 (GWTC-4.1), 20348005 (GWTC-5.0); GW170817 from the GWTC-1 release
      (LIGO DCC P1800381, flat NESTED nside 1024). One map per event: GWTC-3 the release's Default
      map, GWTC-2.1 the map its own skymap_stats file was computed on (else Mixed), GWTC-4.1/5.0 the analysis whose median D_L in the release's
      PESummaryTable matches the GWOSC value (fallback: the map whose own median D_L is closest).
  Volumes: each map's pixels (those holding 99.99 % of the sky probability) are crossed with a radial
      grid of 64 luminosity-distance bins; voxel probability = prob * DISTNORM * r^2 N(r; DISTMU,
      DISTSIGMA) dr. The voxel edges are converted to comoving distance with Planck18 (coords.py
      lumdist_to_comoving_pc: d_C = d_L / (1 + z(d_L))), the voxels are ranked by probability per
      comoving volume, and the smallest set holding 90 % is the 90 % credible comoving volume (Mpc^3,
      fact vol90_mpc3). Same in luminosity-distance space and the 2D 90 % area are kept for the
      check against ligo-skymap-stats (GWTC-2.1 *_skymap_stats.txt, comoving with --cosmology,
      Planck15 there).
  Shape for the viewer: 20,000 points drawn from the voxels of that 90 % set (Galactic Cartesian,
      comoving pc) are fitted with a Gaussian mixture (EM, K = 1..4 by BIC; components under 3 %
      dropped). Each component is an ellipsoid at the 90 % Mahalanobis radius of a 3D Gaussian
      (sqrt(chi2_3(0.9)) = 2.500 sigma): weight, centre [pc], semi-axes [pc], rotation quaternion
      (x, y, z, w) from the ellipsoid frame to Galactic. The quality numbers (share of the 90 % points
      inside the ellipsoids, ellipsoid volume / V90) are in the provenance block.
  Distances in the entries: dist_pc = comoving distance (Planck18) of the GWOSC median D_L; the
      label sits at the centre of the heaviest ellipsoid. No dist_lo/hi (those are 16/84 % in the
      data contract; the 90 % bounds are facts instead).
  GW170817: the only event with an identified host, NGC 4993 (Coulter et al. 2017), and a kilonova
      (AT 2017gfo). It is placed exactly at NGC 4993 (SIMBAD position, Harvard mirror) at the SBF
      distance of Cantiello et al. 2018 (40.7 +- 1.4 +- 1.9 Mpc, treated as a luminosity distance and
      converted like the rest), and NGC 4993 is its own entry so the card can link to it.

Output: data/tiles/catalogs/gw-events.json, provenance in data/tiles/catalogs/provenance/gw-events.json.
Usage: .venv/bin/python scripts/build_gw.py [--refresh] [--only GW150914,...]
"""
from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import re
import sys
import tarfile
from pathlib import Path

import numpy as np
from astropy.io import fits
from scipy.stats import chi2

sys.path.insert(0, str(Path(__file__).resolve().parent))
from catio import CACHE, CATS, SIMBAD_TAP, download, sig, tap_sync, utcnow, write_catalog_json, write_provenance  # noqa: E402
from coords import galactic_xyz, lumdist_to_comoving_pc, xyz_list, z_from_lumdist_pc  # noqa: E402

NAME = "gw-events"
GC = CACHE / "gw"
GWOSC_LIST = "https://gwosc.org/eventapi/json/GWTC/"
ZEN = "https://zenodo.org/api/records"
ARCHIVES = {  # catalogue -> (record, tarball, summary table or None)
    "GWTC-2.1-confident": (6513631, "IGWN-GWTC2p1-v2-PESkyMaps.tar.gz", None),
    "GWTC-3-confident": (8177023, "IGWN-GWTC3p0-v2-PESkyLocalizations.tar.gz", None),
    "GWTC-4.1": (20275769, "IGWN-GWTC4p1-18965dda8_5-Archived_Skymaps.tar.gz", "IGWN-GWTC4p1-18965dda8_5-PESummaryTable.hdf5"),
    "GWTC-5.0": (20348005, "IGWN-GWTC5p0-29ebe06b7_25-Archived_Skymaps.tar.gz", "IGWN-GWTC5p0-29ebe06b7_25-PESummaryTable.hdf5"),
}
GWTC1_GW170817 = "https://dcc.ligo.org/public/0157/P1800381/007/GW170817_skymap.fits.gz"
STATS_RECORD = 6513631  # GWTC-2.1 ligo-skymap-stats files, used as a check
K90 = float(np.sqrt(chi2.ppf(0.9, 3)))
NR = 64
N_SAMPLES = 20000
CIT = {
    "gwosc": {"ref": "GWOSC event portal, cumulative GWTC list (LIGO/Virgo/KAGRA; Abbott et al. 2023, ApJS 267, 29 "
                     "'Open Data from LIGO, Virgo, and KAGRA through the First Part of the Fourth Observing Run'), CC BY 4.0",
              "url": GWOSC_LIST, "doi": "10.3847/1538-4365/acdc9f"},
    "gwtc1": {"ref": "LIGO/Virgo 2019, PRX 9, 031040 (GWTC-1)", "doi": "10.1103/PhysRevX.9.031040"},
    "gwtc21": {"ref": "LIGO/Virgo 2024, PRD 109, 022001 (GWTC-2.1)", "doi": "10.1103/PhysRevD.109.022001"},
    "gwtc3": {"ref": "LIGO/Virgo/KAGRA 2023, PRX 13, 041039 (GWTC-3)", "doi": "10.1103/PhysRevX.13.041039"},
    "gwtc4": {"ref": "LIGO/Virgo/KAGRA 2025, GWTC-4.0 (arXiv:2508.18082); GWTC-4.1 and GWTC-5.0 data releases on Zenodo (2026-05-26)",
              "url": "https://gwosc.org/eventapi/html/GWTC/"},
    "ansatz": {"ref": "Singer et al. 2016, ApJL 829, L15 (3D sky map distance ansatz)", "doi": "10.3847/2041-8205/829/1/L15"},
    "host": {"ref": "Coulter et al. 2017, Science 358, 1556 (optical counterpart of GW170817 in NGC 4993)", "doi": "10.1126/science.aap9811"},
    "sbf": {"ref": "Cantiello et al. 2018, ApJL 854, L31 (SBF distance to NGC 4993: 40.7 +- 1.4 +- 1.9 Mpc)", "doi": "10.3847/2041-8213/aaad64"},
    "p18": {"ref": "Planck Collaboration 2020, A&A 641, A6 (Planck18 cosmology, astropy)", "doi": "10.1051/0004-6361/201833910"},
}
CAT_REF = {"GWTC-1-confident": "gwtc1", "GWTC-2.1-confident": "gwtc21", "GWTC-3-confident": "gwtc3",
           "GWTC-4.1": "gwtc4", "GWTC-5.0": "gwtc4"}
ICRS_TO_GAL = np.array([[-0.05487565771259165, -0.8734370519556157, -0.48383507361671546],
                        [0.49410943719272676, -0.4448297212232951, 0.7469821839866675],
                        [-0.8676661375596576, -0.19807633727300059, 0.4559838136873016]])


# ----------------------------------------------------------------------------- HEALPix (NESTED)
_JRLL = np.array([2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4])
_JPLL = np.array([1, 3, 5, 7, 0, 2, 4, 6, 1, 3, 5, 7])


def _compress_bits(v: np.ndarray) -> np.ndarray:
    """Every second bit of v (bits 0, 2, 4 ...) packed together."""
    v = v & 0x5555555555555555
    v = (v | (v >> 1)) & 0x3333333333333333
    v = (v | (v >> 2)) & 0x0F0F0F0F0F0F0F0F
    v = (v | (v >> 4)) & 0x00FF00FF00FF00FF
    v = (v | (v >> 8)) & 0x0000FFFF0000FFFF
    v = (v | (v >> 16)) & 0x00000000FFFFFFFF
    return v


def nest2ang(nside: np.ndarray, ipix: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """NESTED pixel centres -> (z = cos theta, phi), Gorski et al. 2005 (healpix_base pix2loc)."""
    nside = np.asarray(nside, dtype=np.int64)
    ipix = np.asarray(ipix, dtype=np.int64)
    npface = nside * nside
    face = ipix // npface
    ipf = ipix % npface
    ix = _compress_bits(ipf)
    iy = _compress_bits(ipf >> 1)
    jr = _JRLL[face] * nside - ix - iy - 1
    nr = np.where(jr < nside, jr, np.where(jr > 3 * nside, 4 * nside - jr, nside))
    z = np.where(jr < nside, 1 - nr * nr / (3.0 * npface),
                 np.where(jr > 3 * nside, -(1 - nr * nr / (3.0 * npface)), (2 * nside - jr) * 2.0 / (3.0 * nside)))
    kshift = np.where((jr >= nside) & (jr <= 3 * nside), (jr - nside) & 1, 0)
    jp = (_JPLL[face] * nr + ix - iy + 1 + kshift) // 2
    jp = np.where(jp > 4 * nside, jp - 4 * nside, jp)
    jp = np.where(jp < 1, jp + 4 * nside, jp)
    phi = (jp - (kshift + 1) * 0.5) * (np.pi / 2 / nr)
    return z, phi


def healpix_self_test() -> None:
    z, phi = nest2ang(np.ones(12, int), np.arange(12))
    assert np.allclose(z[:4], 2 / 3) and np.allclose(z[4:8], 0) and np.allclose(z[8:], -2 / 3), z
    assert np.allclose(np.degrees(phi[:4]), [45, 135, 225, 315]) and np.allclose(np.degrees(phi[4:8]), [0, 90, 180, 270])
    # nside 64: the pixel centres are equal-area -> mean z ~ 0 and mean z^2 ~ 1/3
    n = 64
    z, phi = nest2ang(np.full(12 * n * n, n), np.arange(12 * n * n))
    assert abs(z.mean()) < 1e-12 and abs((z * z).mean() - 1 / 3) < 1e-4, (z.mean(), (z * z).mean())
    assert len(np.unique(np.round(np.c_[z, phi], 9), axis=0)) == 12 * n * n


# ----------------------------------------------------------------------------- sky maps
def read_map(data: bytes) -> dict:
    """Multi-order (UNIQ) or flat NESTED sky map -> per-pixel arrays (prob, area, direction, ansatz)."""
    with fits.open(io.BytesIO(data)) as h:
        t = h[1].data
        hdr = h[1].header
        cols = t.columns.names
        if "UNIQ" in cols:
            uniq = np.asarray(t["UNIQ"], dtype=np.int64)
            order = (np.floor(np.log2(uniq / 4.0) / 2)).astype(np.int64)
            nside = 1 << order
            ipix = uniq - 4 * nside * nside
            area = 4 * np.pi / (12.0 * nside * nside)
            prob = np.asarray(t["PROBDENSITY"], float) * area
        else:
            if hdr.get("ORDERING", "").strip() != "NESTED":
                raise ValueError(f"unsupported ORDERING {hdr.get('ORDERING')}")
            prob = np.asarray(t["PROB"], float)
            ns = int(hdr["NSIDE"])
            ipix = np.arange(len(prob), dtype=np.int64)
            nside = np.full(len(prob), ns, dtype=np.int64)
            area = np.full(len(prob), 4 * np.pi / (12.0 * ns * ns))
        mu, sg, nm = (np.asarray(t[c], float) for c in ("DISTMU", "DISTSIGMA", "DISTNORM"))
    z, phi = nest2ang(nside, ipix)
    return {"prob": prob, "area": np.broadcast_to(area, prob.shape).astype(float), "z": z, "phi": phi,
            "mu": mu, "sigma": sg, "norm": nm}


def voxelize(m: dict, keep: float = 0.9999) -> dict:
    """Pixels holding `keep` of the probability x a luminosity-distance grid -> voxel masses."""
    dens = m["prob"] / m["area"]
    order = np.argsort(-dens)
    cum = np.cumsum(m["prob"][order])
    total = cum[-1]
    n = int(np.searchsorted(cum, keep * total)) + 1
    sel = order[:n]
    sel = sel[np.isfinite(m["mu"][sel]) & (m["sigma"][sel] > 0) & np.isfinite(m["norm"][sel])]
    p, area = m["prob"][sel], m["area"][sel]
    mu, sg, nm = m["mu"][sel], m["sigma"][sel], m["norm"][sel]
    # The ansatz density DISTNORM r^2 N(r; DISTMU, DISTSIGMA) is evaluated pointwise in log space:
    # pixels far from the source can have DISTMU << 0 with a huge DISTNORM, where closed-form bin
    # integrals cancel catastrophically (GW190719: total radial mass 2.5 instead of 1).
    lognm = np.log(np.maximum(nm, 1e-300))

    def dens(r: np.ndarray, s: slice) -> np.ndarray:
        x = (r[None, :] - mu[s, None]) / sg[s, None]
        return np.exp(lognm[s, None] + 2 * np.log(r[None, :]) - 0.5 * x * x - np.log(sg[s, None] * np.sqrt(2 * np.pi)))

    # radial range from the marginal on a log grid 0.1 Mpc .. 200 Gpc
    rr = np.logspace(-1, 5.3, 3001)
    dr = np.gradient(rr)
    marg = np.zeros_like(rr)
    w = p / p.sum()
    for k in range(0, len(sel), 2000):
        s = slice(k, k + 2000)
        marg += (w[s, None] * dens(rr, s)).sum(0) * dr
    cdf = np.cumsum(marg)
    cdf /= cdf[-1]
    r_lo = float(np.interp(1e-4, cdf, rr))
    r_hi = float(np.interp(1 - 1e-4, cdf, rr))
    r_med = float(np.interp(0.5, cdf, rr))
    edges = np.linspace(max(r_lo * 0.9, 0.0), r_hi * 1.1, NR + 1)  # Mpc, luminosity distance
    # per-bin integral: 8-point midpoint rule inside each bin
    sub = 8
    h = np.diff(edges) / sub
    rs = (edges[:-1, None] + h[:, None] * (np.arange(sub)[None, :] + 0.5)).ravel()
    radial = np.empty((len(sel), NR))
    for k in range(0, len(sel), 2000):
        s = slice(k, k + 2000)
        radial[s] = dens(rs, s).reshape(-1, NR, sub).sum(2) * h[None, :]
    mass = p[:, None] * radial / total
    dc_edges = lumdist_to_comoving_pc(edges * 1e6) / 1e6
    shell_c = (dc_edges[1:] ** 3 - dc_edges[:-1] ** 3) / 3.0
    shell_l = (edges[1:] ** 3 - edges[:-1] ** 3) / 3.0
    return {"mass": mass, "area": area, "vol_c": area[:, None] * shell_c[None, :], "vol_l": area[:, None] * shell_l[None, :],
            "z": m["z"][sel], "phi": m["phi"][sel], "dc_edges": dc_edges, "dl_edges": edges, "p2d": p / total,
            "dl_median_map": r_med, "captured": float(mass.sum())}


def credible(mass: np.ndarray, vol: np.ndarray, level: float = 0.9) -> tuple[float, np.ndarray]:
    dens = (mass / vol).ravel()
    order = np.argsort(-dens)
    cum = np.cumsum(mass.ravel()[order])
    n = int(np.searchsorted(cum, level)) + 1
    flags = np.zeros(dens.size, bool)
    flags[order[:n]] = True
    return float(vol.ravel()[order[:n]].sum()), flags.reshape(mass.shape)


def area90_deg2(m: dict) -> float:
    """90 % credible sky area of the whole map (every pixel, also those without a distance ansatz)."""
    dens = m["prob"] / m["area"]
    order = np.argsort(-dens)
    cum = np.cumsum(m["prob"][order])
    n = int(np.searchsorted(cum, 0.9 * cum[-1])) + 1
    return float(m["area"][order[:n]].sum() * (180 / np.pi) ** 2)


# ----------------------------------------------------------------------------- ellipsoids
def sample_region(v: dict, flags: np.ndarray, rng, n: int) -> np.ndarray:
    """n points (Galactic Cartesian, comoving Mpc) from the voxels of the credible region."""
    w = np.where(flags, v["mass"], 0).ravel()
    idx = rng.choice(w.size, size=n, p=w / w.sum())
    ip, ir = np.unravel_index(idx, flags.shape)
    # jitter within the voxel: radial uniform in comoving volume, angular ~ pixel size
    lo, hi = v["dc_edges"][ir], v["dc_edges"][ir + 1]
    r = np.cbrt(lo ** 3 + rng.random(n) * (hi ** 3 - lo ** 3))
    zc, ph = v["z"][ip], v["phi"][ip]
    th = np.arccos(np.clip(zc, -1, 1))
    s = np.sqrt(v["area"][ip]) / 2
    th = th + rng.uniform(-s, s, n)
    ph = ph + rng.uniform(-s, s, n) / np.maximum(np.sin(th), 1e-3)
    icrs = np.c_[np.sin(th) * np.cos(ph), np.sin(th) * np.sin(ph), np.cos(th)] * r[:, None]
    return icrs @ ICRS_TO_GAL.T


def gmm_fit(x: np.ndarray, k: int, rng, iters: int = 200) -> tuple[np.ndarray, np.ndarray, np.ndarray, float]:
    """Plain EM for a K-component 3D Gaussian mixture; returns weights, means, covariances, log-likelihood."""
    n, d = x.shape
    mu = x[rng.choice(n, k, replace=False)]
    for _ in range(10):  # k-means++-ish start: a few Lloyd steps
        lab = np.argmin(((x[:, None, :] - mu[None]) ** 2).sum(-1), axis=1)
        mu = np.array([x[lab == j].mean(0) if np.any(lab == j) else mu[j] for j in range(k)])
    cov = np.array([np.cov(x[lab == j].T) + np.eye(d) * 1e-6 * np.trace(np.cov(x.T)) if (lab == j).sum() > d else np.cov(x.T) for j in range(k)])
    w = np.array([(lab == j).mean() for j in range(k)]) + 1e-9
    ll_old = -np.inf
    reg = np.eye(d) * 1e-8 * np.trace(np.cov(x.T))
    for _ in range(iters):
        logp = np.empty((n, k))
        for j in range(k):
            c = cov[j] + reg
            L = np.linalg.cholesky(c)
            y = np.linalg.solve(L, (x - mu[j]).T)
            logp[:, j] = np.log(w[j]) - 0.5 * (y * y).sum(0) - np.log(np.diag(L)).sum() - 0.5 * d * np.log(2 * np.pi)
        mx = logp.max(1, keepdims=True)
        ll = float((mx[:, 0] + np.log(np.exp(logp - mx).sum(1))).sum())
        r = np.exp(logp - mx)
        r /= r.sum(1, keepdims=True)
        nk = r.sum(0) + 1e-12
        w = nk / n
        mu = (r.T @ x) / nk[:, None]
        for j in range(k):
            dx = x - mu[j]
            cov[j] = (r[:, j, None] * dx).T @ dx / nk[j]
        if ll - ll_old < 1e-6 * abs(ll):
            break
        ll_old = ll
    return w, mu, cov, ll


def ellipsoids(x: np.ndarray, rng) -> tuple[list, int]:
    n = len(x)
    best = None
    for k in range(1, 5):
        w, mu, cov, ll = gmm_fit(x, k, rng)
        bic = -2 * ll + (k * 10 - 1) * np.log(n)
        if best is None or bic < best[0]:
            best = (bic, k, w, mu, cov)
    _, k, w, mu, cov = best
    keep = w >= 0.03
    w, mu, cov = w[keep] / w[keep].sum(), mu[keep], cov[keep]
    out = []
    for j in np.argsort(-w):
        ev, evec = np.linalg.eigh(cov[j])
        if np.linalg.det(evec) < 0:
            evec[:, 0] *= -1
        out.append({"w": float(w[j]), "c": mu[j], "axes": K90 * np.sqrt(np.maximum(ev, 0)), "rot": evec})
    return out, k


def quaternion(rm: np.ndarray) -> list[float]:
    """Rotation matrix (columns = ellipsoid axes in Galactic) -> unit quaternion [x, y, z, w]."""
    m = rm
    tr = m[0, 0] + m[1, 1] + m[2, 2]
    if tr > 0:
        s = np.sqrt(tr + 1.0) * 2
        q = [(m[2, 1] - m[1, 2]) / s, (m[0, 2] - m[2, 0]) / s, (m[1, 0] - m[0, 1]) / s, 0.25 * s]
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = np.sqrt(1.0 + m[0, 0] - m[1, 1] - m[2, 2]) * 2
        q = [0.25 * s, (m[0, 1] + m[1, 0]) / s, (m[0, 2] + m[2, 0]) / s, (m[2, 1] - m[1, 2]) / s]
    elif m[1, 1] > m[2, 2]:
        s = np.sqrt(1.0 + m[1, 1] - m[0, 0] - m[2, 2]) * 2
        q = [(m[0, 1] + m[1, 0]) / s, 0.25 * s, (m[1, 2] + m[2, 1]) / s, (m[0, 2] - m[2, 0]) / s]
    else:
        s = np.sqrt(1.0 + m[2, 2] - m[0, 0] - m[1, 1]) * 2
        q = [(m[0, 2] + m[2, 0]) / s, (m[1, 2] + m[2, 1]) / s, 0.25 * s, (m[1, 0] - m[0, 1]) / s]
    q = np.array(q) / np.linalg.norm(q)
    return [round(float(c), 5) for c in q]


def inside_fraction(x: np.ndarray, comps: list) -> float:
    inside = np.zeros(len(x), bool)
    for c in comps:
        y = (x - c["c"]) @ c["rot"] / np.maximum(c["axes"], 1e-9)
        inside |= (y * y).sum(1) <= 1
    return float(inside.mean())


# ----------------------------------------------------------------------------- inputs
def load_events(refresh: bool) -> list[dict]:
    d = json.loads(download(GWOSC_LIST, GC / "gwtc_cumulative.json", refresh).read_text())
    ev = [e for e in d["events"].values() if e.get("luminosity_distance") is not None]
    return sorted(ev, key=lambda e: e["GPS"])


def summary_choice(path: Path) -> dict[str, list[tuple[float, str]]]:
    """GWTC-4.1/5.0 PESummaryTable: event -> [(median D_L, sky map file name)] for every analysis."""
    try:
        import h5py  # optional: only for picking the analysis that matches GWOSC
    except ImportError:
        return {}
    out: dict[str, list] = {}
    with h5py.File(path) as h:
        for r in h["summary_info"][:]:
            out.setdefault(r["gw_name"].decode(), []).append((float(r["luminosity_distance_median"]), r["skymap_result_file_name"].decode()))
    return out


def full_name(member: str) -> str | None:
    m = re.search(r"(GW\d{6}_\d{6})", member)
    return m.group(1) if m else None


def pick_maps(events: list[dict], refresh: bool, stats: dict) -> tuple[dict[str, tuple[str, str, bytes]], dict]:
    """event commonName -> (archive, member, fits bytes), plus how each was chosen."""
    chosen, how = {}, {}
    for cat, (rec, tarname, summ) in ARCHIVES.items():
        evs = [e for e in events if e["catalog.shortName"] == cat]
        if not evs:
            continue
        tpath = download(f"{ZEN}/{rec}/files/{tarname}/content", GC / tarname, refresh)
        table = summary_choice(download(f"{ZEN}/{rec}/files/{summ}/content", GC / summ, refresh)) if summ else {}
        with tarfile.open(tpath) as tf:
            members = [m for m in tf.getmembers() if m.isfile() and re.search(r"\.fits(\.gz)?$", m.name)]
            default3 = set()
            for m in tf.getmembers():
                if m.name.endswith("skyLocalizationFileList.csv"):
                    rows = csv.DictReader(io.StringIO(tf.extractfile(m).read().decode()))
                    default3 = {r["FileName"] for r in rows if r["Default"] == "True"}
            by_event: dict[str, list] = {}
            for m in members:
                fn = full_name(Path(m.name).name)
                if fn:
                    by_event.setdefault(fn, []).append(m)
            for e in evs:
                cn = e["commonName"]
                keys = [k for k in by_event if k == cn or k.startswith(cn + "_")]
                if len(keys) > 1:  # GW190521 vs GW190521_074359: the UTC time of the GPS stamp decides
                    keys = [k for k in keys if k == gps_name(e["GPS"])]
                if len(keys) != 1:
                    how[cn] = f"no unique sky map in {tarname} ({len(keys)} matches)"
                    continue
                cands = by_event[keys[0]]
                base = {Path(m.name).name: m for m in cands}
                pick, why = None, ""
                st = stats.get(keys[0], {}).get("map")
                if st:  # GWTC-2.1: the map the release's own ligo-skymap-stats file was computed on
                    pick = next((base[b] for b in base if b.endswith(st)), None)
                    why = f"map of the release skymap_stats ({st})"
                if pick is None and default3:
                    pick = next((base[b] for b in base if b in default3), None)
                    why = "release Default flag"
                rows = table.get(keys[0]) or table.get(cn)
                if pick is None and rows:
                    dl = e["luminosity_distance"]
                    best = min(rows, key=lambda r: abs(r[0] - dl))
                    if best[1] in base and abs(best[0] - dl) / dl < 0.03:
                        pick, why = base[best[1]], f"PESummaryTable D_L {best[0]:.0f} = GWOSC {dl:g} Mpc"
                if pick is None:
                    pick = next((base[b] for b in base if re.search(r"[:_-]Mixed(\.fits|_Skymap)", b)), None)
                    why = "Mixed" if pick is not None else ""
                if pick is None:  # closest median D_L computed from each map
                    best = None
                    for b, m in base.items():
                        v = voxelize(read_map(maybe_gunzip(tf.extractfile(m).read())))
                        dd = abs(v["dl_median_map"] - e["luminosity_distance"])
                        if best is None or dd < best[0]:
                            best = (dd, m)
                    pick, why = best[1], "closest map median D_L"
                chosen[cn] = (tarname, Path(pick.name).name, maybe_gunzip(tf.extractfile(pick).read()))
                how[cn] = why
    return chosen, how


def gps_name(gps: float) -> str:
    """GPS time -> 'GWyymmdd_hhmmss' (UTC), the long event name of the catalogues."""
    from astropy.time import Time
    return "GW" + Time(gps, format="gps").utc.strftime("%y%m%d_%H%M%S")


def maybe_gunzip(b: bytes) -> bytes:
    return gzip.decompress(b) if b[:2] == b"\x1f\x8b" else b


def skymap_stats() -> dict[str, dict]:
    """GWTC-2.1 ligo-skymap-stats files (--cosmology): area(90) deg2, vol(90) comoving Mpc3 (Planck15)."""
    rec = json.loads(download(f"{ZEN}/{STATS_RECORD}", GC / f"zen_{STATS_RECORD}.json").read_text())
    out = {}
    for f in rec["files"]:
        if "skymap_stats" not in f["key"]:
            continue
        p = download(f["links"]["self"], GC / "stats" / f["key"])
        lines = [ln for ln in p.read_text().splitlines() if ln and not ln.startswith("#")]
        row = dict(zip(lines[0].split("\t"), lines[1].split("\t")))
        head = p.read_text().splitlines()[0]
        out[full_name(f["key"])] = {"map": head.split("/")[-1].strip(), "area90_deg2": float(row["area(90)"]), "vol90_mpc3": float(row["vol(90)"]),
                                    "distmean_mpc": float(row["distmean"])}
    return out


def ngc4993() -> dict:
    cache = GC / "ngc4993_simbad.csv"
    if not cache.exists():
        df = tap_sync(SIMBAD_TAP, "SELECT b.main_id, b.ra, b.dec, b.rvz_redshift FROM basic AS b JOIN ident AS i "
                                  "ON i.oidref = b.oid WHERE i.id = 'NGC 4993'")
        df.to_csv(cache, index=False)
    import pandas as pd
    r = pd.read_csv(cache).iloc[0]
    return {"ra": float(r["ra"]), "dec": float(r["dec"]), "z": float(r["rvz_redshift"]), "main_id": str(r["main_id"])}


# ----------------------------------------------------------------------------- entries
def pm(e: dict, key: str, n: int = 3):
    """GWOSC value with 90 % bounds -> [value, minus, plus] (contract order, both >= 0)."""
    v = e.get(key)
    if v is None:
        return None
    lo, hi = e.get(f"{key}_lower"), e.get(f"{key}_upper")
    if (lo is None and hi is None) or (not lo and not hi):  # no bounds, or both rounded to 0 in GWOSC
        return sig(v, n)
    return [sig(v, n), sig(abs(lo), 2) if lo is not None else None, sig(abs(hi), 2) if hi is not None else None]


def source_type(m1, m2) -> str:
    """By the median source masses with a 3 Msun neutron-star limit (display classification)."""
    if m1 is None or m2 is None:
        return "compact binary merger"
    if m1 < 3:
        return "binary neutron star"
    if m2 < 3:
        return "neutron star–black hole"
    return "binary black hole"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--only", default=None, help="comma-separated commonNames (for testing; output not written)")
    a = ap.parse_args()
    started = utcnow()
    healpix_self_test()
    events = load_events(a.refresh)
    if a.only:
        events = [e for e in events if e["commonName"] in a.only.split(",")]
    stats = skymap_stats()
    maps, how = pick_maps(events, a.refresh, stats)
    g17 = download(GWTC1_GW170817, GC / "GW170817_GWTC1_skymap.fits.gz", a.refresh)
    if any(e["commonName"] == "GW170817" for e in events):
        maps["GW170817"] = ("LIGO DCC P1800381", "GW170817_skymap.fits.gz", maybe_gunzip(g17.read_bytes()))
        how["GW170817"] = "GWTC-1 release sky map"
    host = ngc4993()
    rng = np.random.default_rng(20261114)
    entries, checks, quality, missing = [], [], [], []
    for e in events:
        cn = e["commonName"]
        cat = e["catalog.shortName"]
        if cn not in maps:
            missing.append([cn, how.get(cn, "no map")])
            continue
        arch, member, data = maps[cn]
        m = read_map(data)
        v = voxelize(m)
        v90c, flags = credible(v["mass"], v["vol_c"])
        v90l, _ = credible(v["mass"], v["vol_l"])
        a90 = area90_deg2(m)
        x = sample_region(v, flags, rng, N_SAMPLES)
        comps, k_bic = ellipsoids(x, rng)
        frac_in = inside_fraction(x, comps)
        ell_vol = sum(4 / 3 * np.pi * float(np.prod(c["axes"])) for c in comps)
        quality.append({"event": cn, "k": len(comps), "k_bic": k_bic, "inside": round(frac_in, 3), "ell_vol_over_v90": round(ell_vol / v90c, 3)})
        full = full_name(member) or cn
        if full in stats:
            s = stats[full]
            checks.append({"event": cn, "area90_ours": round(a90, 1), "area90_lvk": round(s["area90_deg2"], 1),
                           "vol90_ours_comoving": sig(v90c, 4), "vol90_lvk_comoving_planck15": sig(s["vol90_mpc3"], 4),
                           "ratio_vol": round(v90c / s["vol90_mpc3"], 3), "ratio_area": round(a90 / s["area90_deg2"], 3)})
        dl = e["luminosity_distance"]
        dc = float(lumdist_to_comoving_pc(dl * 1e6))
        dl_lo, dl_hi = dl + (e["luminosity_distance_lower"] or 0), dl + (e["luminosity_distance_upper"] or 0)
        dc_lo, dc_hi = (float(lumdist_to_comoving_pc(x_ * 1e6)) / 1e6 for x_ in (dl_lo, dl_hi))
        m1, m2 = e.get("mass_1_source"), e.get("mass_2_source")
        facts = {"type": source_type(m1, m2), "position": "uncertain", "vol90_mpc3": sig(v90c, 3), "area90_deg2": sig(a90, 3),
                 "mass1_msun": pm(e, "mass_1_source"), "mass2_msun": pm(e, "mass_2_source"),
                 "final_mass_msun": pm(e, "final_mass_source"), "lum_dist_mpc": pm(e, "luminosity_distance"),
                 "comoving_dist_mpc": [sig(dc / 1e6, 3), sig(dc / 1e6 - dc_lo, 2), sig(dc_hi - dc / 1e6, 2)],
                 "redshift": pm(e, "redshift"), "snr": sig(e["network_matched_filter_snr"], 3) if e.get("network_matched_filter_snr") else None,
                 "far_per_yr": sig(e["far"], 2) if e.get("far") is not None else None,
                 "p_astro": e.get("p_astro"), "catalog": cat.replace("-confident", "")}
        facts = {k: v_ for k, v_ in facts.items() if v_ is not None}
        loc = [[round(c["w"], 3), *[sig(q * 1e6, 5) for q in c["c"]], *[sig(q * 1e6, 4) for q in c["axes"]], *quaternion(c["rot"])]
               for c in comps]
        anchor = comps[0]["c"] * 1e6  # heaviest ellipsoid's centre (pc): label and fly-to target
        r_anchor = float(np.linalg.norm(anchor))
        ref_key = CAT_REF[cat]
        ent = {"name": cn, "alt": [], "kind": "gw_event", "dist_pc": sig(dc, 5),
               "xyz": [sig(q, 6) for q in anchor], "docs": "gravitational-waves",
               "doi": CIT[ref_key].get("doi"), "facts": facts,
               "gwosc": f"https://gwosc.org/eventapi/html/{cat}/{cn}/v{e['version']}/",
               "loc": {"frame": "galactic-helio comoving pc", "level": 0.9,
                       "fields": "w, cx, cy, cz, a, b, c, qx, qy, qz, qw", "e": loc}}
        ent["ref"] = f"GWOSC {cat.replace('-confident', '')}; 90 % volume from the LVK sky map"
        ent["skymap"] = member
        if cn == "GW170817":
            d_host = 40.7e6
            dc_host = float(lumdist_to_comoving_pc(d_host))
            ent.update({"ra": round(host["ra"], 6), "dec": round(host["dec"], 6), "dist_pc": sig(dc_host, 5),
                        "xyz": xyz_list(host["ra"], host["dec"], dc_host, 3), "host": "NGC 4993",
                        "alt": ["AT 2017gfo", "GRB 170817A", "SSS17a"]})
            ent["facts"] = {"type": source_type(m1, m2), "position": "host galaxy", "host": "NGC 4993",
                            "kilonova": "AT 2017gfo", **{k: v_ for k, v_ in facts.items() if k not in ("type", "position")}}
            ent["facts_ref"] = {"host": CIT["host"]["ref"], "position": CIT["sbf"]["ref"]}
        else:
            # the anchor's direction is shown as RA/Dec on the card; it is the centre of the main lobe, not a position
            ra_dec = anchor @ ICRS_TO_GAL  # Galactic -> ICRS (orthogonal matrix)
            ent["ra"] = round(float(np.degrees(np.arctan2(ra_dec[1], ra_dec[0])) % 360), 3)
            ent["dec"] = round(float(np.degrees(np.arcsin(ra_dec[2] / r_anchor))), 3)
        entries.append(ent)
        print(f"  {cn:18s} {cat:20s} V90 {v90c:10.4g} Mpc3  A90 {a90:8.1f} deg2  K {len(comps)}  in {frac_in:.2f}  {how.get(cn, '')}", flush=True)

    # host galaxy entry for the GW170817 card link and search
    dc_host = float(lumdist_to_comoving_pc(40.7e6))
    entries.append({"name": "NGC 4993", "alt": [], "kind": "galaxy", "ra": round(host["ra"], 6), "dec": round(host["dec"], 6),
                    "dist_pc": sig(dc_host, 5), "dist_lo_pc": sig(float(lumdist_to_comoving_pc((40.7 - 2.4) * 1e6)), 4),
                    "dist_hi_pc": sig(float(lumdist_to_comoving_pc((40.7 + 2.4) * 1e6)), 4),
                    "xyz": xyz_list(host["ra"], host["dec"], dc_host, 3), "docs": "gravitational-waves",
                    "facts": {"type": "host of GW170817", "lum_dist_mpc": [40.7, 2.4], "redshift": sig(host["z"], 4)},
                    "facts_ref": {"lum_dist_mpc": "Cantiello et al. 2018 (SBF; random and systematic errors in quadrature)",
                                  "redshift": "SIMBAD"},
                    "ref": "Cantiello et al. 2018, ApJL 854, L31", "doi": CIT["sbf"]["doi"]})
    if a.only:
        print(json.dumps({"checks": checks, "quality": quality, "missing": missing}, indent=1))
        return
    path = CATS / f"{NAME}.json"
    size = write_catalog_json(path, entries, drop_none=True)
    if size > 5_000_000:
        raise SystemExit(f"{path.name} is {size} B > 5 MB")
    q = np.array([[x["inside"], x["ell_vol_over_v90"]] for x in quality])
    rv = np.array([c["ratio_vol"] for c in checks])
    ra_ = np.array([c["ratio_area"] for c in checks])
    prov = {"catalog": f"data/tiles/catalogs/{NAME}.json", "bytes": size, "started_utc": started, "finished_utc": utcnow(),
            "service": {"gwosc": GWOSC_LIST, "zenodo": {k: f"{ZEN}/{r[0]}" for k, r in ARCHIVES.items()}, "gw170817": GWTC1_GW170817,
                        "simbad_tap": SIMBAD_TAP},
            "selection": "GWOSC cumulative GWTC list, events with parameter estimates (luminosity_distance not null)",
            "distance": "dist_pc = Planck18 comoving distance of the GWOSC median luminosity distance: z from inverting "
                        "d_L(z) = (1+z) d_C(z) on the coords.py Planck18 grid, then d_C = d_L/(1+z). The 3D volumes use the "
                        "same conversion per radial bin edge. GWOSC 'redshift' (LVK, Planck15) is kept as a fact.",
            "facts_keys": {"type": "from median source masses, 3 Msun neutron-star limit (display classification)",
                           "position": "'uncertain' for every event except GW170817 ('host galaxy')",
                           "vol90_mpc3": "90 % credible comoving volume (Planck18), from the sky map, Mpc^3",
                           "area90_deg2": "90 % credible sky area from the sky map", "mass1_msun/mass2_msun/final_mass_msun":
                           "source-frame masses, [median, minus, plus] 90 %", "lum_dist_mpc": "GWOSC luminosity distance [median, minus, plus] 90 %",
                           "comoving_dist_mpc": "Planck18 conversion of lum_dist_mpc (bounds converted too)", "redshift": "GWOSC",
                           "snr": "network matched-filter SNR", "far_per_yr": "false-alarm rate, per year (GWOSC)", "p_astro": "GWOSC"},
            "loc_format": "loc.e = list of ellipsoids [w, cx, cy, cz, a, b, c, qx, qy, qz, qw]: weight, centre (Galactic, comoving pc), "
                          f"semi-axes (pc) at the 90 % radius of a 3D Gaussian ({K90:.4f} sigma), quaternion from ellipsoid axes to Galactic",
            "counts": {"events_with_pe": len(events), "entries": len(entries), "events_written": len(entries) - 1, "missing_map": missing,
                       "catalogs": {c: sum(1 for e in events if e["catalog.shortName"] == c) for c in sorted({e["catalog.shortName"] for e in events})}},
            "check_vs_ligo_skymap_stats": {"n": len(checks), "vol_ratio_median": float(np.median(rv)) if len(rv) else None,
                                           "vol_ratio_p5_p95": [float(np.percentile(rv, 5)), float(np.percentile(rv, 95))] if len(rv) else None,
                                           "area_ratio_median": float(np.median(ra_)) if len(ra_) else None,
                                           "area_ratio_p5_p95": [float(np.percentile(ra_, 5)), float(np.percentile(ra_, 95))] if len(ra_) else None,
                                           "note": "LVK numbers use Planck15 and the native multi-order resolution; ours Planck18",
                                           "rows": checks},
            "ellipsoid_quality": {"inside_median": float(np.median(q[:, 0])), "inside_p5": float(np.percentile(q[:, 0], 5)),
                                  "vol_ratio_median": float(np.median(q[:, 1])), "rows": quality},
            "map_choice": how,
            "citations": list(CIT.values())}
    write_provenance(NAME, prov)
    print(f"{NAME}: {len(entries) - 1} events + host, {size} B; vol ratio vs LVK median {prov['check_vs_ligo_skymap_stats']['vol_ratio_median']}, "
          f"area ratio {prov['check_vs_ligo_skymap_stats']['area_ratio_median']}; ellipsoid inside median {prov['ellipsoid_quality']['inside_median']:.3f}; missing {missing}")


if __name__ == "__main__":
    main()
