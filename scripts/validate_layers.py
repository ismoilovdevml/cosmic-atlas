#!/usr/bin/env python
"""Sanity checks for the extragalactic + named-object layers (prints a plain-text report).

Checks: row counts / file sizes, DESI redshift histogram, Planck18 comoving distances, Local Group
landmarks against literature ranges, named-star spot checks against a live SIMBAD query, and
xyz in every catalogue JSON recomputed independently with astropy SkyCoord(...).galactic.cartesian.
Exit code 1 if any landmark check fails.
"""
from __future__ import annotations

import glob
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow.parquet as pq
import astropy.units as u
from astropy.coordinates import SkyCoord
from astropy.cosmology import Planck18

sys.path.insert(0, str(Path(__file__).resolve().parent))
from catio import ROOT, SIMBAD_TAP, tap_sync  # noqa: E402
from coords import comoving_pc  # noqa: E402

RAW = ROOT / "data" / "raw"
CATS = ROOT / "data" / "tiles" / "catalogs"
# literature ranges (pc) used as pass/fail bounds
LANDMARKS = {
    "Andromeda (M31)": (7.6e5, 7.9e5),   # task spec 0.76-0.79 Mpc
    "Triangulum": (7.5e5, 9.0e5),        # M33 0.79-0.86 Mpc (Cepheid/TRGB literature spread)
    "LMC": (4.8e4, 5.2e4),               # 49.6 kpc (Pietrzynski+ 2019)
    "SMC": (5.9e4, 6.6e4),               # 62.4 kpc (Graczyk+ 2020)
    "Leo I": (2.4e5, 2.7e5),             # ~254 kpc
    "NGC 300": (1.9e6, 2.2e6),           # ~2.0-2.1 Mpc
}
STARS = {"Sirius": "* alf CMa", "Vega": "* alf Lyr", "Polaris": "* alf UMi", "Betelgeuse": "* alf Ori",
         "Proxima Centauri": "NAME Proxima Centauri"}


def human(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.0f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


def main() -> int:
    fail = 0
    print("== layers")
    for f in sorted(glob.glob(str(RAW / "*" / "*.parquet"))):
        print(f"  {Path(f).relative_to(ROOT)}: {pq.read_metadata(f).num_rows:,} rows, {human(Path(f).stat().st_size)}")
    for f in sorted(glob.glob(str(CATS / "*.json"))):
        e = json.load(open(f))
        print(f"  {Path(f).relative_to(ROOT)}: {len(e)} entries, {human(Path(f).stat().st_size)}, "
              f"{sum(x.get('xyz') is None for x in e)} without xyz")
    raw_total = sum(p.stat().st_size for p in RAW.rglob("*") if p.is_file())
    print(f"  data/raw total on disk: {human(raw_total)}")

    print("== Planck18 comoving distance")
    for z in (0.1, 1.0):
        print(f"  z={z}: interp {comoving_pc(z)/1e6:.2f} Mpc, astropy exact {Planck18.comoving_distance(z).to_value(u.Mpc):.2f} Mpc")

    desi = RAW / "galaxies-desi" / "galaxies-desi.parquet"
    if desi.exists():
        print("== DESI DR1")
        t = pq.read_table(desi, columns=["z", "kind", "mag"]).to_pandas()
        print(f"  rows {len(t):,}; by kind {t['kind'].value_counts().to_dict()}; r mag available {np.isfinite(t['mag']).sum():,}")
        edges = np.round(np.arange(0, 7.01, 0.1), 1)
        h, _ = np.histogram(t["z"], edges)
        for k in np.nonzero(h)[0]:
            print(f"  z {edges[k]:.1f}-{edges[k+1]:.1f}: {h[k]:,}")

    print("== Local Group landmarks (local-group.json)")
    lg = {x["name"]: x for x in json.load(open(CATS / "local-group.json"))}
    for n, (lo, hi) in LANDMARKS.items():
        x = lg.get(n)
        ok = x is not None and lo <= x["dist_pc"] <= hi
        fail += not ok
        print(f"  {'PASS' if ok else 'FAIL'} {n}: ra {x['ra']:.4f} dec {x['dec']:.4f} d {x['dist_pc']/1e3:.1f} kpc "
              f"(expected {lo/1e3:.0f}-{hi/1e3:.0f}) xyz {x['xyz']}")

    print("== named stars vs live SIMBAD")
    ns = {x["name"]: x for x in json.load(open(CATS / "named-stars.json"))}
    ids = ",".join("'" + v + "'" for v in STARS.values())
    sb = tap_sync(SIMBAD_TAP, "SELECT i.id, b.ra, b.dec, b.plx_value, f.V FROM ident AS i JOIN basic AS b ON "
                              f"b.oid = i.oidref LEFT JOIN allfluxes AS f ON f.oidref = b.oid WHERE i.id IN ({ids})")
    sb["id"] = sb["id"].map(lambda s: " ".join(str(s).split()))
    sb = sb.set_index("id")
    for n, sid in STARS.items():
        x, s = ns[n], sb.loc[sid]
        sep = SkyCoord(x["ra"] * u.deg, x["dec"] * u.deg).separation(SkyCoord(s.ra * u.deg, s.dec * u.deg)).arcsec
        print(f"  {n}: ours d={x['dist_pc']:.4g} pc V={x['mag']} ({x['dist_method']}); SIMBAD 1000/plx="
              f"{1000/s.plx_value:.4g} pc V={s.V}; sep {sep:.2f}\"; alt {x['alt'][:4]}")

    print("== xyz recomputed with astropy")
    for f in sorted(glob.glob(str(CATS / "*.json"))):
        e = [x for x in json.load(open(f)) if x.get("xyz") is not None and x.get("dist_pc")]
        if not e:
            continue
        c = SkyCoord(ra=[x["ra"] for x in e] * u.deg, dec=[x["dec"] for x in e] * u.deg,
                     distance=[x["dist_pc"] for x in e] * u.pc).galactic.cartesian
        ref = np.column_stack([c.x.to_value(u.pc), c.y.to_value(u.pc), c.z.to_value(u.pc)])
        got = np.array([x["xyz"] for x in e])
        rel = np.max(np.linalg.norm(got - ref, axis=1) / np.array([x["dist_pc"] for x in e]))
        print(f"  {Path(f).name}: max |dxyz|/d = {rel:.1e}")
    return 1 if fail else 0


if __name__ == "__main__":
    sys.exit(main())
