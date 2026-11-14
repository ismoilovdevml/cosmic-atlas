#!/usr/bin/env python3
"""Put a whole tile layer on a Hugging Face dataset repo, in the sharded layout hybrid lite sets read.

  scripts/upload_tiles_hf.py data/tiles/stars-gaia [--repo USER/cosmic-atlas-tiles] [--shard 3] [--dry-run]

Layout on the repo: <layer>/meta.json and <layer>/n/<name[:shard]>/<name><suffix>, so no folder holds
more than a few hundred files (HF advises < 10k per folder). Files are hard-linked into a staging
folder (no extra disk), then sent with upload_folder (batched commits, resumes when re-run).

Prints the base URL pinned to the uploaded commit, to pass to
  scripts/make_lite_tiles.py OUT --remote <layer>=<base>
Pinning to a commit keeps every URL immutable for one build (safe to cache for ever).

Token: ~/.config/cosmic-atlas/hf.env (HF_TOKEN=..., write role), never printed.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV = Path.home() / ".config/cosmic-atlas/hf.env"

CARD = """---
license: cc-by-nc-4.0
pretty_name: Cosmic Atlas tiles
tags: [astronomy, gaia, 3d, octree]
---
# Cosmic Atlas tiles

Streamable octree tiles for [Cosmic Atlas](https://ismoilovdevml.github.io/cosmic-atlas/), a browser 3D
map of the universe. Format: [docs/data-contract.md](https://github.com/ismoilovdevml/cosmic-atlas/blob/main/docs/data-contract.md)
(nodes are sharded as `<layer>/n/<first {shard} chars of the node name>/<node><suffix>`).

Derived from ESA Gaia DR3 (CC BY-NC 3.0 IGO) and the other surveys named in each layer's meta.json, so
the set is non-commercial. Archived tile sets with DOIs: https://doi.org/10.5281/zenodo.24226088
"""


def token() -> str:
    tok = os.environ.get("HF_TOKEN")
    if not tok and ENV.exists():
        for line in ENV.read_text().splitlines():
            if line.strip().startswith("HF_TOKEN="):
                tok = line.split("=", 1)[1].strip().strip("'\"")
    if not tok:
        sys.exit(f"no HF_TOKEN in the environment or {ENV}")
    return tok


def stage(layer_dir: Path, dest: Path, shard: int, layer: str) -> int:
    meta = json.loads((layer_dir / "meta.json").read_text())
    if "nodes" not in meta:
        sys.exit(f"{layer_dir} is not an octree layer")
    root = dest / layer
    (root / "n").mkdir(parents=True, exist_ok=True)
    os.link(layer_dir / "meta.json", root / "meta.json") if not (root / "meta.json").exists() else None
    n = 0
    for f in sorted((layer_dir / "n").iterdir()):
        name = f.name.split(".")[0]
        d = root / "n" / name[:shard]
        d.mkdir(exist_ok=True)
        if not (d / f.name).exists():
            os.link(f, d / f.name)
        n += 1
    (dest / "README.md").write_text(CARD.replace("{shard}", str(shard)))
    return n


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("layer_dir", type=Path)
    ap.add_argument("--repo", help="USER/NAME (default <your HF user>/cosmic-atlas-tiles)")
    ap.add_argument("--shard", type=int, default=3)
    ap.add_argument("--layer", help="layer name on the repo (default: the directory name)")
    ap.add_argument("--stage", type=Path, default=ROOT / "data/hf-stage")
    ap.add_argument("--dry-run", action="store_true", help="stage only, do not upload")
    a = ap.parse_args()

    layer = a.layer or a.layer_dir.name
    n = stage(a.layer_dir, a.stage, a.shard, layer)
    print(f"staged {n} node files of {layer} in {a.stage}")
    if a.dry_run:
        return

    from huggingface_hub import HfApi
    api = HfApi(token=token())
    repo = a.repo or f"{api.whoami()['name']}/cosmic-atlas-tiles"
    api.create_repo(repo, repo_type="dataset", exist_ok=True)
    # huggingface_hub >= 1.0: upload_folder streams through hf_xet, commits big folders in batches and
    # resumes when re-run; only this layer (and the card) are sent from the shared staging folder
    api.upload_folder(repo_id=repo, repo_type="dataset", folder_path=str(a.stage),
                      allow_patterns=[f"{layer}/**", "README.md"], commit_message=f"Upload {layer} tiles")
    sha = api.repo_info(repo, repo_type="dataset").sha
    print(f"uploaded to https://huggingface.co/datasets/{repo} at {sha}")
    print(f"remote base: https://huggingface.co/datasets/{repo}/resolve/{sha}/{layer}")


if __name__ == "__main__":
    main()
