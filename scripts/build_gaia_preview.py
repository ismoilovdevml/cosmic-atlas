"""Build the `stars-gaia-preview` test layer: Gaia DR3 stars within 100 pc from the chunks that are
already downloaded (scripts/fetch_gaia.py), with the velocity stream.

The full stars-gaia download runs for days; this layer lets the 4D time slider be tested on real
stars meanwhile. It covers only the HEALPix ranges of the finished chunks, so it is labelled
"preview, partial sky" in meta.json (note) and in the viewer's layers panel.

Only chunks whose row-count check passed (data/raw/stars-gaia/_work/chunk_checks.jsonl) are used,
so a chunk that is being written right now is never read. The raw files are read, never written.

usage: .venv/bin/python scripts/build_gaia_preview.py [--raw data/raw/stars-gaia] [--max-dist-pc 100]
"""
from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path

import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))
import build_tiles as bt  # noqa: E402


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", default=str(ROOT / "data/raw/stars-gaia"))
    ap.add_argument("--out", default=str(ROOT / "data/tiles/stars-gaia-preview"))
    ap.add_argument("--max-dist-pc", type=float, default=100.0)
    a = ap.parse_args(argv)
    raw = Path(a.raw)
    checks = raw / "_work" / "chunk_checks.jsonl"
    plan = json.loads((raw / "_work" / "chunks.json").read_text())["chunks"]
    done = set()
    for line in checks.read_text().splitlines():
        try:
            done.add(int(json.loads(line)["chunk"]))
        except (ValueError, KeyError):
            continue
    files = []
    for c in sorted(done):
        f = raw / f"gaia_chunk_{c:04d}.parquet"
        try:
            if f.exists() and pq.read_metadata(f).num_rows == plan[c]["expected_rows"]:
                files.append(f)
        except Exception as e:  # noqa: BLE001 - a broken file is skipped and reported
            print(f"skip {f.name}: {e}")
    if not files:
        raise SystemExit("no finished chunks")
    hpx = sum(plan[int(f.stem[-4:])]["hpx6_hi"] - plan[int(f.stem[-4:])]["hpx6_lo"] for f in files)
    sky = hpx / 49152  # HEALPix level 6 has 12 * 4^6 pixels
    print(f"{len(files)} finished chunks of {len(plan)}, {hpx} level-6 pixels = {sky:.1%} of the sky")
    with tempfile.TemporaryDirectory() as tmp:
        for f in files:
            (Path(tmp) / f.name).symlink_to(f.resolve())
        note = (f"preview, partial sky: {len(files)} of {len(plan)} Gaia DR3 chunks ({sky:.1%} of the sky, "
                f"source_id < {max(plan[int(f.stem[-4:])]['sid_hi'] for f in files)}), "
                f"stars within {a.max_dist_pc:g} pc, cut parallax_over_error > 10 and ruwe < 1.4")
        bt.main(["stars-gaia-preview", "--src", tmp, "--out", a.out, "--order", "lum", "--kind-model", "star",
                 "--title", f"Gaia DR3 stars within {a.max_dist_pc:g} pc (preview, partial sky)",
                 "--id-prefix", "Gaia DR3 ", "--max-dist-pc", str(a.max_dist_pc), "--velocity", "helio",
                 "--capacity", "5000", "--note", note])
    meta = json.loads((Path(a.out) / "meta.json").read_text())
    meta["preview"] = {"chunks": len(files), "chunksPlanned": len(plan), "skyFraction": round(sky, 4)}
    (Path(a.out) / "meta.json").write_text(json.dumps(meta, separators=(",", ":")))
    print(json.dumps({k: meta[k] for k in ("count", "note", "velocity", "preview")}, indent=1))


if __name__ == "__main__":
    main()
