#!/usr/bin/env python
"""CMB shell texture: Planck PR3 SMICA temperature anisotropies -> web/public/sky/planck_smica_cmb.jpg.

INPUT
  Planck 2018 (PR3) SMICA CMB map, COM_CMB_IQU-smica_2048_R3.00_full.fits (2,013,312,960 B),
  IRSA mirror of the Planck Legacy Archive:
  https://irsa.ipac.caltech.edu/data/Planck/release_3/all-sky-maps/maps/component-maps/cmb/
  HEALPix Nside 2048, NESTED, Galactic, K_CMB. We use the column I_STOKES_INP: SMICA's own
  inpainted temperature map (Planck 2018 IV, A&A 641, A4, section 4.1), i.e. the Galactic plane
  and point-source holes filled by Planck's constrained Gaussian realisation, not by us. The
  inpainting mask (TMASKINP) is counted in the provenance so the filled area is stated.
  PR4 (NPIPE) was not used: its component-separated maps were not reachable (PLA 503, NERSC
  serves frequency maps only; docs/open-data-inventory.md).

PROCESSING
  1. Monopole and dipole: SMICA maps already have the CMB dipole removed. To be safe we fit and
     remove a residual monopole + dipole outside the confidence mask (TMASK = 1) with
     healpy.remove_dipole (gal_cut 0; masked pixels set to UNSEEN). Fitted values are printed and
     stored in the provenance.
  2. Downgrade Nside 2048 -> 1024 (healpy.ud_grade, mean of 4 pixels; 3.4' pixels) so the 5.3'
     output pixels do not alias the pixel noise.
  3. Equirectangular Galactic grid, W x H = 4096 x 2048 by default, pixel centres
     l = 180 - (i + 0.5) * 360 / W (l increasing to the LEFT, l = 0 at the centre, as the Gaia
     all-sky image), b = 90 - (j + 0.5) * 180 / H; bilinear HEALPix interpolation
     (healpy.get_interp_val).
  4. Colour: a perceptual diverging map, Moreland 2009 "smooth cool-warm" (Msh interpolation
     between sRGB (59,76,192) and (180,4,38) through a neutral white), ±300 µK (values beyond
     are clipped; the clipped fraction is reported). Linear in temperature.
  5. JPEG, quality 90, progressive. Budget <= 4 MB (asserted).

OUTPUT
  web/public/sky/planck_smica_cmb.jpg, web/public/sky/planck_smica_cmb.json (range, colour map
  anchors, fitted monopole/dipole, comoving distance), data/tiles/catalogs/cmb.json (the
  one-entry catalogue behind the CMB label and info card) and its provenance block.

CREDIT / LICENCE
  Based on observations obtained with Planck (http://www.esa.int/Planck), an ESA science mission
  with instruments and contributions directly funded by ESA Member States, NASA, and Canada.
  ESA's Planck data-use page asks for this acknowledgement; ESA's own CMB images are released
  under "CC BY-SA 3.0 IGO or ESA Standard Licence" (docs/open-data-inventory.md §5).
  Citation: Planck Collaboration 2020, A&A 641, A4 (doi:10.1051/0004-6361/201833881).

usage: .venv/bin/python -I scripts/build_cmb.py [--fits PATH] [--width 4096] [--range-uk 300]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from catio import CACHE, CATS, utcnow, write_catalog_json, write_provenance  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
URL = ("https://irsa.ipac.caltech.edu/data/Planck/release_3/all-sky-maps/maps/component-maps/cmb/"
       "COM_CMB_IQU-smica_2048_R3.00_full.fits")
FITS = CACHE / "planck" / "COM_CMB_IQU-smica_2048_R3.00_full.fits"
OUT_JPG = ROOT / "web" / "public" / "sky" / "planck_smica_cmb.jpg"
Z_CMB = 1090.0
BUDGET = 4 * 1024 * 1024
ACK = ("Based on observations obtained with Planck (http://www.esa.int/Planck), an ESA science mission with "
       "instruments and contributions directly funded by ESA Member States, NASA, and Canada.")
REF = "Planck Collaboration 2020, A&A 641, A4 (Planck 2018 results IV, diffuse component separation; SMICA)"
DOI = "10.1051/0004-6361/201833881"

# --- Moreland 2009, "Diverging Color Maps for Scientific Visualization" (ISVC 2009) -------------
_M = np.array([[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]])
_WHITE = _M @ np.ones(3)


def _srgb_to_lin(c):
    c = np.asarray(c, float)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def _lin_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def _f(t):
    return np.where(t > (6 / 29) ** 3, np.cbrt(t), t / (3 * (6 / 29) ** 2) + 4 / 29)


def _finv(t):
    return np.where(t > 6 / 29, t ** 3, 3 * (6 / 29) ** 2 * (t - 4 / 29))


def rgb_to_msh(rgb255):
    xyz = _M @ _srgb_to_lin(np.asarray(rgb255, float) / 255) / _WHITE
    fx, fy, fz = _f(xyz)
    L, a, b = 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)
    M = np.sqrt(L * L + a * a + b * b)
    return np.array([M, np.arccos(L / M), np.arctan2(b, a)])


def msh_to_rgb(msh):
    M, s, h = msh
    L, a, b = M * np.cos(s), M * np.sin(s) * np.cos(h), M * np.sin(s) * np.sin(h)
    fy = (L + 16) / 116
    xyz = np.array([_finv(fy + a / 500), _finv(fy), _finv(fy - b / 200)]) * _WHITE
    return _lin_to_srgb(np.linalg.solve(_M, xyz)) * 255


def _adjust_hue(msh, m_unsat):
    M, s, h = msh
    if M >= m_unsat:
        return h
    spin = s * np.sqrt(m_unsat ** 2 - M ** 2) / (M * np.sin(s))
    return h + spin if h > -np.pi / 3 else h - spin


def cool_warm(n=256, c1=(59, 76, 192), c2=(180, 4, 38)) -> np.ndarray:
    """n x 3 uint8 table, Moreland's smooth cool-warm diverging map."""
    m1, m2 = rgb_to_msh(c1), rgb_to_msh(c2)
    mmid = max(m1[0], m2[0], 88.0)
    out = []
    for t in np.linspace(0, 1, n):
        a, b = m1.copy(), m2.copy()
        if t < 0.5:
            b, tt = np.array([mmid, 0.0, 0.0]), 2 * t
        else:
            a, tt = np.array([mmid, 0.0, 0.0]), 2 * t - 1
        if a[1] < 0.05 and b[1] > 0.05:
            a[2] = _adjust_hue(b, a[0])
        elif b[1] < 0.05 and a[1] > 0.05:
            b[2] = _adjust_hue(a, b[0])
        out.append(msh_to_rgb((1 - tt) * a + tt * b))
    return np.clip(np.round(np.array(out)), 0, 255).astype(np.uint8)


def main() -> None:
    import healpy as hp
    from astropy.cosmology import Planck18
    import astropy.units as u

    ap = argparse.ArgumentParser()
    ap.add_argument("--fits", type=Path, default=FITS)
    ap.add_argument("--width", type=int, default=4096)
    ap.add_argument("--range-uk", type=float, default=300.0)
    ap.add_argument("--quality", type=int, default=90)
    a = ap.parse_args()
    if not a.fits.exists():
        raise SystemExit(f"{a.fits} missing; download {URL} (2,013,312,960 B) first")

    print("reading I_STOKES_INP, TMASK, TMASKINP ...", flush=True)
    t_inp = hp.read_map(a.fits, field=5, nest=True, dtype=np.float64)  # K_CMB
    tmask = hp.read_map(a.fits, field=3, nest=True, dtype=np.float32)
    inpmask = hp.read_map(a.fits, field=8, nest=True, dtype=np.float32)
    nside = hp.get_nside(t_inp)
    bad = ~np.isfinite(t_inp) | (t_inp < -1e30)
    print(f"Nside {nside}, {t_inp.size} px, bad {bad.sum()}, TMASK keep {tmask.mean():.4f}, "
          f"inpainted fraction {1 - inpmask.mean():.4f}", flush=True)

    # residual monopole + dipole, fitted outside the confidence mask
    m = t_inp.copy()
    m[(tmask < 0.5) | bad] = hp.UNSEEN
    _, mono, dip = hp.remove_dipole(m, nest=True, fitval=True, copy=True)
    del m
    dip = np.asarray(dip, float)
    vx, vy, vz = hp.pix2vec(nside, np.arange(t_inp.size), nest=True)
    t = t_inp - mono - (dip[0] * vx + dip[1] * vy + dip[2] * vz)
    del vx, vy, vz
    t[bad] = 0.0
    dl, db = hp.vec2ang(dip / np.linalg.norm(dip), lonlat=True)
    print(f"removed residual monopole {mono * 1e6:.3f} µK, dipole {np.linalg.norm(dip) * 1e6:.3f} µK "
          f"toward l = {float(dl[0]):.1f}°, b = {float(db[0]):.1f}°", flush=True)
    rms_uk = float(np.std(t[tmask > 0.5]) * 1e6)

    t1024 = hp.ud_grade(t, 1024, order_in="NESTED", order_out="RING")
    W, H = a.width, a.width // 2
    lon = 180.0 - (np.arange(W) + 0.5) * 360.0 / W
    lat = 90.0 - (np.arange(H) + 0.5) * 180.0 / H
    LON, LAT = np.meshgrid(lon, lat)
    print(f"sampling {W}x{H} ...", flush=True)
    img_uk = hp.get_interp_val(t1024, LON.ravel(), LAT.ravel(), lonlat=True).reshape(H, W) * 1e6
    r = a.range_uk
    clipped = float(np.mean(np.abs(img_uk) > r))
    lut = cool_warm(256)
    idx = np.clip(np.round((img_uk + r) / (2 * r) * 255), 0, 255).astype(np.uint8)
    rgb = lut[idx]
    OUT_JPG.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgb, "RGB").save(OUT_JPG, "JPEG", quality=a.quality, optimize=True, progressive=True)
    size = OUT_JPG.stat().st_size
    assert size <= BUDGET, f"{OUT_JPG} is {size} B > 4 MB"

    dc_pc = float(Planck18.comoving_distance(Z_CMB).to_value(u.pc))
    age_kyr = float(Planck18.age(Z_CMB).to_value(u.kyr))
    meta = {
        "source": URL, "column": "I_STOKES_INP", "release": "Planck PR3 (2018) SMICA",
        "projection": "equirectangular Galactic; u = 0.5 - l/360 (l in -180..180, increasing to the left), v = 0.5 + b/180",
        "width": W, "height": H, "range_uK": [-r, r], "clipped_fraction": round(clipped, 6),
        "colormap": "Moreland 2009 smooth cool-warm (Msh), (59,76,192) -> white -> (180,4,38), 256 steps, linear in µK",
        "colormap_anchors": {"-": lut[0].tolist(), "0": lut[128].tolist(), "+": lut[255].tolist()},
        "monopole_removed_uK": round(float(mono) * 1e6, 4), "dipole_removed_uK": round(float(np.linalg.norm(dip)) * 1e6, 4),
        "rms_outside_mask_uK": round(rms_uk, 2), "inpainted_fraction": round(float(1 - inpmask.mean()), 5),
        "tmask_fraction": round(float(tmask.mean()), 5), "z": Z_CMB,
        "comoving_distance_pc_astropy_planck18": dc_pc, "age_at_z_kyr_astropy_planck18": round(age_kyr, 1),
        "jpeg_bytes": size, "built": utcnow(), "acknowledgement": ACK, "ref": REF, "doi": DOI,
    }
    OUT_JPG.with_suffix(".json").write_text(json.dumps(meta, indent=1, ensure_ascii=False) + "\n")

    # the one-entry catalogue behind the label and the info card (src/messengers/cmb.ts places it)
    entry = {
        "name": "CMB", "alt": ["Cosmic microwave background", "Last scattering surface", "Planck SMICA"],
        "kind": "cmb", "ra": None, "dec": None, "dist_pc": round(dc_pc, -3), "mag": None,
        # anchor at the North Galactic Pole of the shell; the viewer moves the label to the shell's limb
        "xyz": [0.0, 0.0, round(dc_pc, -3)],
        "ref": REF, "doi": DOI, "docs": "cmb",
        "facts": {
            "z": Z_CMB, "temp_k": 2.7255, "anisotropy_rms_uk": round(rms_uk, 1),
            "age_at_emission_kyr": round(age_kyr, 0), "comoving_distance_gpc": round(dc_pc / 1e9, 3),
            "map": "Planck PR3 SMICA, inpainted (I_STOKES_INP)", "colour_range": f"±{r:.0f} µK",
        },
        "facts_ref": {
            "temp_k": "Fixsen 2009, ApJ 707, 916 (T0 = 2.72548 ± 0.00057 K)",
            "z": "Planck Collaboration 2020, A&A 641, A6 (z* = 1089.92 ± 0.25)",
            "age_at_emission_kyr": "astropy 8 Planck18 age(z = 1090)",
            "comoving_distance_gpc": "astropy 8 Planck18 comoving_distance(z = 1090)",
        },
    }
    n = write_catalog_json(CATS / "cmb.json", [entry], drop_none=True)  # no ra/dec: a shell, not a point
    write_provenance("cmb", {"built": utcnow(), "sources": [{"url": URL, "bytes": a.fits.stat().st_size, "column": "I_STOKES_INP"}],
                             "texture": str(OUT_JPG.relative_to(ROOT)), "meta": meta, "licence": ACK})
    print(f"{OUT_JPG}: {W}x{H}, {size / 1024:.0f} KB, clipped {clipped * 100:.3f} %, rms {rms_uk:.1f} µK; "
          f"D_C(z={Z_CMB:.0f}) = {dc_pc / 1e6:.2f} Mpc; age {age_kyr:.1f} kyr; cmb.json {n} B")


if __name__ == "__main__":
    main()
