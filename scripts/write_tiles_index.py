#!/usr/bin/env python3
"""Write <tiles>/_index.json: the layers and catalogues that are actually built.

The Vite dev/preview server synthesises this file (web/vite.config.ts); a static host has to
serve a real one, otherwise the viewer probes every layer in layers.json and logs a 404 for each
one that is not built. Same shape and same rules as the dev server:

    {"layers": [<dirs that contain meta.json>], "catalogs": [<*.json in catalogs/>]}

usage: write_tiles_index.py [TILES_DIR]     (default data/tiles)
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def build_index(tiles: Path) -> dict:
    tiles = Path(tiles)
    layers = sorted(d.name for d in tiles.iterdir() if d.is_dir() and (d / "meta.json").is_file()) if tiles.is_dir() else []
    cat = tiles / "catalogs"
    catalogs = sorted(f.name for f in cat.iterdir() if f.is_file() and f.suffix == ".json") if cat.is_dir() else []
    return {"layers": layers, "catalogs": catalogs}


def write_index(tiles: Path) -> dict:
    idx = build_index(tiles)
    (Path(tiles) / "_index.json").write_text(json.dumps(idx, separators=(",", ":")) + "\n")
    return idx


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("tiles", nargs="?", default=str(ROOT / "data/tiles"))
    a = ap.parse_args(argv)
    tiles = Path(a.tiles)
    if not tiles.is_dir():
        raise SystemExit(f"not a directory: {tiles}")
    idx = write_index(tiles)
    print(f"{tiles / '_index.json'}: {len(idx['layers'])} layers, {len(idx['catalogs'])} catalogues")


if __name__ == "__main__":
    main()
