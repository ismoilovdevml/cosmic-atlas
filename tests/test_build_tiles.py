import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pipeline"))
import build_tiles as bt  # noqa: E402


def test_galactic_matrix_matches_astropy():
    from astropy.coordinates import SkyCoord
    import astropy.units as u
    rng = np.random.default_rng(1)
    ra, dec = rng.uniform(0, 360, 200), np.degrees(np.arcsin(rng.uniform(-1, 1, 200)))
    d = 10 ** rng.uniform(0, 9.5, 200)
    ours = bt.radec_dist_to_galactic_xyz(ra, dec, d)
    ref = SkyCoord(ra=ra * u.deg, dec=dec * u.deg, distance=d * u.pc).galactic.cartesian.xyz.to(u.pc).value.T
    assert np.max(np.abs(ours - ref) / d[:, None]) < 1e-12


def test_sirius_contract_example():
    xyz = bt.radec_dist_to_galactic_xyz([101.287155], [-16.716116], [2.6371])[0]
    assert np.allclose(xyz, [-1.769, -1.913, -0.408], atol=1e-3)


def test_blackbody_colours_are_ordered():
    hot, sun, cool = bt.blackbody_srgb(np.array([30000.0, 5800.0, 3000.0]))
    assert hot[2] > hot[0]          # hot stars are blue
    assert cool[0] > cool[2]        # cool stars are red
    assert sun.min() > 0.75         # the Sun is close to white


def test_lum_code_range():
    # Sun at 10 pc: G = 4.67 -> M = 4.67 -> code 153
    assert bt.lum_code([4.67], [10.0], "star")[0] == 153
    assert bt.lum_code([np.nan], [10.0], "star")[0] == 150


@pytest.mark.parametrize("order,model", [("lum", "star"), ("random", "galaxy")])
def test_roundtrip(tmp_path, order, model):
    rng = np.random.default_rng(7)
    n = 23_456
    df = pd.DataFrame({
        "id": [f"X {i}" for i in range(n)],
        "source_id": np.arange(n, dtype=np.int64) + 10**15,
        "ra": rng.uniform(0, 360, n),
        "dec": np.degrees(np.arcsin(rng.uniform(-1, 1, n))),
        "dist_pc": rng.uniform(1, 1000, n),
        "mag": rng.uniform(-1, 20, n).astype(np.float32),
        "color": rng.uniform(-0.3, 4, n).astype(np.float32),
        "z": rng.uniform(0, 1.5, n),
        "kind": np.where(rng.random(n) < 0.1, "qso", model),
    })
    src = tmp_path / "raw"
    src.mkdir()
    df.to_parquet(src / "a.parquet")
    out = tmp_path / "tiles"
    bt.main(["t", "--src", str(src), "--out", str(out), "--order", order,
             "--kind-model", model, "--capacity", "1000"])
    meta = json.loads((out / "meta.json").read_text())
    assert meta["count"] == n
    names = {nd["name"] for nd in meta["nodes"]}
    seen_ids, total = [], 0
    for nd in meta["nodes"]:
        rec = np.fromfile(out / "n" / f"{nd['name']}.bin", dtype=bt.RENDER_DTYPE)
        ext = np.fromfile(out / "n" / f"{nd['name']}.ext.bin", dtype=bt.EXT_DTYPE)
        assert len(rec) == len(ext) == nd["count"] <= 1000
        rel = np.stack([rec["x"], rec["y"], rec["z"]], 1)
        assert np.all(np.abs(rel) <= nd["half"] * 1.0001)  # inside its cube
        for c in range(8):
            assert bool(nd["children"] & (1 << c)) == (nd["name"] + str(c) in names)
        seen_ids.append(ext["id"])
        total += len(rec)
    assert total == n
    ids = np.sort(np.concatenate(seen_ids))
    assert np.array_equal(ids, np.arange(n, dtype=np.uint64) + 10**15)
    # world position of one point reproduces the input
    root = next(nd for nd in meta["nodes"] if nd["name"] == "r")
    rec = np.fromfile(out / "n" / "r.bin", dtype=bt.RENDER_DTYPE)
    ext = np.fromfile(out / "n" / "r.ext.bin", dtype=bt.EXT_DTYPE)
    i = int(ext["id"][0] - 10**15)
    world = np.array([rec["x"][0], rec["y"][0], rec["z"][0]], float) + root["center"]
    expect = bt.radec_dist_to_galactic_xyz([df.ra[i]], [df.dec[i]], [df.dist_pc[i]])[0]
    assert np.allclose(world, expect, atol=1e-3)
    if order == "lum":  # root holds the brightest
        root_lum = rec["lum"].astype(int)
        deep = [nd for nd in meta["nodes"] if len(nd["name"]) > 2]
        deep_lum = np.fromfile(out / "n" / f"{deep[0]['name']}.bin", dtype=bt.RENDER_DTYPE)["lum"].astype(int)
        assert root_lum.min() >= deep_lum.max() - 1
