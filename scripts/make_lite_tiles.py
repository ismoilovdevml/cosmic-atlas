#!/usr/bin/env python3
"""Copy a tile set into a smaller "lite" one that fits a static host (GitHub Pages: 1 GB per site).

Per layer, only the shallowest octree nodes are kept, in breadth-first order, until the layer's
share of the byte budget is used. A level that does not fit completely is filled greedily, most
populated subtrees first, and nothing deeper is taken, so the kept set stays closed toward the root.

Light is conserved (docs/data-contract.md section 3): every kept node keeps its `agg` (the light of
its whole original subtree), and a kept node whose children were dropped gets a `dropped` field, the
merged `agg` of those children. The viewer (web/src/tiles/blobs.ts) draws that as a blob when it is
unresolved and reports it as "not in lite tiles" otherwise, so the drawn points of a kept node never
pretend to carry the dropped light.

Budget split across layers: water-filling by weight (--weight LAYER=W, default 1). A layer whose
full size fits its share is copied whole and the rest is shared among the others. Weight 0 keeps
only the root. Catalogues and other files outside the layers are copied whole and count toward the
budget. 1 MB = 10^6 bytes.

Files are never split. The run refuses if any file it would write is larger than --max-file-mb
(default 95, under GitHub's 100 MiB per-file block).

usage: make_lite_tiles.py OUT [--src data/tiles] [--budget-mb 900] [--weight galaxies-desi=2]
                              [--exclude synthetic-stars] [--max-file-mb 95] [--force]
"""
from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from write_tiles_index import write_index  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
MB = 1_000_000
REPORT = "_lite.json"
GENERATED = {"_index.json", REPORT}


# --------------------------------------------------------------------------- aggregates
def merge_aggs(parts: list[tuple[list[float], dict, float]], center: list[float]) -> dict:
    """Merge subtree aggregates. parts = [(child centre, child agg, child half)]. Returns an agg in
    the contract's format with the centroid relative to `center`. RMS is merged from moments:
    rms^2 = sum L_i (rms_i^2 + |a_i - C|^2) / L, with a_i the absolute child centroids."""
    n = sum(int(a["n"]) for _, a, _ in parts)
    L = sum(float(a["L"]) for _, a, _ in parts)
    w = [float(a["L"]) for _, a, _ in parts] if L > 0 else [float(a["n"]) or 1.0 for _, a, _ in parts]
    W = sum(w)
    absc = [[c[k] + a["c"][k] for k in range(3)] for c, a, _ in parts]
    C = [sum(wi * p[k] for wi, p in zip(w, absc)) / W for k in range(3)]
    rgb = [sum(wi * a["rgb"][k] for wi, (_, a, _) in zip(w, parts)) / W for k in range(3)]
    var = sum(wi * ((a.get("rms", h)) ** 2 + sum((p[k] - C[k]) ** 2 for k in range(3)))
              for wi, p, (_, a, h) in zip(w, absc, parts)) / W
    return {"n": n, "L": float(f"{L:.6g}"), "c": [round(C[k] - center[k], 4) for k in range(3)],
            "rgb": [int(round(v)) for v in rgb], "rms": float(f"{math.sqrt(max(var, 0.0)):.5g}")}


def own_light(node: dict, by: dict) -> float:
    """Light of a node's own points in the FULL tree: agg.L minus its children's agg.L."""
    ch = sum(by[node["name"] + str(k)]["agg"]["L"] for k in range(8) if node["children"] & (1 << k))
    return max(0.0, node["agg"]["L"] - ch)


# --------------------------------------------------------------------------- planning
def node_files(name: str, vel: bool = False) -> tuple[str, ...]:
    """files of one node; `vel` adds the optional velocity stream (meta.json has `velocity`)"""
    return (f"n/{name}.bin", f"n/{name}.ext.bin") + ((f"n/{name}.vel.bin",) if vel else ())


def scan_layer(d: Path) -> dict:
    meta = json.loads((d / "meta.json").read_text())
    cost = {}
    for nd in meta["nodes"]:
        cost[nd["name"]] = sum((d / f).stat().st_size for f in node_files(nd["name"], "velocity" in meta))
    extra = [p for p in d.iterdir() if p.is_file() and p.name != "meta.json"]
    meta_bytes = (d / "meta.json").stat().st_size + sum(p.stat().st_size for p in extra)
    return {"dir": d, "meta": meta, "cost": cost, "meta_bytes": meta_bytes, "extra": extra,
            "full": meta_bytes + sum(cost.values()), "min": meta_bytes + cost["r"]}


def allocate(budget: int, layers: dict, weights: dict) -> dict:
    """Water-filling: shares by weight; layers that fit their share are kept whole."""
    alloc, remaining = {}, budget
    for k, L in layers.items():
        if weights.get(k, 1.0) <= 0:
            alloc[k] = L["min"]
            remaining -= L["min"]
    active = [k for k in layers if weights.get(k, 1.0) > 0]
    while active:
        W = sum(weights.get(k, 1.0) for k in active)
        share = {k: remaining * weights.get(k, 1.0) / W for k in active}
        fits = [k for k in active if layers[k]["full"] <= share[k]]
        if not fits:
            for k in active:
                alloc[k] = max(int(share[k]), layers[k]["min"])
            break
        for k in fits:
            alloc[k] = layers[k]["full"]
            remaining -= layers[k]["full"]
            active.remove(k)
    return alloc


def prune(L: dict, alloc: int) -> set[str]:
    """Breadth-first: whole levels while they fit, then the most populated nodes of the first level
    that does not fit, then stop. Always keeps the root."""
    by = {nd["name"]: nd for nd in L["meta"]["nodes"]}
    cost = L["cost"]
    kept = {"r"}
    used = L["meta_bytes"] + cost["r"]
    level = [n + str(k) for n in ["r"] for k in range(8) if by["r"]["children"] & (1 << k)]
    while level:
        level_cost = sum(cost[n] for n in level)
        if used + level_cost <= alloc:
            kept.update(level)
            used += level_cost
            level = [n + str(k) for n in level for k in range(8) if by[n]["children"] & (1 << k)]
            continue
        for n in sorted(level, key=lambda n: (-by[n]["agg"]["n"], n)):
            if used + cost[n] <= alloc:
                kept.add(n)
                used += cost[n]
        break
    return kept


def lite_meta(meta: dict, kept: set[str]) -> dict:
    by = {nd["name"]: nd for nd in meta["nodes"]}
    nodes = []
    for nd in meta["nodes"]:
        if nd["name"] not in kept:
            continue
        out = dict(nd)
        mask, gone = 0, []
        for k in range(8):
            if not nd["children"] & (1 << k):
                continue
            ch = by[nd["name"] + str(k)]
            if ch["name"] in kept:
                mask |= 1 << k
            else:
                gone.append((ch["center"], ch["agg"], ch["half"]))
        out["children"] = mask
        out.pop("dropped", None)
        if gone:
            out["dropped"] = merge_aggs(gone, nd["center"])
        nodes.append(out)
    m = {k: v for k, v in meta.items() if k != "nodes"}
    m.update({"lite": True, "count": sum(nd["count"] for nd in nodes), "fullCount": meta["count"],
              "fullNodes": len(meta["nodes"])})
    m["nodes"] = nodes
    return m


def conservation(full: dict, lite: dict) -> dict:
    """Check, from the metas alone, that the lite set still accounts for every point and all light."""
    fby = {nd["name"]: nd for nd in full["nodes"]}
    root_L = fby["r"]["agg"]["L"]
    kept_own = sum(own_light(fby[nd["name"]], fby) for nd in lite["nodes"])
    dropped_L = sum(nd.get("dropped", {}).get("L", 0.0) for nd in lite["nodes"])
    kept_n = sum(nd["count"] for nd in lite["nodes"])
    dropped_n = sum(nd.get("dropped", {}).get("n", 0) for nd in lite["nodes"])
    return {"rootL": root_L, "keptOwnL": kept_own, "droppedL": dropped_L,
            "lightRelErr": abs(kept_own + dropped_L - root_L) / root_L if root_L else 0.0,
            "keptN": kept_n, "droppedN": dropped_n, "fullN": full["count"],
            "pointsConserved": kept_n + dropped_n == full["count"]}


# --------------------------------------------------------------------------- main
def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("out", help="output directory (must not exist or be empty, see --force)")
    ap.add_argument("--src", default=str(ROOT / "data/tiles"), help="source tile set (default data/tiles)")
    ap.add_argument("--budget-mb", type=float, default=900.0, help="total size of the output, all layers (default 900)")
    ap.add_argument("--weight", action="append", default=[], metavar="LAYER=W", help="budget weight per layer (default 1)")
    ap.add_argument("--exclude", action="append", default=[], metavar="LAYER", help="layer to leave out, repeatable")
    ap.add_argument("--max-file-mb", type=float, default=95.0, help="refuse if any file is larger (default 95)")
    ap.add_argument("--force", action="store_true", help="replace OUT if it holds an earlier lite set")
    a = ap.parse_args(argv)

    src, out = Path(a.src), Path(a.out)
    budget, max_file = int(a.budget_mb * MB), int(a.max_file_mb * MB)
    weights = {}
    for w in a.weight:
        k, _, v = w.partition("=")
        if not v:
            raise SystemExit(f"--weight wants LAYER=W, got {w!r}")
        weights[k] = float(v)
    if not src.is_dir():
        raise SystemExit(f"no tile set at {src}")
    if out.resolve() == src.resolve() or src.resolve() in out.resolve().parents:
        raise SystemExit("OUT must not be the source or inside it")
    if out.exists() and any(out.iterdir()):
        if not (a.force and (out / REPORT).is_file()):
            raise SystemExit(f"{out} is not empty (use --force to replace an earlier lite set)")

    t0 = time.time()
    # octree point layers can be pruned; other layer types (dust volume, small-body orbits, satellite
    # elements: meta.json without "nodes") are copied whole like the catalogues below
    def is_octree(d: Path) -> bool:
        try:
            return "nodes" in json.loads((d / "meta.json").read_text())
        except (OSError, ValueError):
            return False
    layer_dirs = sorted(d for d in src.iterdir() if d.is_dir() and (d / "meta.json").is_file() and d.name not in a.exclude and is_octree(d))
    unknown = set(weights) - {d.name for d in layer_dirs}
    if unknown:
        raise SystemExit(f"--weight for unknown layer(s): {', '.join(sorted(unknown))}")
    # everything that is not a layer (catalogues, provenance) is copied whole
    fixed = [p for p in src.rglob("*") if p.is_file() and p.name not in GENERATED
             and not any(d == p.parent or d in p.parents for d in layer_dirs)
             and not any((src / x) in p.parents for x in a.exclude)]
    fixed_bytes = sum(p.stat().st_size for p in fixed)
    layers = {d.name: scan_layer(d) for d in layer_dirs}
    alloc = allocate(budget - fixed_bytes - 4096, layers, weights)

    plan, metas, report = [], {}, {}
    for k, L in layers.items():
        kept = prune(L, alloc[k])
        full_meta = L["meta"]
        if len(kept) == len(full_meta["nodes"]):
            meta_text = (L["dir"] / "meta.json").read_text()
            cons = None
        else:
            lm = lite_meta(full_meta, kept)
            meta_text = json.dumps(lm, separators=(",", ":"))
            cons = conservation(full_meta, lm)
        metas[k] = meta_text
        files = [(L["dir"] / f, Path(k) / f) for n in sorted(kept) for f in node_files(n, "velocity" in L["meta"])]
        files += [(p, Path(k) / p.name) for p in L["extra"]]
        plan += files
        nbytes = len(meta_text.encode()) + sum(s.stat().st_size for s, _ in files)
        depth = max(len(n) for n in kept) - 1
        report[k] = {"lite": cons is not None, "points": sum(nd["count"] for nd in full_meta["nodes"] if nd["name"] in kept),
                     "fullPoints": full_meta["count"], "nodes": len(kept), "fullNodes": len(full_meta["nodes"]),
                     "maxDepth": depth, "fullMaxDepth": max(len(nd["name"]) for nd in full_meta["nodes"]) - 1,
                     "bytes": nbytes, "fullBytes": L["full"], "allocBytes": alloc[k]}
        if cons:
            report[k]["conservation"] = cons
    plan += [(p, p.relative_to(src)) for p in fixed]

    # refuse before writing anything
    too_big = [(str(d), s.stat().st_size) for s, d in plan if s.stat().st_size > max_file]
    too_big += [(f"{k}/meta.json", len(t.encode())) for k, t in metas.items() if len(t.encode()) > max_file]
    if too_big:
        raise SystemExit("refusing: files larger than --max-file-mb (never split):\n" +
                         "\n".join(f"  {p}: {b / MB:.1f} MB" for p, b in too_big))
    total = sum(s.stat().st_size for s, _ in plan) + sum(len(t.encode()) for t in metas.values())
    if total > budget:
        raise SystemExit(f"refusing: {total / MB:.1f} MB exceeds the {a.budget_mb:g} MB budget "
                         "(the layer roots alone do not fit)")
    bad = [k for k, r in report.items() if r.get("conservation") and
           (not r["conservation"]["pointsConserved"] or r["conservation"]["lightRelErr"] > 1e-3)]
    if bad:
        raise SystemExit(f"internal error: light/points not conserved for {bad}: {json.dumps(report, indent=1)}")

    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    for s, d in plan:
        (out / d).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(s, out / d)
    for k, t in metas.items():
        (out / k / "meta.json").write_text(t)
    idx = write_index(out)
    written = sum(p.stat().st_size for p in out.rglob("*") if p.is_file())
    summary = {"made": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "src": str(src), "budgetBytes": budget,
               "maxFileBytes": max_file, "totalBytes": written, "files": sum(1 for p in out.rglob("*") if p.is_file()) + 1,
               "largestFileBytes": max(p.stat().st_size for p in out.rglob("*") if p.is_file()),
               "weights": weights, "excluded": a.exclude, "index": idx, "layers": report}
    (out / REPORT).write_text(json.dumps(summary, indent=1) + "\n")

    for k, r in report.items():
        tag = "lite" if r["lite"] else "full"
        line = (f"[{k}] {tag}: {r['nodes']}/{r['fullNodes']} nodes (depth {r['maxDepth']}/{r['fullMaxDepth']}), "
                f"{r['points']:,}/{r['fullPoints']:,} points, {r['bytes'] / MB:.1f}/{r['fullBytes'] / MB:.1f} MB")
        if r.get("conservation"):
            c = r["conservation"]
            line += (f"; light kept-own {c['keptOwnL'] / c['rootL']:.4%} + dropped {c['droppedL'] / c['rootL']:.4%}"
                     f" (|err| {c['lightRelErr']:.1e}), points {c['keptN']:,} + {c['droppedN']:,} = {c['fullN']:,}")
        print(line)
    print(f"total {written / MB:.1f} MB of {a.budget_mb:g} MB budget, {summary['files']} files, "
          f"largest {summary['largestFileBytes'] / MB:.2f} MB -> {out} ({time.time() - t0:.1f}s)")


if __name__ == "__main__":
    main()
