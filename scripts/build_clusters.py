#!/usr/bin/env python
"""clusters.json: Milky Way star clusters, kind `cluster` (docs/content-contract.md section 3).

PROVENANCE
  Open clusters, moving groups and Gaia-detected globulars: Hunt & Reffert 2023, A&A 673, A114
      (Paper II, VizieR J/A+A/673/A114/clusters, 7,167 rows) for position, distance (dist16/50/84,
      maximum-likelihood from Gaia DR3 parallaxes), age (logAge16/50/84), number of members N and
      the radius containing half the members r50pc.
      Hunt & Reffert 2024, A&A 686, A42 (Paper III, VizieR J/A+A/686/A42/clusters, same IDs) for the
      updated object type (o = bound open cluster: Jacobi-radius probability >= 0.5 and mass >= 40
      Msun; m = moving group, i.e. unbound; g = globular; d = farther than 15 kpc, no mass; r =
      rejected: galaxies or clustering errors, dropped here) and the total observed mass MassTot.
      Joined on the internal cluster ID; the join is checked by name and position.
  Globular clusters: Baumgardt & Vasiliev 2021, MNRAS 505, 5957, via H. Baumgardt's Galactic
      globular cluster database (4th version), combined_table.txt: R_Sun +- DRSun (kpc), Mass +- DM
      and rh,l (projected half-light radius). Distances of GCs come from this table, not from Hunt &
      Reffert (whose Gaia-only distances and neural-network ages are not meant for GCs); a Hunt &
      Reffert globular that matches a Baumgardt cluster (shared name, or < 3 arcmin) is folded into
      the Baumgardt entry (its names become aliases). Baumgardt's table carries no licence beyond
      "(C) Holger Baumgardt": we keep three numbers per cluster with the citation, not the table.
  Merge with messier-ngc.json (scripts/build_named.py): a cluster that shares a name or alias with
      a Messier/NGC entry of a cluster kind (or lies < 6 arcmin from one with a distance within 15 %)
      is written here under the Messier/NGC name with the union of aliases, keeping that entry's
      magnitude and Messier number. layers.json lists clusters.json BEFORE messier-ngc.json, so the
      viewer's de-duplication (src/data/manifest.ts loadCatalogs: any shared normalised name or alias
      is a duplicate) keeps the richer cluster entry and drops the Messier/NGC one: M45 and M44 appear
      once. A Hunt & Reffert crossmatch name shared by several clusters stays only on the cluster that
      owns it (primary or merged Messier/NGC name), else on the cluster with the most members.
  Every other catalogue in layers.json is checked for shared names; an alias that would hide another
      catalogue's object (or be hidden by it) is removed from the cluster's alias list and counted.

Output: data/tiles/catalogs/clusters.json, provenance in data/tiles/catalogs/provenance/clusters.json.
Usage: .venv/bin/python scripts/build_clusters.py [--refresh]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import astropy.units as u
import numpy as np
import pandas as pd
from astropy.coordinates import Galactocentric, SkyCoord

sys.path.insert(0, str(Path(__file__).resolve().parent))
from catio import CACHE, CATS, ROOT, download, fetch_vizier, num, sig, utcnow, write_catalog_json, write_provenance  # noqa: E402
from coords import xyz_list  # noqa: E402

NAME = "clusters"
HR23 = "J/A+A/673/A114/clusters"
HR24 = "J/A+A/686/A42/clusters"
BV_URL = "https://people.smp.uq.edu.au/HolgerBaumgardt/globular/combined_table.txt"
HR23_COLS = ["Name", "ID", "AllNames", "Type", "N", "RA_ICRS", "DE_ICRS", "r50pc", "dist16", "dist50", "dist84",
             "logAge16", "logAge50", "logAge84"]
HR24_COLS = ["Name", "ID", "Type", "MassTot", "e_MassTot", "X", "Y", "Z"]
CIT = {
    "hr23": {"ref": "Hunt & Reffert 2023, A&A 673, A114 (Improving the open cluster census II; VizieR J/A+A/673/A114)",
             "doi": "10.1051/0004-6361/202346285"},
    "hr24": {"ref": "Hunt & Reffert 2024, A&A 686, A42 (Improving the open cluster census III; VizieR J/A+A/686/A42)",
             "doi": "10.1051/0004-6361/202348662"},
    "bv21": {"ref": "Baumgardt & Vasiliev 2021, MNRAS 505, 5957 (GC distances); masses and radii from the Baumgardt "
                    "Galactic GC database, 4th version (Baumgardt & Hilker 2018, MNRAS 478, 1520)",
             "doi": "10.1093/mnras/stab1474", "url": BV_URL},
    "vizier": {"ref": "CDS VizieR (CfA mirror vizier.cfa.harvard.edu; CDS Strasbourg is down since 2026-11-09)",
               "url": "https://vizier.cfa.harvard.edu/"},
}
REF_HR = "Hunt & Reffert 2023/24"  # short: 7,000 entries; the full citations are in the provenance block
JSON_MAX_BYTES = 2_000_000  # data-contract section 4: committed catalogues stay under 2 MB
MG_JSON_MAX_PC = 250.0  # moving groups beyond this are in the point layer only (see main())
LAYER = "star-clusters"  # point tile layer with every cluster (pipeline/build_tiles.py)
REF_BV = "Baumgardt & Vasiliev 2021; Baumgardt GC database"
TYPE24 = {"o": "open cluster", "m": "moving group", "g": "globular cluster"}
TYPE23 = {"o": "open cluster", "m": "moving group", "g": "globular cluster"}
CLUSTER_KINDS = {"open_cluster", "globular_cluster", "association", "cluster"}
NEBULA_KINDS = {"cluster_nebula"}


def catalog_key(s: str) -> str:
    """Python port of web/src/data/manifest.ts catalogKey (the viewer's duplicate test)."""
    k = re.sub(r"[^a-z0-9*+]", "", s.lower())
    m = re.match(r"^(?:messier|m)0*(\d{1,3})$", k)
    if m:
        return f"m{m.group(1)}"
    n = re.match(r"^(ngc|ic|ugc|pgc|hip|hd)0*(\d+)$", k)
    return f"{n.group(1)}{n.group(2)}" if n else k


def match_key(s: str) -> str:
    """Looser key for matching cluster names across catalogues (Melotte 22 = Mel 22 = Cl Melotte 22)."""
    k = re.sub(r"^cl\s+", "", s.strip().lower().replace("_", " "))
    for a, b in (("melotte", "mel"), ("collinder", "cr"), ("trumpler", "tr"), ("messier", "m")):
        k = re.sub(rf"^{a}\b", b, k)
    return catalog_key(k)


def pretty(n: str) -> str:
    return " ".join(n.replace("_", " ").split())


def sep_deg(ra1, de1, ra2, de2):
    r1, d1, r2, d2 = map(np.radians, (ra1, de1, ra2, de2))
    c = np.sin(d1) * np.sin(d2) + np.cos(d1) * np.cos(d2) * np.cos(r1 - r2)
    return np.degrees(np.arccos(np.clip(c, -1, 1)))


def uniq_names(names: list[str], exclude: str) -> list[str]:
    seen = {catalog_key(exclude)}
    out = []
    for n in names:
        k = catalog_key(n)
        if n and k and k not in seen:
            seen.add(k)
            out.append(n)
    return out


def load_hr(refresh: bool) -> tuple[pd.DataFrame, dict]:
    h3, u3 = fetch_vizier(HR23, CACHE / NAME / "hr23_clusters.tsv", HR23_COLS, refresh=refresh)
    h4, u4 = fetch_vizier(HR24, CACHE / NAME / "hr24_clusters.tsv", HR24_COLS, refresh=refresh)
    h4 = h4.rename(columns={c: f"{c}_24" for c in h4.columns if c != "ID"})
    df = h3.merge(h4, on="ID", how="left", validate="one_to_one")
    bad_join = int((df["Name"] != df["Name_24"]).sum())
    for c in ["N", "RA_ICRS", "DE_ICRS", "_RAJ2000", "_DEJ2000", "r50pc", "dist16", "dist50", "dist84",
              "logAge16", "logAge50", "logAge84", "MassTot_24", "e_MassTot_24", "X_24", "Y_24", "Z_24"]:
        df[c] = num(df[c])
    info = {"hr23_rows": len(h3), "hr24_rows": len(h4), "join_name_mismatches": bad_join,
            "hr24_type_counts": {k: int(v) for k, v in h4["Type_24"].value_counts().items()},
            "urls": {"hr23": u3, "hr24": u4}}
    return df, info


def load_bv(refresh: bool) -> pd.DataFrame:
    path = download(BV_URL, CACHE / NAME / "baumgardt_combined_table.txt", refresh)
    rows = []
    for ln in path.read_text().splitlines():
        if not ln.strip() or ln.startswith("#"):
            continue
        p = ln.split()
        # columns (1) name (2) RA (3) DEC (4) R_Sun (5) DRSun ... (10) Mass (11) DM ... (16) rc (17) rh,l (18) rh,m
        rows.append({"cluster": p[0], "ra": float(p[1]), "dec": float(p[2]), "rsun": float(p[3]), "drsun": float(p[4]),
                     "mass": float(p[9]), "dmass": float(p[10]), "rh_l": float(p[16]), "rh_m": float(p[17])})
    return pd.DataFrame(rows)


def age_fact(r) -> list | None:
    a16, a50, a84 = r["logAge16"], r["logAge50"], r["logAge84"]
    if not np.isfinite(a50):
        return None
    v = 10 ** a50 / 1e6
    lo = v - 10 ** a16 / 1e6 if np.isfinite(a16) else None
    hi = 10 ** a84 / 1e6 - v if np.isfinite(a84) else None
    return [sig(v, 3), sig(max(lo, 0), 2) if lo is not None else None, sig(max(hi, 0), 2) if hi is not None else None]


def hr_entry(r) -> dict:
    t24 = r["Type_24"]
    typ = TYPE24.get(t24) or TYPE23.get(r["Type"], "cluster")
    facts = {"type": typ}
    if t24 != "g" and r["Type"] != "g":  # Paper II ages are not meant for globulars (omega Cen: 1.7 Gyr)
        a = age_fact(r)
        if a:
            facts["age_myr"] = a
    facts["n_members"] = int(r["N"])
    if np.isfinite(r["r50pc"]):
        facts["r50_pc"] = sig(r["r50pc"], 3)
    if np.isfinite(r["MassTot_24"]):
        facts["mass_msun"] = [sig(r["MassTot_24"], 3), sig(r["e_MassTot_24"], 2)] if np.isfinite(r["e_MassTot_24"]) else sig(r["MassTot_24"], 3)
    name = pretty(r["Name"])
    alt = uniq_names([pretty(n) for n in str(r["AllNames"]).split(",")], name)
    ra, dec, d = float(r["_RAJ2000"]), float(r["_DEJ2000"]), float(r["dist50"])
    return {"name": name, "alt": alt, "kind": "cluster", "ra": round(ra, 4), "dec": round(dec, 4),
            "dist_pc": sig(d, 5), "dist_lo_pc": sig(r["dist16"], 5), "dist_hi_pc": sig(r["dist84"], 5),
            "xyz": xyz_list(ra, dec, d, 2), "ref": REF_HR, "facts": facts,
            "_id": int(r["ID"]), "_logage": float(r["logAge50"]), "_named": False}


def bv_entry(b) -> dict:
    name = pretty(b["cluster"])
    d = b["rsun"] * 1e3
    facts = {"type": "globular cluster", "mass_msun": [sig(b["mass"], 3), sig(b["dmass"], 2)], "rh_light_pc": sig(b["rh_l"], 3)}
    return {"name": name, "alt": [], "kind": "cluster", "ra": round(b["ra"], 4), "dec": round(b["dec"], 4),
            "dist_pc": sig(d, 4), "dist_lo_pc": sig(d - b["drsun"] * 1e3, 4), "dist_hi_pc": sig(d + b["drsun"] * 1e3, 4),
            "xyz": xyz_list(b["ra"], b["dec"], d, 2), "ref": REF_BV, "doi": CIT["bv21"]["doi"], "facts": facts,
            "_id": None, "_logage": float("nan"), "_named": True}


def write_point_layer(entries: list[dict], started: str) -> int:
    """data/raw/star-clusters/clusters.parquet for pipeline/build_tiles.py (--kind-model star).

    mag and color are RENDERING PROXIES, not measurements (Hunt & Reffert give no integrated
    magnitudes): absolute magnitude M = 4.83 - 2.5 log10(mass / Msun), i.e. one solar luminosity per
    solar mass (member count when there is no mass), so heavier clusters draw brighter; colour is a
    BP-RP-like value from the age (young clusters blue, old ones yellow) for the star colour map.
    numeric_id = Hunt & Reffert ID; Baumgardt globulars without one get 100000 + row."""
    rows = []
    for k, e in enumerate(entries):
        f = e["facts"]
        mass = f.get("mass_msun")
        mass = mass[0] if isinstance(mass, list) else mass
        mass = mass or f.get("n_members") or 100.0
        m_abs = 4.83 - 2.5 * np.log10(max(float(mass), 1.0))
        la = e["_logage"]
        colour = 0.9 if f["type"] == "globular cluster" or not np.isfinite(la) else \
            float(np.interp(la, [6.5, 7.5, 8.5, 9.3, 10.1], [-0.25, 0.0, 0.35, 0.75, 0.95]))
        rows.append({"id": e["name"], "numeric_id": int(e["_id"]) if e["_id"] else 100000 + k,
                     "ra": e["ra"], "dec": e["dec"], "dist_pc": e["dist_pc"],
                     "dist_lo_pc": e.get("dist_lo_pc", np.nan), "dist_hi_pc": e.get("dist_hi_pc", np.nan),
                     "mag": m_abs + 5 * np.log10(e["dist_pc"] / 10), "color": colour, "kind": "cluster",
                     "type": f["type"]})
    df = pd.DataFrame(rows)
    out = ROOT / "data" / "raw" / LAYER
    out.mkdir(parents=True, exist_ok=True)
    for c in ["ra", "dec", "dist_pc", "dist_lo_pc", "dist_hi_pc"]:
        df[c] = df[c].astype("float64")
    df["mag"] = df["mag"].astype("float32")
    df["color"] = df["color"].astype("float32")
    df["numeric_id"] = df["numeric_id"].astype("int64")
    dest = out / "clusters.parquet"
    df.to_parquet(dest, index=False)
    prov = {"layer": LAYER, "started_utc": started, "finished_utc": utcnow(), "rows": len(df),
            "file": str(dest.relative_to(ROOT)), "built_by": "scripts/build_clusters.py",
            "tiles": f"pipeline/build_tiles.py {LAYER} --order lum --kind-model star (scripts/build_all_tiles.sh)",
            "mag": "rendering proxy: M = 4.83 - 2.5 log10(mass), mass = Hunt & Reffert 2024 MassTot or Baumgardt Mass "
                   "(member count if neither), apparent = M + 5 log10(d/10); NOT a measured magnitude",
            "color": "rendering proxy: BP-RP-like value interpolated from log10(age) "
                     "[6.5, 7.5, 8.5, 9.3, 10.1] -> [-0.25, 0.0, 0.35, 0.75, 0.95]; globulars 0.9",
            "numeric_id": "Hunt & Reffert ID; 100000 + row for Baumgardt globulars not in Hunt & Reffert",
            "citations": [CIT["hr23"], CIT["hr24"], CIT["bv21"]]}
    (out / "PROVENANCE.json").write_text(json.dumps(prov, indent=2, ensure_ascii=False))
    return len(df)


def manifest_catalogs() -> list[str]:
    m = json.loads((ROOT / "web" / "public" / "layers.json").read_text())
    return [Path(u).name for u in m["catalogs"]]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true")
    a = ap.parse_args()
    started = utcnow()
    hr, hr_info = load_hr(a.refresh)
    bv = load_bv(a.refresh)
    n_rej = int((hr["Type_24"] == "r").sum())
    hr = hr[hr["Type_24"] != "r"].reset_index(drop=True)

    # --- position check: Paper III's X, Y, Z are astropy Galactocentric (default frame, R0 = 8.122 kpc,
    # z_sun = 20.8 pc; the VizieR label says heliocentric, the numbers say otherwise). Transforming our
    # (ra, dec, dist50) the same way must reproduce them.
    g = SkyCoord(ra=hr["_RAJ2000"].to_numpy() * u.deg, dec=hr["_DEJ2000"].to_numpy() * u.deg,
                 distance=hr["dist50"].to_numpy() * u.pc).transform_to(Galactocentric())
    mine = np.column_stack([g.x.to_value(u.pc), g.y.to_value(u.pc), g.z.to_value(u.pc)])
    diff = np.linalg.norm(mine - hr[["X_24", "Y_24", "Z_24"]].to_numpy(), axis=1)
    xyz_check = {"frame": "astropy Galactocentric() defaults", "median_pc": float(np.nanmedian(diff)),
                 "p99_pc": float(np.nanpercentile(diff, 99)), "max_pc": float(np.nanmax(diff))}
    if xyz_check["max_pc"] > 1.0:
        raise SystemExit(f"positions disagree with Hunt & Reffert X/Y/Z: {xyz_check}")

    entries = [hr_entry(r) for _, r in hr.iterrows()]
    by_key: dict[str, list[int]] = {}
    for i, e in enumerate(entries):
        for n in [e["name"], *e["alt"]]:
            by_key.setdefault(match_key(n), []).append(i)

    # --- globulars: Baumgardt replaces a matching Hunt & Reffert globular
    drop_hr: set[int] = set()
    gcs = []
    gc_hr_matches = 0
    hr_ra = np.array([e["ra"] for e in entries])
    hr_de = np.array([e["dec"] for e in entries])
    for _, b in bv.iterrows():
        e = bv_entry(b)
        cand = set(by_key.get(match_key(e["name"]), []))
        s = sep_deg(b["ra"], b["dec"], hr_ra, hr_de)
        near = np.where((s < 0.05) & np.array([x["facts"]["type"] == "globular cluster" for x in entries]))[0]
        cand |= set(int(i) for i in near)
        cand = {i for i in cand if s[i] < 0.5}
        for i in sorted(cand, key=lambda j: s[j]):
            drop_hr.add(i)
            e["alt"] = uniq_names(e["alt"] + [entries[i]["name"], *entries[i]["alt"]], e["name"])
            e["_id"] = e["_id"] or entries[i]["_id"]  # the point layer keeps the Hunt & Reffert ID
        gc_hr_matches += bool(cand)
        gcs.append(e)
    hr_gc_unmatched = [entries[i]["name"] for i, x in enumerate(entries) if x["facts"]["type"] == "globular cluster" and i not in drop_hr]
    entries = [e for i, e in enumerate(entries) if i not in drop_hr] + gcs

    # --- merge with messier-ngc.json
    mngc = json.loads((CATS / "messier-ngc.json").read_text())
    mcl = [m for m in mngc if m["kind"] in CLUSTER_KINDS | NEBULA_KINDS]
    idx: dict[str, list[int]] = {}
    for i, e in enumerate(entries):
        for n in [e["name"], *e["alt"]]:
            idx.setdefault(match_key(n), []).append(i)
    ra = np.array([e["ra"] for e in entries])
    de = np.array([e["dec"] for e in entries])
    dist = np.array([e["dist_pc"] for e in entries], dtype=float)
    merged, by_pos, unmatched, conflicts = [], [], [], []
    taken: dict[int, str] = {}
    for m in mcl:
        names = [m["name"], *m.get("alt", [])]
        cand = {i for n in names for i in idx.get(match_key(n), [])}
        s = sep_deg(m["ra"], m["dec"], ra, de)
        cand = [i for i in cand if s[i] < 1.0]
        how = "name"
        if not cand and m.get("dist_pc"):
            near = np.where((s < 0.1) & (np.abs(dist / m["dist_pc"] - 1) < 0.15))[0]
            cand, how = [int(i) for i in near], "position"
        if not cand:
            unmatched.append(m["name"])
            continue
        i = min(cand, key=lambda j: s[j])
        if i in taken:
            conflicts.append([m["name"], taken[i], entries[i]["name"]])
            continue
        taken[i] = m["name"]
        e = entries[i]
        hr_name = e["name"]
        e["alt"] = uniq_names([*m.get("alt", []), hr_name, *e["alt"]], m["name"])
        e["name"] = m["name"]
        e["_named"] = True
        e["_own"] = {catalog_key(n) for n in [m["name"], *m.get("alt", []), hr_name]}
        e.setdefault("doi", CIT["hr23"]["doi"])
        for k in ("mag", "mag_band", "messier"):
            if m.get(k) is not None:
                e[k] = m[k]
        (merged if how == "name" else by_pos).append([m["name"], hr_name, round(float(s[i]) * 60, 2)])

    # --- aliases inside this catalogue: Hunt & Reffert's AllNames lists every literature cluster a
    # cluster crossmatched to, so one name can sit on several clusters ("NGC 2323" is M50 and also an
    # alias of Theia 267). The viewer keeps only the first entry with a given name, so a name stays
    # only on the entry that owns it (its primary name, or a Messier/NGC name merged into it) and an
    # alias that two or more clusters share without an owner is dropped as ambiguous.
    owner: dict[str, int] = {}
    for i, e in enumerate(entries):
        for k in e.get("_own", {catalog_key(e["name"])}) | {catalog_key(e["name"])}:
            if k in owner and owner[k] != i:
                raise SystemExit(f"two clusters own the name {k}: {entries[owner[k]]['name']}, {e['name']}")
            owner[k] = i
    # an unowned alias shared by several clusters goes to the one with the most members (the main
    # body: "Hyades" is listed by Melotte 25 and by smaller groups around it); globulars first
    weight = [1e12 if e["facts"]["type"] == "globular cluster" else float(e["facts"].get("n_members", 0)) for e in entries]
    alias_owner: dict[str, int] = {}
    for i, e in enumerate(entries):
        for k in {catalog_key(n) for n in e["alt"]}:
            if k in owner:
                continue
            j = alias_owner.get(k)
            if j is None or weight[i] > weight[j]:
                alias_owner[k] = i
    owner.update(alias_owner)
    internal_dropped = 0
    for i, e in enumerate(entries):
        keep = []
        for n in e["alt"]:
            k = catalog_key(n)
            if k in owner and owner[k] != i:
                internal_dropped += 1
            else:
                keep.append(n)
        e["alt"] = keep

    # --- names shared with the other catalogues (load order: earlier file wins in the viewer)
    order = manifest_catalogs()
    if "clusters.json" not in order:
        raise SystemExit("add tiles/catalogs/clusters.json to web/public/layers.json (before messier-ngc.json)")
    if order.index("clusters.json") > order.index("messier-ngc.json"):
        raise SystemExit("clusters.json must come before messier-ngc.json in web/public/layers.json")
    other_keys: dict[str, str] = {}
    merged_mngc = {x[0] for x in merged + by_pos}
    for f in order:
        if f in ("clusters.json", "dev-placeholder.json") or not (CATS / f).exists():
            continue
        for o in json.loads((CATS / f).read_text()):
            if o.get("kind") in ("exoplanet", "pulsar", "black_hole", "message", "seti_signal"):
                continue  # own namespaces in the viewer
            if f == "messier-ngc.json" and o["name"] in merged_mngc:
                continue
            for n in [o["name"], *o.get("alt", [])]:
                other_keys.setdefault(catalog_key(n), f"{f}:{o['name']}")
    alias_dropped, name_clash = [], []
    for e in entries:
        keep = []
        for n in e["alt"]:
            hit = other_keys.get(catalog_key(n))
            if hit:
                alias_dropped.append([e["name"], n, hit])
            else:
                keep.append(n)
        e["alt"] = keep
        if catalog_key(e["name"]) in other_keys:
            # the same NGC/IC number is a nebula (or dwarf galaxy) in a file the viewer loads earlier:
            # keep both objects, the cluster under "<name> cluster" (its own article and facts)
            name_clash.append([e["name"], other_keys[catalog_key(e["name"])], f"{e['name']} cluster"])
            e["name"] = f"{e['name']} cluster"

    entries.sort(key=lambda e: e["dist_pc"])
    # Every cluster with all its facts is 2.3 MB of JSON, over the 2 MB limit for committed catalogues.
    # So: the JSON (labels, search, info cards) holds the bound open clusters, the globulars, every
    # Messier/NGC-named cluster and the moving groups within MG_JSON_MAX_PC; the point tile layer
    # (data/raw/star-clusters -> pipeline/build_tiles.py) draws ALL of them, so the census is complete
    # on screen and the far moving groups are still clickable points.
    in_json = [e for e in entries if e["facts"]["type"] != "moving group" or e["_named"] or e["dist_pc"] < MG_JSON_MAX_PC]
    out = [{k: v for k, v in e.items() if not k.startswith("_")} for e in in_json]
    path = CATS / f"{NAME}.json"
    size = write_catalog_json(path, out, drop_none=True)
    if size >= JSON_MAX_BYTES:
        raise SystemExit(f"{path.name} is {size} B >= {JSON_MAX_BYTES}: lower MG_JSON_MAX_PC")
    types = pd.Series([e["facts"]["type"] for e in out]).value_counts()
    layer_rows = write_point_layer(entries, started)
    prov = {"catalog": f"data/tiles/catalogs/{NAME}.json", "bytes": size, "started_utc": started, "finished_utc": utcnow(),
            "service": {"vizier": hr_info["urls"], "baumgardt": BV_URL},
            "selection": "all Hunt & Reffert 2023 clusters except the 17 that Hunt & Reffert 2024 reject (Type r); "
                         "all clusters of the Baumgardt combined table. All of them go to the point layer "
                         f"data/raw/{LAYER}; this JSON keeps every entry except unnamed moving groups farther than "
                         f"{MG_JSON_MAX_PC:g} pc (all clusters with full facts would be ~2.3 MB, over the 2 MB limit).",
            "point_layer": {"layer": LAYER, "rows": layer_rows, "raw": f"data/raw/{LAYER}/clusters.parquet"},
            "facts_keys": {"type": "Hunt & Reffert 2024 Type (o open cluster, m moving group, g globular; d -> 2023 Type); "
                                   "'globular cluster' for Baumgardt entries",
                           "age_myr": "10^logAge50 / 1e6 with 16th/84th percentile errors [value, minus, plus] (Hunt & Reffert 2023); "
                                      "not given for globulars",
                           "n_members": "N, Gaia DR3 members (Hunt & Reffert 2023)",
                           "r50_pc": "r50pc, radius holding half the members within the tidal radius (Hunt & Reffert 2023)",
                           "mass_msun": "MassTot +- e_MassTot, total observed mass (Hunt & Reffert 2024); Baumgardt Mass +- DM for globulars",
                           "rh_light_pc": "rh,l projected half-light radius (Baumgardt database), globulars only"},
            "distance": "Hunt & Reffert dist50 (16/84 percentiles as dist_lo/hi); globulars Baumgardt & Vasiliev 2021 "
                        "R_Sun +- DRSun. Position _RAJ2000/_DEJ2000 (VizieR, propagated to J2000).",
            "counts": {**{k: v for k, v in hr_info.items() if k != "urls"}, "hr_rejected_type_r": n_rej,
                       "baumgardt_gcs": len(bv), "baumgardt_matched_to_hr": gc_hr_matches,
                       "hr_globulars_folded_into_baumgardt": len(drop_hr), "hr_globulars_kept": len(hr_gc_unmatched),
                       "entries_all": len(entries), "entries_json": len(out), "types_json": {k: int(v) for k, v in types.items()},
                       "merged_with_messier_ngc_by_name": len(merged), "merged_with_messier_ngc_by_position": len(by_pos),
                       "messier_ngc_cluster_entries_not_matched": len(unmatched),
                       "aliases_dropped_shared_inside_catalogue": internal_dropped,
                       "aliases_dropped_shared_with_other_catalogues": len(alias_dropped),
                       "primary_names_shared_with_other_catalogues": len(name_clash)},
            "xyz_check_vs_hr24_XYZ": xyz_check,
            "merged_with_messier_ngc": merged, "merged_by_position": by_pos, "merge_conflicts": conflicts,
            "messier_ngc_not_matched": unmatched, "hr_globulars_without_baumgardt": hr_gc_unmatched,
            "aliases_dropped": alias_dropped, "names_shared": name_clash,
            "viewer_merge": "layers.json lists clusters.json before messier-ngc.json; the loader keeps the first entry "
                            "with a given normalised name, so merged Messier/NGC clusters are shown once, from this file.",
            "citations": [CIT["hr23"], CIT["hr24"], CIT["bv21"], CIT["vizier"]]}
    write_provenance(NAME, prov)
    print(f"{NAME}: {len(entries)} clusters, {len(out)} in JSON, {size} B; point layer {layer_rows} rows; types {dict(types)}; merged {len(merged)} by name + {len(by_pos)} by position; "
          f"not matched {len(unmatched)}; conflicts {len(conflicts)}; aliases dropped {len(alias_dropped)}; names shared {len(name_clash)}; "
          f"xyz check {xyz_check}")


if __name__ == "__main__":
    main()
