#!/usr/bin/env python
"""exoplanets.json: confirmed exoplanets grouped by host star, kind `exoplanet`.

PROVENANCE
  Source: NASA Exoplanet Archive, Planetary Systems Composite Parameters table `pscomppars`
      (one row per confirmed planet, parameters combined from several references), TAP sync
      endpoint https://exoplanetarchive.ipac.caltech.edu/TAP. Citation: NASA Exoplanet Archive,
      "Planetary Systems Composite Data", doi:10.26133/NEA13 (Akeson et al. 2013, PASP 125, 989).
      Per-parameter literature references are in the archive's *_reflink columns (not copied here).
  Selection: every row with a host distance (sy_dist IS NOT NULL).
  Grouping: one entry per host star (`hostname`), so the map draws one marker per system; the
      planets are in `planets`; the viewer adds their names to the search aliases.
  Distance: sy_dist (pc); dist_lo/hi = sy_dist + sy_disterr2 / sy_disterr1 (the archive's 1-sigma).
  Position: ra/dec of the system (ICRS, deg) from the same table.
  Size rule: committed while < 2 MB (contract section 4); the script fails loudly above that.

Output: data/tiles/catalogs/exoplanets.json, provenance in data/tiles/catalogs/provenance/.
Usage: .venv/bin/python scripts/build_exoplanets.py [--refresh]
"""
from __future__ import annotations

import argparse
import io
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from catio import CACHE, CATS, http, sig, utcnow, write_catalog_json, write_provenance  # noqa: E402
from coords import xyz_list  # noqa: E402

NAME = "exoplanets"
TAP = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync"
COLS = ["pl_name", "hostname", "discoverymethod", "disc_year", "ra", "dec", "sy_vmag", "sy_pnum",
        "pl_orbper", "pl_orbpererr1", "pl_orbpererr2", "pl_rade", "pl_radeerr1", "pl_radeerr2",
        "pl_bmassj", "pl_bmassjerr1", "pl_bmassjerr2", "pl_bmassprov", "pl_eqt", "pl_eqterr1", "pl_eqterr2",
        "sy_dist", "sy_disterr1", "sy_disterr2"]
ADQL = f"SELECT {', '.join(COLS)} FROM pscomppars WHERE sy_dist IS NOT NULL"
REF = "NASA Exoplanet Archive, Planetary Systems Composite Data (pscomppars)"
DOI = "10.26133/NEA13"
REF_SHORT = "NASA Exoplanet Archive"
DOCS = {"Proxima Cen": "proxima-b", "TRAPPIST-1": "trappist-1"}
MAX_BYTES = 2_000_000


def val(r, col: str, n: int = 4):
    """value or [value, +err, -err] (archive convention: err1 >= 0, err2 <= 0), n significant digits."""
    v = sig(r[col], n)
    if v is None:
        return None
    e1, e2 = sig(r.get(col + "err1"), 2), sig(r.get(col + "err2"), 2)
    if e1 is None and e2 is None:
        return v
    # with an error bar, keep the value to the error's second significant digit (never fewer than
    # 3 significant digits): 11.18465 +- 0.00053 d stays 11.18465
    emin = min(abs(x) for x in (e1, e2) if x)  if any((e1, e2)) else 0
    if emin > 0:
        dec = 1 - int(np.floor(np.log10(emin)))
        v = float(round(float(r[col]), max(dec, 0))) if dec >= 0 else v
        if sig(v, 3) != sig(r[col], 3):
            v = sig(r[col], 3)
    if e1 is not None and e2 is not None and e1 == -e2:
        return [v, e1]  # symmetric: [value, error]
    return [v, e1, e2]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true")
    a = ap.parse_args()
    started = utcnow()
    cache = CACHE / NAME / "pscomppars.csv"
    if a.refresh or not cache.exists():
        cache.parent.mkdir(parents=True, exist_ok=True)
        r = http("GET", TAP, params={"query": ADQL, "format": "csv"})
        cache.write_text(r.text)
    df = pd.read_csv(cache)
    total_q = http("GET", TAP, params={"query": "SELECT count(*) AS n FROM pscomppars", "format": "csv"}).text
    n_all = int(pd.read_csv(io.StringIO(total_q))["n"].iloc[0])

    entries = []
    for host, g in df.sort_values(["hostname", "pl_orbper"]).groupby("hostname", sort=True):
        r0 = g.iloc[0]
        d = float(r0.sy_dist)
        e1, e2 = r0.sy_disterr1, r0.sy_disterr2
        planets = []
        for _, r in g.iterrows():
            p = {"pl_name": r.pl_name, "discoverymethod": r.discoverymethod, "disc_year": int(r.disc_year)}
            # masses only when measured ('Mass') or a minimum mass ('Msini'); the archive's
            # mass-radius-relation estimates are a model, not a measurement, and are left out
            measured = r.pl_bmassprov in ("Mass", "Msini")
            for col, n in (("pl_orbper", 6), ("pl_rade", 3), ("pl_bmassj", 3)):
                v = val(r, col, n)
                if v is not None and (col != "pl_bmassj" or measured):
                    p[col] = v
            if np.isfinite(r.pl_eqt):  # equilibrium temperature: a derived quantity, value only
                p["pl_eqt"] = int(round(float(r.pl_eqt)))
            if r.pl_bmassprov == "Msini" and "pl_bmassj" in p:
                p["pl_bmassprov"] = "Msini"
            planets.append(p)
        # alt stays empty: the viewer adds the planet names from `planets` (saves ~10 % of the file);
        # the long citation + DOI live once in the provenance block, entries carry a short ref.
        e = {"name": host, "kind": "exoplanet",
             "ra": round(float(r0.ra), 5), "dec": round(float(r0.dec), 5), "dist_pc": sig(d, 5),
             "mag": sig(r0.sy_vmag, 3), "xyz": xyz_list(r0.ra, r0.dec, d, 2), "ref": REF_SHORT}
        if np.isfinite(e1) and np.isfinite(e2):
            e["dist_lo_pc"], e["dist_hi_pc"] = sig(d + e2, 4), sig(d + e1, 4)
        if host in DOCS:
            e["docs"] = DOCS[host]
        if int(r0.sy_pnum) != len(planets):
            e["facts"] = {"planets_in_system": int(r0.sy_pnum)}
        e["planets"] = planets
        entries.append(e)

    path = CATS / f"{NAME}.json"
    size = write_catalog_json(path, entries, drop_none=True)
    # contract section 4: committed only when < 2 MB
    if size >= MAX_BYTES:
        raise SystemExit(f"{path}: {size} B >= 2 MB; build it as a point layer instead (pipeline/build_tiles.py)")
    meth = df["discoverymethod"].value_counts()
    prov = {"catalog": f"data/tiles/catalogs/{NAME}.json", "bytes": size, "started_utc": started, "finished_utc": utcnow(),
            "service": TAP, "query": ADQL,
            "counts": {"pscomppars_rows": n_all, "planets_with_sy_dist": int(len(df)), "dropped_no_distance": n_all - int(len(df)),
                       "host_systems": len(entries),
                       "masses_omitted_mr_relation": int((df["pl_bmassprov"] == "M-R relationship").sum()), "multi_planet_systems": sum(len(e["planets"]) > 1 for e in entries),
                       "by_method": {k: int(v) for k, v in meth.items()}},
            "fields": "planets[]: pl_name, discoverymethod, disc_year, pl_orbper [d], pl_rade [R_earth], pl_bmassj [M_jup], "
                      "pl_eqt [K, value only]; other numbers are value, [value, err] (symmetric) or [value, err1, err2] as in the archive (err1 >= 0, err2 <= 0); "
                      "pl_bmassprov = 'Msini' marks minimum masses; masses from the archive's mass-radius relation are omitted.",
            "citations": [{"ref": REF, "doi": DOI},
                          {"ref": "Akeson et al. 2013, PASP 125, 989 (NASA Exoplanet Archive)", "doi": "10.1086/672273"}]}
    write_provenance(NAME, prov)
    print(f"{NAME}: {len(entries)} systems, {len(df)} planets, {size} B; {prov['counts']}")


if __name__ == "__main__":
    main()
