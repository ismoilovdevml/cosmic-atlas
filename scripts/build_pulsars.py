#!/usr/bin/env python
"""pulsars.json: ATNF Pulsar Catalogue, kind `pulsar`.

PROVENANCE
  Source: ATNF Pulsar Catalogue (Manchester, Hobbs, Teoh & Hobbs 2005, AJ 129, 1993), current
      version as served by the ATNF web query (proc_form.php, "Long csv with errors"; the version
      string is read from the answer and recorded). The web query is used instead of parsing the
      psrcat.db file because DIST, the catalogue's "best estimate" distance, is a derived parameter
      computed by the psrcat software: the independent distance DIST_A (parallax, association, HI
      absorption ...) when one exists, otherwise the YMW16 DM distance DIST_DM (Yao, Manchester &
      Wang 2017, ApJ 835, 29).
  Columns: JNAME, BNAME, RAJD, DECJD, P0, P1, DM, DIST, DIST_DM, DIST_A, PX, TYPE, BINARY, PB, ASSOC.
  Selection: every pulsar; those without DIST are dropped and counted in the provenance block.
  type (facts.type): 'magnetar' when TYPE contains AXP (ATNF flags magnetars / AXPs / SGRs with
      pulsations as AXP); 'millisecond' when P0 < 30 ms; 'binary' when BINARY or PB is set; also
      'in globular cluster' (ASSOC GC:), 'radio-quiet' (NRAD), 'RRAT', 'isolated NS (XINS)'.
  Per-number references: ATNF reference codes for P0 and for an independent distance are kept in
      facts_ref (P1 and DM come from the same timing solutions; expand the codes at
      https://www.atnf.csiro.au/research/pulsar/psrcat/psrcat_ref.html).

Output: data/tiles/catalogs/pulsars.json, provenance in data/tiles/catalogs/provenance/.
Usage: .venv/bin/python scripts/build_pulsars.py [--refresh]
"""
from __future__ import annotations

import argparse
import html as htmllib
import io
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from catio import CACHE, CATS, http, sig, utcnow, write_catalog_json, write_provenance  # noqa: E402
from coords import xyz_list  # noqa: E402

NAME = "pulsars"
URL = "https://www.atnf.csiro.au/research/pulsar/psrcat/proc_form.php"
PARAMS = ["JName", "Bname", "RaJD", "DecJD", "P0", "P1", "DM", "Dist", "Dist_DM", "Dist_A", "PX", "Type", "Binary", "PB", "Assoc"]
REF = "ATNF Pulsar Catalogue (Manchester et al. 2005, AJ 129, 1993)"
REF_SHORT = "ATNF Pulsar Catalogue"  # per entry; the full citation is in the provenance block
DOI = "10.1086/428488"
FAMOUS = {  # common names (searchable aliases)
    "J0534+2200": ["Crab Pulsar", "NP 0532"], "J0835-4510": ["Vela Pulsar"], "J1915+1606": ["Hulse-Taylor pulsar"],
    "J0737-3039A": ["Double Pulsar"], "J0737-3039B": ["Double Pulsar B"], "J0633+1746": ["Geminga"],
    "J1300+1240": ["Lich (planet host)"], "J1748-2446ad": ["fastest-spinning pulsar"], "J1939+2134": ["first millisecond pulsar"],
    "J1808-2024": ["SGR 1806-20"], "J1935+2154": ["SGR 1935+2154"], "J0437-4715": [], "J1909-3744": [],
}


def query(version: str) -> str:
    q = {p: p for p in PARAMS}
    q.update({"version": version, "startUserDefined": "true", "sort_attr": "jname", "sort_order": "asc", "condition": "",
              "pulsar_names": "", "ephemeris": "short", "coords_unit": "raj/decj", "radius": "", "coords_1": "",
              "coords_2": "", "style": "Long csv with errors", "no_value": "*", "fsize": "3", "x_axis": "",
              "x_scale": "linear", "y_axis": "", "y_scale": "linear", "state": "query",
              "table_bottom.x": "40", "table_bottom.y": "0"})
    return http("GET", URL, params=q).text


def parse(page: str) -> tuple[pd.DataFrame, str]:
    ver = re.search(r"Catalogue Version:\s*([\d.]+)", page)[1]
    pre = re.search(r"<pre>(.*?)</pre>", page, re.S)[1]
    lines = [htmllib.unescape(re.sub(r"<[^>]+>", "", ln)) for ln in pre.splitlines() if ln.strip()]
    head = lines[0].split(";")
    names, last, k = [], None, 0
    for h in head:
        h = h.strip()
        if h:
            last, k = h, 0
            names.append(h)
        else:
            k += 1
            names.append(f"{last}_x{k}")
    rows = [ln.split(";") for ln in lines[2:] if re.match(r"^\d+;", ln)]
    df = pd.DataFrame([r[:len(names)] + [""] * (len(names) - len(r)) for r in rows], columns=names)
    df = df.apply(lambda c: c.str.strip()).replace("*", "")
    return df, ver


def f(x):
    try:
        v = float(x)
    except (TypeError, ValueError):
        return np.nan
    return v


def ptype(r) -> str:
    t = []
    tp = r["PSR"]
    p0 = f(r["P0"])
    if "AXP" in tp:
        t.append("magnetar")
    if np.isfinite(p0) and p0 < 0.03:
        t.append("millisecond")
    if r["BINARY"] or np.isfinite(f(r["PB"])):
        t.append("binary")
    if re.search(r"(^|,)GC:", r["ASSOC"]):
        t.append("in globular cluster")
    if "NRAD" in tp:
        t.append("radio-quiet")
    if "RRAT" in tp:
        t.append("RRAT")
    if "XINS" in tp:
        t.append("isolated NS (XINS)")
    return ", ".join(t) or "isolated"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--version", default="2.9.0", help="catalogue version to request (the answer's version is recorded)")
    a = ap.parse_args()
    started = utcnow()
    cache = CACHE / NAME / f"atnf_{a.version}.html"
    if a.refresh or not cache.exists():
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(query(a.version))
    df, ver = parse(cache.read_text())
    n_all = len(df)
    df["dist"] = df["DIST"].map(f)
    keep = df[np.isfinite(df["dist"]) & (df["dist"] > 0)]
    entries = []
    for _, r in keep.iterrows():
        j = r["PSRJ"]
        d_pc = r["dist"] * 1e3
        # search matches substrings, so 'J0534+2200' and 'B0531+21' find 'PSR J0534+2200' / 'PSR B0531+21'
        alt = ([f"PSR {r['PSRB']}"] if r["PSRB"] else []) + FAMOUS.get(j, [])
        facts, fref = {"type": ptype(r)}, {}
        p0, p0e = f(r["P0"]), f(r["P0_x1"])
        if np.isfinite(p0):
            facts["period_s"] = [sig(p0, 10), sig(p0e, 2)] if np.isfinite(p0e) else sig(p0, 10)
            fref["period_s"] = r["P0_x2"]
        p1 = f(r["P1"])
        if np.isfinite(p1):
            facts["period_derivative"] = sig(p1, 4)  # s/s, dimensionless
        dm = f(r["DM"])
        if np.isfinite(dm):
            facts["dm_pc_cm3"] = sig(dm, 6)
        pb = f(r["PB"])
        if np.isfinite(pb):
            facts["orbital_period_days"] = sig(pb, 6)
        da = f(r["DIST_A"])
        independent = np.isfinite(da) and abs(da - r["dist"]) < 1e-3
        facts["dist_method"] = "independent" if independent else "DM (YMW16)"
        if independent:
            fref["dist"] = r["DIST_A_x2"]
        lo = hi = None
        if independent and np.isfinite(f(r["DIST_A_x1"])) and f(r["DIST_A_x1"]) > 0:
            lo, hi = (r["dist"] - f(r["DIST_A_x1"])) * 1e3, (r["dist"] + f(r["DIST_A_x1"])) * 1e3
        if r["ASSOC"]:
            facts["assoc"] = re.sub(r"\[[^\]]*\]", "", r["ASSOC"]).replace("_", " ")
        e = {"name": f"PSR {j}", "alt": alt, "kind": "pulsar", "ra": round(f(r["RAJD"]), 6), "dec": round(f(r["DECJD"]), 6),
             "dist_pc": sig(d_pc, 5), "xyz": xyz_list(f(r["RAJD"]), f(r["DECJD"]), d_pc, 3), "ref": REF_SHORT,
             "dist_lo_pc": sig(lo, 4) if lo and lo > 0 else None, "dist_hi_pc": sig(hi, 4) if hi else None,
             "facts": facts, "facts_ref": {k: v for k, v in fref.items() if v} or None}
        entries.append(e)
    path = CATS / f"{NAME}.json"
    size = write_catalog_json(path, entries, drop_none=True)
    types = pd.Series([t for e in entries for t in e["facts"]["type"].split(", ")]).value_counts()
    prov = {"catalog": f"data/tiles/catalogs/{NAME}.json", "bytes": size, "started_utc": started, "finished_utc": utcnow(),
            "service": URL, "facts_keys": "period_s [s], period_derivative [s/s], dm_pc_cm3 [pc cm^-3], orbital_period_days, dist_method, assoc", "atnf_version": ver, "params": PARAMS, "style": "Long csv with errors",
            "counts": {"atnf_pulsars": n_all, "with_dist": len(entries), "dropped_no_dist": n_all - len(entries),
                       "dist_independent": sum(e["facts"]["dist_method"] == "independent" for e in entries),
                       "type_tags": {k: int(v) for k, v in types.items()}},
            "dropped_examples": df.loc[~df.index.isin(keep.index), "PSRJ"].head(20).tolist(),
            "citations": [{"ref": REF, "doi": DOI, "url": "https://www.atnf.csiro.au/research/pulsar/psrcat/"},
                          {"ref": "Yao, Manchester & Wang 2017, ApJ 835, 29 (YMW16 DM distances)", "doi": "10.3847/1538-4357/835/1/29"}]}
    write_provenance(NAME, prov)
    print(f"{NAME}: ATNF {ver}, {n_all} pulsars, {len(entries)} with DIST, dropped {n_all - len(entries)}; {size} B; {prov['counts']['type_tags']}")


if __name__ == "__main__":
    main()
