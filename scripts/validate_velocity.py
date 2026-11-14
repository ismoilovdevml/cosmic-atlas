"""Check the velocity stream (docs/data-contract.md section 3) on two well-studied stars.

Gaia DR3 astrometry of Gliese 710 and Barnard's Star (tests/fixtures/gaia_dr3_gj710_barnard.json)
goes through pipeline/build_tiles.py into a throwaway tile set; the float16 velocity stream is read
back exactly as the viewer reads it and propagated linearly (x(t) = x0 + v t, heliocentric).

  Gliese 710   : closest approach time and distance vs the literature
  Barnard's Star: angular motion over 10 kyr vs SIMBAD's proper motion, and its closest approach

With --tiles <dir> it also reports the same numbers for every star of a built layer that lies within
`--radius` pc of the Sun at closest approach (encounter list of that layer).

usage: .venv/bin/python scripts/validate_velocity.py [--tiles data/tiles/stars-gaia-preview]
"""
from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))
import build_tiles as bt  # noqa: E402

FIXTURE = ROOT / "tests/fixtures/gaia_dr3_gj710_barnard.json"
AU_PER_PC = 206264.806


def read_layer(out: Path):
    meta = json.loads((out / "meta.json").read_text())
    if "velocity" not in meta:
        raise SystemExit(f"{out}: no velocity stream in meta.json")
    ids, xyz, vel, q = [], [], [], []
    for nd in meta["nodes"]:
        rec = np.fromfile(out / "n" / f"{nd['name']}.bin", dtype=bt.RENDER_DTYPE)
        ext = np.fromfile(out / "n" / f"{nd['name']}.ext.bin", dtype=bt.EXT_DTYPE)
        v = np.fromfile(out / "n" / f"{nd['name']}.vel.bin", dtype=bt.VEL_DTYPE)
        ids.append(ext["id"])
        # float32 relative to the node centre, then float64 world, like the viewer
        xyz.append(np.stack([rec["x"], rec["y"], rec["z"]], 1).astype(np.float64) + nd["center"])
        vel.append(np.stack([v["vx"], v["vy"], v["vz"]], 1).astype(np.float64) - meta["velocity"]["sunVelocity"])
        q.append(v["q"].astype(np.float64))
    return meta, np.concatenate(ids), np.concatenate(xyz), np.concatenate(vel), np.concatenate(q)


def gal_to_radec(xyz):
    icrs = np.asarray(xyz) @ bt.ICRS_TO_GAL  # inverse rotation = transpose
    d = np.linalg.norm(icrs, axis=-1)
    return np.degrees(np.arctan2(icrs[..., 1], icrs[..., 0])) % 360, np.degrees(np.arcsin(icrs[..., 2] / d)), d


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--tiles", help="also list close encounters in this built layer")
    ap.add_argument("--radius", type=float, default=1.0, help="encounter list radius, pc")
    a = ap.parse_args(argv)
    stars = json.loads(FIXTURE.read_text())["stars"]
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "raw"
        src.mkdir()
        pd.DataFrame({
            "id": [f"Gaia DR3 {s['source_id']}" for s in stars], "source_id": [s["source_id"] for s in stars],
            "ra": [s["ra"] for s in stars], "dec": [s["dec"] for s in stars], "dist_pc": [s["r_med_geo"] for s in stars],
            "mag": np.array([s["phot_g_mean_mag"] for s in stars], np.float32),
            "color": np.array([s["bp_rp"] for s in stars], np.float32), "kind": "star",
            "pmra": [s["pmra"] for s in stars], "pmdec": [s["pmdec"] for s in stars],
            "radial_velocity": np.array([s["radial_velocity"] for s in stars], np.float32),
        }).to_parquet(src / "a.parquet")
        out = Path(tmp) / "tiles"
        bt.main(["check", "--src", str(src), "--out", str(out)])
        meta, ids, xyz, vel, q = read_layer(out)

    print("\n== Gliese 710 (Gaia DR3 4270814637616488064), linear motion from the tile stream")
    j = int(np.flatnonzero(ids == 4270814637616488064)[0])
    t, d = bt.closest_approach(xyz[j], vel[j])
    print(f"  now: d = {np.linalg.norm(xyz[j]):.4f} pc, |v| = {np.linalg.norm(vel[j]):.3f} km/s, q = {q[j]:+.0f}")
    print(f"  closest approach: t = {t[0]:.4f} Myr, d_min = {d[0]:.5f} pc = {d[0] * AU_PER_PC:,.0f} au")
    s = stars[0]
    x64 = bt.radec_dist_to_galactic_xyz([s["ra"]], [s["dec"]], [s["r_med_geo"]])
    v64, _ = bt.space_velocity_galactic([s["ra"]], [s["dec"]], [s["r_med_geo"]], [s["pmra"]], [s["pmdec"]], [s["radial_velocity"]])
    t64, d64 = bt.closest_approach(x64, v64)
    print(f"  float64 (no f16/f32 quantisation): t = {t64[0]:.4f} Myr, d_min = {d64[0]:.5f} pc")
    # sensitivity: 1-sigma Monte Carlo over the DR3 errors (independent, no correlations: an approximation)
    rng = np.random.default_rng(1)
    n = 20000
    plx = rng.normal(s["parallax"], s["parallax_error"], n)
    mc = bt.space_velocity_galactic(np.full(n, s["ra"]), np.full(n, s["dec"]), 1000 / plx,
                                    rng.normal(s["pmra"], s["pmra_error"], n), rng.normal(s["pmdec"], s["pmdec_error"], n),
                                    rng.normal(s["radial_velocity"], s["radial_velocity_error"], n))[0]
    tm, dm = bt.closest_approach(bt.radec_dist_to_galactic_xyz(np.full(n, s["ra"]), np.full(n, s["dec"]), 1000 / plx), mc)
    p = lambda a: np.percentile(a, [5, 50, 95])
    print(f"  Monte Carlo over DR3 1-sigma errors (1/parallax distance, no correlations), 5/50/95 %:"
          f" t = {p(tm).round(4)} Myr, d_min = {p(dm).round(4)} pc")
    print("  literature: Bobylev & Bajkova 2022 (DR3, orbit integration) t = 1.324 +- 0.026 Myr, d = 0.052 +- 0.002 pc;"
          " Bailer-Jones et al. 2018 (DR2): 95 % below 0.08 pc; de la Fuente Marcos 2018 (DR2) confirm ~1.3 Myr")

    print("\n== Barnard's Star (Gaia DR3 4472832130942575872)")
    j = int(np.flatnonzero(ids == 4472832130942575872)[0])
    ra0, de0, d0 = gal_to_radec(xyz[j])
    for kyr in (1, 10):
        x1 = xyz[j] + vel[j] * kyr * 1e-3 * bt.PC_PER_KMS_MYR
        ra1, de1, d1 = gal_to_radec(x1)
        u0, u1 = xyz[j] / d0, x1 / d1
        sep = np.degrees(np.arccos(np.clip(u0 @ u1, -1, 1)))
        print(f"  +{kyr:>2} kyr: moved {sep:.4f} deg on the sky (SIMBAD pm x t, first order: "
              f"{np.hypot(-801.551, 10362.394) * kyr * 1e3 / 3.6e6:.4f} deg), RA/Dec {ra1:.3f}/{de1:+.3f}, d = {d1:.4f} pc")
    t, d = bt.closest_approach(xyz[j], vel[j])
    print(f"  closest approach: t = {t[0] * 1e3:.3f} kyr (AD {2016 + t[0] * 1e6:.0f}), d_min = {d[0]:.4f} pc = {d[0] * 3.26156:.3f} ly")
    print("  commonly quoted: closest ~AD 11 800 at ~3.75 ly (1.15 pc), a linear-motion figure"
          " (secondary sources; primary not re-checked here)")
    print("  note: the on-sky motion is NOT pm x t over 10 kyr: the star approaches (perspective acceleration),"
          " so the full 3D linear path is the right comparison (tests: vs astropy apply_space_motion)")

    if a.tiles:
        meta, ids, xyz, vel, q = read_layer(Path(a.tiles))
        t, d = bt.closest_approach(xyz, vel)
        full = q == bt.VEL_Q_FULL
        sel = np.flatnonzero(full & (d < a.radius) & (np.abs(t) < 5))
        print(f"\n== {a.tiles}: {len(ids)} stars, {full.sum()} with RV; encounters within {a.radius} pc, |t| < 5 Myr: {len(sel)}")
        for i in sel[np.argsort(d[sel])][:25]:
            print(f"  Gaia DR3 {ids[i]}  t = {t[i]:+.3f} Myr  d_min = {d[i]:.3f} pc  now {np.linalg.norm(xyz[i]):.2f} pc")
        for name, sid in (("Gliese 710", 4270814637616488064), ("Barnard's Star", 4472832130942575872)):
            print(f"  {name} in this layer: {'yes' if np.any(ids == sid) else 'no'}")


if __name__ == "__main__":
    main()
