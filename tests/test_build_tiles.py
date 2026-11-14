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
        assert nd["agg"]["n"] >= nd["count"]
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


def test_galaxy_abs_mag_uses_luminosity_distance():
    # same comoving distance, z=1 -> d_L = 2 d_C -> 5 log10(2) = 1.505 mag brighter
    m0 = bt.abs_mag([20.0], [1e9])[0]
    m1 = bt.abs_mag([20.0], [1e9], z=[1.0])[0]
    assert abs((m0 - m1) - 5 * np.log10(2)) < 1e-9


def test_root_aggregate_counts_everything(tmp_path):
    rng = np.random.default_rng(3)
    n = 5000
    pd.DataFrame({"id": [f"S {i}" for i in range(n)], "source_id": np.arange(n, dtype=np.int64),
                  "ra": rng.uniform(0, 360, n), "dec": rng.uniform(-60, 60, n),
                  "dist_pc": rng.uniform(1, 100, n), "dist_lo_pc": 0.9, "dist_hi_pc": 1.1,
                  "mag": rng.uniform(0, 15, n), "color": 1.0, "kind": "star"}).to_parquet(tmp_path / "a.parquet")
    out = tmp_path / "t"
    bt.main(["s", "--src", str(tmp_path), "--out", str(out), "--capacity", "300"])
    meta = json.loads((out / "meta.json").read_text())
    root = next(nd for nd in meta["nodes"] if nd["name"] == "r")
    assert root["agg"]["n"] == n
    ext = np.fromfile(out / "n" / "r.ext.bin", dtype=bt.EXT_DTYPE)
    assert np.allclose(ext["dist_lo"], 0.9) and np.allclose(ext["dist_hi"], 1.1)


def test_rms_matches_direct_computation(tmp_path):
    rng = np.random.default_rng(5)
    n = 4000
    pd.DataFrame({"id": [f"S {i}" for i in range(n)], "source_id": np.arange(n, dtype=np.int64),
                  "ra": rng.uniform(0, 360, n), "dec": rng.uniform(-80, 80, n),
                  "dist_pc": rng.uniform(1e8, 2e9, n), "mag": rng.uniform(14, 22, n), "z": 0.2,
                  "color": np.nan, "kind": "galaxy"}).to_parquet(tmp_path / "a.parquet")
    out = tmp_path / "t"
    bt.main(["g", "--src", str(tmp_path), "--out", str(out), "--capacity", "200",
             "--order", "random", "--kind-model", "galaxy"])
    meta = json.loads((out / "meta.json").read_text())
    root = next(nd for nd in meta["nodes"] if nd["name"] == "r")
    pts, ws = [], []
    for nd in meta["nodes"]:
        rec = np.fromfile(out / "n" / f"{nd['name']}.bin", dtype=bt.RENDER_DTYPE)
        pts.append(np.stack([rec["x"], rec["y"], rec["z"]], 1).astype(float) + nd["center"])
        ws.append(10 ** (-0.4 * (-14.0 - rec["lum"] / 20.0)))
    x, w = np.concatenate(pts), np.concatenate(ws)
    c = (x * w[:, None]).sum(0) / w.sum()
    rms = np.sqrt((w * ((x - c) ** 2).sum(1)).sum() / w.sum())
    assert abs(root["agg"]["rms"] - rms) / rms < 1e-4
    assert np.allclose(np.array(root["agg"]["c"]) + root["center"], c, rtol=1e-6)


# --------------------------------------------------------------------------- velocity stream
FIXTURE = Path(__file__).resolve().parent / "fixtures" / "gaia_dr3_gj710_barnard.json"


def _random_kinematics(n, seed):
    rng = np.random.default_rng(seed)
    return dict(ra=rng.uniform(0, 360, n), dec=np.degrees(np.arcsin(rng.uniform(-1, 1, n))),
                d=10 ** rng.uniform(0, 3, n), pmra=rng.normal(0, 300, n), pmdec=rng.normal(0, 300, n),
                rv=rng.normal(0, 40, n))


def _skycoord(k, rv):
    from astropy.coordinates import SkyCoord
    import astropy.units as u
    return SkyCoord(ra=k["ra"] * u.deg, dec=k["dec"] * u.deg, distance=k["d"] * u.pc,
                    pm_ra_cosdec=k["pmra"] * u.mas / u.yr, pm_dec=k["pmdec"] * u.mas / u.yr,
                    radial_velocity=rv * u.km / u.s, frame="icrs")


def test_space_velocity_matches_astropy_skycoord():
    import astropy.units as u
    k = _random_kinematics(500, 11)
    ours, q = bt.space_velocity_galactic(k["ra"], k["dec"], k["d"], k["pmra"], k["pmdec"], k["rv"])
    c = _skycoord(k, k["rv"])
    ref = c.galactic.velocity.d_xyz.to(u.km / u.s).value.T
    assert np.max(np.abs(ours - ref)) < 1e-9 * max(1.0, np.max(np.abs(ref)))
    assert np.all(q == bt.VEL_Q_FULL)
    # velocity axes = position axes
    pos = c.galactic.cartesian.xyz.to(u.pc).value.T
    assert np.allclose(bt.radec_dist_to_galactic_xyz(k["ra"], k["dec"], k["d"]), pos, rtol=1e-12, atol=1e-9)


def test_missing_rv_gives_tangential_only_velocity():
    import astropy.units as u
    k = _random_kinematics(200, 12)
    rv = k["rv"].copy()
    rv[::2] = np.nan
    ours, q = bt.space_velocity_galactic(k["ra"], k["dec"], k["d"], k["pmra"], k["pmdec"], rv)
    ref = _skycoord(k, np.where(np.isnan(rv), 0.0, rv)).galactic.velocity.d_xyz.to(u.km / u.s).value.T
    assert np.allclose(ours, ref, atol=1e-9)
    assert np.all(q[::2] == bt.VEL_Q_TANGENTIAL) and np.all(q[1::2] == bt.VEL_Q_FULL)
    # tangential-only: no component along the line of sight
    x = bt.radec_dist_to_galactic_xyz(k["ra"], k["dec"], k["d"])
    los = np.einsum("ij,ij->i", ours, x / np.linalg.norm(x, axis=1)[:, None])
    assert np.max(np.abs(los[::2])) < 1e-9
    # no proper motion -> no velocity
    v0, q0 = bt.space_velocity_galactic([10.0], [20.0], [5.0], [np.nan], [np.nan], [12.0])
    assert np.all(v0 == 0) and q0[0] == bt.VEL_Q_NONE


def test_lsr_option_matches_astropy_galacticlsr():
    from astropy.coordinates import GalacticLSR
    import astropy.units as u
    k = _random_kinematics(300, 13)
    ours, _ = bt.space_velocity_galactic(k["ra"], k["dec"], k["d"], k["pmra"], k["pmdec"], k["rv"], frame="lsr")
    lsr = _skycoord(k, k["rv"]).transform_to(GalacticLSR(v_bary=[11.1, 12.24, 7.25] * u.km / u.s))
    ref = lsr.velocity.d_xyz.to(u.km / u.s).value.T
    assert np.max(np.abs(ours - ref)) < 1e-8 * max(1.0, np.max(np.abs(ref)))


def _fixture_frame(stars):
    return pd.DataFrame({
        "id": [f"Gaia DR3 {s['source_id']}" for s in stars], "source_id": [s["source_id"] for s in stars],
        "ra": [s["ra"] for s in stars], "dec": [s["dec"] for s in stars], "dist_pc": [s["r_med_geo"] for s in stars],
        "dist_lo_pc": [s["r_lo_geo"] for s in stars], "dist_hi_pc": [s["r_hi_geo"] for s in stars],
        "mag": np.array([s["phot_g_mean_mag"] for s in stars], np.float32),
        "color": np.array([s["bp_rp"] for s in stars], np.float32), "kind": "star",
        "pmra": [s["pmra"] for s in stars], "pmdec": [s["pmdec"] for s in stars],
        "radial_velocity": np.array([s["radial_velocity"] for s in stars], np.float32),
    })


def _read_tile_points(out):
    """(meta, ids, xyz, vel, q) of every point of a built tile set, decoded as the viewer does."""
    meta = json.loads((out / "meta.json").read_text())
    ids, xyz, vel, q = [], [], [], []
    for nd in meta["nodes"]:
        rec = np.fromfile(out / "n" / f"{nd['name']}.bin", dtype=bt.RENDER_DTYPE)
        ext = np.fromfile(out / "n" / f"{nd['name']}.ext.bin", dtype=bt.EXT_DTYPE)
        v = np.fromfile(out / "n" / f"{nd['name']}.vel.bin", dtype=bt.VEL_DTYPE)
        assert len(v) == len(rec) == nd["count"]
        ids.append(ext["id"])
        xyz.append(np.stack([rec["x"], rec["y"], rec["z"]], 1).astype(np.float64) + nd["center"])
        vel.append(np.stack([v["vx"], v["vy"], v["vz"]], 1).astype(np.float64))
        q.append(v["q"].astype(np.float64))
    return meta, np.concatenate(ids), np.concatenate(xyz), np.concatenate(vel), np.concatenate(q)


def test_velocity_stream_roundtrip_and_meta(tmp_path):
    k = _random_kinematics(3000, 14)
    rv = k["rv"].astype(np.float32)
    rv[::3] = np.nan
    n = len(rv)
    pd.DataFrame({"id": [f"S {i}" for i in range(n)], "source_id": np.arange(n, dtype=np.int64),
                  "ra": k["ra"], "dec": k["dec"], "dist_pc": k["d"], "mag": 10.0, "color": 1.0, "kind": "star",
                  "pmra": k["pmra"], "pmdec": k["pmdec"], "radial_velocity": rv}).to_parquet(tmp_path / "a.parquet")
    out = tmp_path / "t"
    bt.main(["s", "--src", str(tmp_path), "--out", str(out), "--capacity", "200"])
    meta, ids, xyz, vel, q = _read_tile_points(out)
    v = meta["velocity"]
    assert v["unit"] == "km/s" and v["frame"] == "galactic" and v["encoding"] == "vx_vy_vz_q_f16"
    assert v["bytesPerPoint"] == 8 and v["origin"] == "sun" and v["sunVelocity"] == [0.0, 0.0, 0.0]
    n_tan = len(rv[::3])
    assert v["counts"] == {"full": n - n_tan, "tangential": n_tan, "none": 0}
    assert meta["record"] == "xyz_f32_rgb_u8_lum_u8" and meta["bytesPerPoint"] == 16  # old records untouched
    assert meta["extBytesPerPoint"] == 24
    ref, refq = bt.space_velocity_galactic(k["ra"], k["dec"], k["d"], k["pmra"], k["pmdec"], rv)
    i = ids.astype(np.int64)
    # float16: relative rounding error <= 2^-11 per component
    assert np.all(np.abs(vel - ref[i]) <= np.abs(ref[i]) * 2.0 ** -11 + 1e-7)
    assert np.array_equal(q, refq[i])
    for nd in meta["nodes"]:
        vv = np.fromfile(out / "n" / f"{nd['name']}.vel.bin", dtype=bt.VEL_DTYPE)
        sp = np.linalg.norm(np.stack([vv["vx"], vv["vy"], vv["vz"]], 1).astype(np.float64), axis=1)
        assert nd["vmax"] >= sp.max() and nd["vmax"] - sp.max() <= 0.1 + 1e-9


def test_velocity_off_keeps_old_layout(tmp_path):
    k = _random_kinematics(100, 15)
    pd.DataFrame({"id": [f"S {i}" for i in range(100)], "source_id": np.arange(100, dtype=np.int64),
                  "ra": k["ra"], "dec": k["dec"], "dist_pc": k["d"], "mag": 10.0, "color": 1.0, "kind": "star",
                  "pmra": k["pmra"], "pmdec": k["pmdec"]}).to_parquet(tmp_path / "a.parquet")
    out = tmp_path / "t"
    bt.main(["s", "--src", str(tmp_path), "--out", str(out), "--velocity", "off"])
    meta = json.loads((out / "meta.json").read_text())
    assert "velocity" not in meta and not list((out / "n").glob("*.vel.bin"))
    assert all("vmax" not in nd for nd in meta["nodes"])


def test_gliese_710_close_approach_from_tiles(tmp_path):
    """Gaia DR3 astrometry of Gl 710 (fixture, fetched 2026-11-13) through the tile pipeline and its
    float16 velocity stream. Literature, Galactic-orbit integration of the same DR3 data:
    t = 1.324 +- 0.026 Myr, d = 0.052 +- 0.002 pc (Bobylev & Bajkova 2022, arXiv:2206.14443);
    Gaia DR2: 95 % probability below 0.08 pc (Bailer-Jones et al. 2018, A&A 616, A37)."""
    stars = json.loads(FIXTURE.read_text())["stars"]
    _fixture_frame(stars).to_parquet(tmp_path / "a.parquet")
    out = tmp_path / "t"
    bt.main(["gj", "--src", str(tmp_path), "--out", str(out), "--id-prefix", "Gaia DR3 "])
    meta, ids, xyz, vel, q = _read_tile_points(out)
    j = int(np.flatnonzero(ids == 4270814637616488064)[0])
    assert q[j] == bt.VEL_Q_FULL
    t, d = bt.closest_approach(xyz[j], vel[j])
    assert 1.25 < t[0] < 1.40, t
    assert d[0] < 0.08, d
    # float64 (no tile quantisation) for the same star
    s = stars[0]
    x64 = bt.radec_dist_to_galactic_xyz([s["ra"]], [s["dec"]], [s["r_med_geo"]])
    v64, _ = bt.space_velocity_galactic([s["ra"]], [s["dec"]], [s["r_med_geo"]], [s["pmra"]], [s["pmdec"]], [s["radial_velocity"]])
    t64, d64 = bt.closest_approach(x64, v64)
    assert abs(t64[0] - t[0]) < 0.01 and abs(d64[0] - d[0]) < 0.01


def test_barnards_star_10_kyr_matches_astropy_space_motion(tmp_path):
    """Barnard's Star moved 10 kyr with the tile velocity (float16) vs astropy's linear space motion
    (SkyCoord.apply_space_motion) from the same DR3 values; and its present angular speed vs
    SIMBAD's proper motion (pmra -801.551, pmdec 10362.394 mas/yr)."""
    from astropy.coordinates import SkyCoord
    from astropy.time import Time
    import astropy.units as u
    stars = json.loads(FIXTURE.read_text())["stars"]
    _fixture_frame(stars).to_parquet(tmp_path / "a.parquet")
    out = tmp_path / "t"
    bt.main(["bs", "--src", str(tmp_path), "--out", str(out)])
    meta, ids, xyz, vel, q = _read_tile_points(out)
    j = int(np.flatnonzero(ids == 4472832130942575872)[0])
    s = stars[1]
    c = SkyCoord(ra=s["ra"] * u.deg, dec=s["dec"] * u.deg, distance=s["r_med_geo"] * u.pc,
                 pm_ra_cosdec=s["pmra"] * u.mas / u.yr, pm_dec=s["pmdec"] * u.mas / u.yr,
                 radial_velocity=s["radial_velocity"] * u.km / u.s, obstime=Time(2016.0, format="jyear"))
    later = c.apply_space_motion(dt=10_000 * u.yr).galactic.cartesian.xyz.to(u.pc).value
    ours = xyz[j] + vel[j] * 0.01 * bt.PC_PER_KMS_MYR
    assert np.linalg.norm(ours - later) < 2e-3  # pc, after 10 kyr
    # present angular speed from the tile velocity: |v_tan| / (k d)
    x = xyz[j] / np.linalg.norm(xyz[j])
    vt = vel[j] - x * (vel[j] @ x)
    mu = np.linalg.norm(vt) / (bt.KMS_PER_MASYR_PC * np.linalg.norm(xyz[j]))  # mas/yr
    simbad = np.hypot(-801.551, 10362.394)
    assert abs(mu - simbad) / simbad < 1e-3
