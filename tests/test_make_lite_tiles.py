"""scripts/make_lite_tiles.py and scripts/write_tiles_index.py on small tile sets built by
pipeline/build_tiles.py (no real data needed)."""
import json
import shutil
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "pipeline"))
sys.path.insert(0, str(REPO / "scripts"))
import build_tiles as bt  # noqa: E402
import make_lite_tiles as ml  # noqa: E402
import write_tiles_index as wi  # noqa: E402


def _layer(tmp: Path, name: str, n: int, model: str, seed: int, capacity: int) -> Path:
    rng = np.random.default_rng(seed)
    raw = tmp / "raw" / name
    raw.mkdir(parents=True)
    far = model == "galaxy"
    pd.DataFrame({
        "id": [f"X {i}" for i in range(n)], "source_id": np.arange(n, dtype=np.int64),
        "ra": rng.uniform(0, 360, n), "dec": np.degrees(np.arcsin(rng.uniform(-1, 1, n))),
        "dist_pc": rng.uniform(1e7, 2e9, n) if far else rng.uniform(1, 1000, n),
        "mag": rng.uniform(12, 22, n) if far else rng.uniform(-1, 18, n),
        "color": rng.uniform(-0.3, 3, n), "z": rng.uniform(0, 0.5, n), "kind": model,
    }).to_parquet(raw / "a.parquet")
    out = tmp / "tiles" / name
    bt.main([name, "--src", str(raw), "--out", str(out), "--capacity", str(capacity),
             "--order", "random" if far else "lum", "--kind-model", model])
    return out


@pytest.fixture(scope="module")
def tiles(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("lite")
    _layer(tmp, "gal", 30_000, "galaxy", 1, 300)
    _layer(tmp, "star", 20_000, "star", 2, 300)
    _layer(tmp, "small", 500, "galaxy", 3, 300)
    (tmp / "tiles" / "catalogs").mkdir()
    (tmp / "tiles" / "catalogs" / "named.json").write_text('[{"name": "A", "kind": "star", "xyz": [1, 2, 3], "dist_pc": 3.7}]')
    return tmp / "tiles"


def _size(d: Path) -> int:
    return sum(p.stat().st_size for p in d.rglob("*") if p.is_file())


def _meta(d: Path, layer: str) -> dict:
    return json.loads((d / layer / "meta.json").read_text())


def test_index_matches_dev_server_rules(tiles):
    idx = wi.build_index(tiles)
    assert idx == {"layers": ["gal", "small", "star"], "catalogs": ["named.json"]}


def test_whole_set_fits_is_copied_unchanged(tiles, tmp_path):
    out = tmp_path / "out"
    ml.main([str(out), "--src", str(tiles), "--budget-mb", "100"])
    for layer in ("gal", "star", "small"):
        assert (out / layer / "meta.json").read_text() == (tiles / layer / "meta.json").read_text()
        assert "lite" not in _meta(out, layer)
    assert json.loads((out / "_index.json").read_text()) == wi.build_index(tiles)
    assert (out / "catalogs" / "named.json").is_file()


def test_pruned_set_is_closed_conserves_points_and_light(tiles, tmp_path):
    out = tmp_path / "out"
    full_bytes = _size(tiles)
    budget = 0.45 * full_bytes
    ml.main([str(out), "--src", str(tiles), "--budget-mb", str(budget / 1e6)])
    assert _size(out) <= budget
    rep = json.loads((out / "_lite.json").read_text())
    assert rep["layers"]["small"]["lite"] is False          # small layer fits its share, kept whole
    for layer in ("gal", "star"):
        full, lite = _meta(tiles, layer), _meta(out, layer)
        assert lite["lite"] is True and lite["fullCount"] == full["count"] and lite["fullNodes"] == len(full["nodes"])
        fby = {nd["name"]: nd for nd in full["nodes"]}
        names = {nd["name"] for nd in lite["nodes"]}
        assert 1 < len(names) < len(fby)
        dropped_n = dropped_L = own_L = 0.0
        for nd in lite["nodes"]:
            f = fby[nd["name"]]
            assert nd["agg"] == f["agg"]                     # parents keep their subtree aggregate
            assert nd["name"] == "r" or nd["name"][:-1] in names   # closed toward the root
            for k in range(8):                                # masks only name kept children
                assert bool(nd["children"] & (1 << k)) == (nd["name"] + str(k) in names)
                if f["children"] & (1 << k) and nd["name"] + str(k) not in names:
                    assert "dropped" in nd
            # files: kept nodes copied byte for byte
            for suf in (".bin", ".ext.bin"):
                assert (out / layer / "n" / f"{nd['name']}{suf}").read_bytes() == (tiles / layer / "n" / f"{nd['name']}{suf}").read_bytes()
            d = nd.get("dropped")
            if d:
                dropped_n += d["n"]
                dropped_L += d["L"]
                # agg.L = own + kept children + dropped
                kids = sum(fby[nd["name"] + str(k)]["agg"]["L"] for k in range(8) if nd["children"] & (1 << k))
                own = ml.own_light(f, fby)
                assert abs(own + kids + d["L"] - f["agg"]["L"]) <= 1e-4 * f["agg"]["L"]
            own_L += ml.own_light(f, fby)
        # every dropped node's file is gone
        for name in set(fby) - names:
            assert not (out / layer / "n" / f"{name}.bin").exists()
        assert lite["count"] + dropped_n == full["count"]
        root_L = fby["r"]["agg"]["L"]
        assert abs(own_L + dropped_L - root_L) / root_L < 1e-4
        # breadth first: every kept depth except the deepest is complete
        depth = max(len(n) for n in names)
        for n, f in fby.items():
            if len(n) < depth:
                assert n in names


def test_dropped_rms_and_centroid_match_point_moments(tiles, tmp_path):
    """The merged `dropped` aggregate equals the light moments of the dropped points themselves."""
    out = tmp_path / "out"
    ml.main([str(out), "--src", str(tiles), "--budget-mb", str(0.3 * _size(tiles) / 1e6)])
    full, lite = _meta(tiles, "gal"), _meta(out, "gal")
    fby = {nd["name"]: nd for nd in full["nodes"]}
    nd = next(nd for nd in lite["nodes"] if "dropped" in nd)
    kept = {x["name"] for x in lite["nodes"]}
    heads = [nd["name"] + str(k) for k in range(8)
             if fby[nd["name"]]["children"] & (1 << k) and nd["name"] + str(k) not in kept]
    gone = [n for n in fby if any(n.startswith(h) for h in heads)]   # dropped children + descendants
    pts, ws = [], []
    for n in gone:
        rec = np.fromfile(tiles / "gal" / "n" / f"{n}.bin", dtype=bt.RENDER_DTYPE)
        pts.append(np.stack([rec["x"], rec["y"], rec["z"]], 1).astype(float) + fby[n]["center"])
        ws.append(10 ** (-0.4 * (-14.0 - rec["lum"] / 20.0)))
    x, w = np.concatenate(pts), np.concatenate(ws)
    c = (x * w[:, None]).sum(0) / w.sum()
    rms = np.sqrt((w * ((x - c) ** 2).sum(1)).sum() / w.sum())
    d = nd["dropped"]
    assert d["n"] == len(x)
    assert abs(d["L"] - w.sum()) / w.sum() < 1e-4
    assert np.allclose(np.array(d["c"]) + nd["center"], c, rtol=1e-4, atol=1e-3 * rms)
    assert abs(d["rms"] - rms) / rms < 1e-3


def test_weights_shift_the_budget(tiles, tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    budget = str(0.4 * _size(tiles) / 1e6)
    ml.main([str(a), "--src", str(tiles), "--budget-mb", budget, "--weight", "gal=4"])
    ml.main([str(b), "--src", str(tiles), "--budget-mb", budget, "--weight", "star=4"])
    assert _meta(a, "gal")["count"] > _meta(b, "gal")["count"]
    assert _meta(a, "star")["count"] < _meta(b, "star")["count"]


def test_exclude_and_zero_weight(tiles, tmp_path):
    out = tmp_path / "out"
    ml.main([str(out), "--src", str(tiles), "--budget-mb", "100", "--exclude", "small", "--weight", "star=0"])
    assert not (out / "small").exists()
    assert [nd["name"] for nd in _meta(out, "star")["nodes"]] == ["r"]
    assert json.loads((out / "_index.json").read_text())["layers"] == ["gal", "star"]


def test_refuses_big_files_and_never_splits(tiles, tmp_path):
    big = tmp_path / "src"
    shutil.copytree(tiles, big)
    with pytest.raises(SystemExit, match="larger than --max-file-mb"):
        ml.main([str(tmp_path / "out"), "--src", str(big), "--max-file-mb", "0.001"])
    assert not (tmp_path / "out").exists()


def test_refuses_to_overwrite_unknown_dirs(tiles, tmp_path):
    out = tmp_path / "out"
    out.mkdir()
    (out / "keep.txt").write_text("x")
    with pytest.raises(SystemExit, match="not empty"):
        ml.main([str(out), "--src", str(tiles), "--force"])
    assert (out / "keep.txt").exists()


def test_refuses_when_roots_do_not_fit(tiles, tmp_path):
    with pytest.raises(SystemExit, match="exceeds"):
        ml.main([str(tmp_path / "out"), "--src", str(tiles), "--budget-mb", "0.01"])
