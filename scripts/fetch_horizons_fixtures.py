#!/usr/bin/env python3
"""Fetch the JPL Horizons reference vectors for the small-body and satellite accuracy tests.

  web/test/fixtures/horizons_smallbodies.json
      Ceres, Vesta, Apophis and Eris: heliocentric (500@10) geometric ICRF vectors, AU, JD TDB,
      at the MPCORB reference epoch and at a sweep of dates around it (-2 yr ... +5 yr), so the
      test can report how the two-body error grows with the distance from the element epoch.
  web/test/fixtures/horizons_iss.json
      ISS (-125544): geocentric (500@399) geometric ICRF vectors, km, at UT times around the
      epoch of the CelesTrak GP element set used by the satellite layer (data/cache/celestrak).

usage: fetch_horizons_fixtures.py [--ref-jd 2461200.5]
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

from catio import http

ROOT = Path(__file__).resolve().parents[1]
API = "https://ssd.jpl.nasa.gov/api/horizons.api"
FIX = ROOT / "web/test/fixtures"
SMALL = [("1;", "Ceres", 1), ("4;", "Vesta", 4), ("99942;", "Apophis", 99942), ("136199;", "Eris", 136199)]
OFFSETS = [-730, -365, -182, 0, 158, 339, 730, 1826]  # days from the reference epoch; +158 = 2026-11-14


def vectors(cmd: str, center: str, tlist: list[float], units: str, time_type: str | None = None):
    p = {"format": "json", "COMMAND": f"'{cmd}'", "EPHEM_TYPE": "'VECTORS'", "CENTER": f"'{center}'",
         "TLIST": " ".join(f"'{t}'" for t in tlist), "TLIST_TYPE": "'JD'", "REF_PLANE": "'FRAME'", "REF_SYSTEM": "'ICRF'",
         "VEC_TABLE": "'2'", "VEC_CORR": "'NONE'", "OUT_UNITS": f"'{units}'", "CSV_FORMAT": "'YES'", "OBJ_DATA": "'NO'"}
    if time_type:
        p["TIME_TYPE"] = f"'{time_type}'"
    url = API + "?" + urllib.parse.urlencode(p)
    res = http("GET", url, timeout=120).json()["result"]
    if "$$SOE" not in res:
        raise RuntimeError(res[:1500])
    src = next((l.strip() for l in res.splitlines() if l.startswith("Target body name")), "")
    a, b = res.index("$$SOE") + 5, res.index("$$EOE")
    rows = []
    for line in res[a:b].strip().splitlines():
        f = [x.strip() for x in line.split(",")]
        rows.append({"jd": float(f[0]), "xyz": [float(x) for x in f[2:5]], "vel": [float(x) for x in f[5:8]]})
    return url, src, rows


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--ref-jd", type=float, default=2461200.5)
    a = ap.parse_args(argv)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    tl = [a.ref_jd + d for d in OFFSETS]
    bodies = []
    for cmd, name, num in SMALL:
        url, src, rows = vectors(cmd, "500@10", tl, "AU-D")
        bodies.append({"name": name, "number": num, "horizons_target": src, "vectors": [{"jd_tdb": r["jd"], "xyz_au": r["xyz"]} for r in rows]})
        print(f"{name}: {src}")
    # the build's own packed elements for the same bodies (scripts/build_small_bodies.py), so the
    # test checks the whole chain MPCORB line -> packed record -> GPU-twin propagation -> frame
    names = json.loads((ROOT / "data/tiles/small-bodies/names.json").read_text())
    for b in bodies:
        e = next(x for x in names["entries"] if x.get("num") == b["number"])
        b["packed"] = {"class": e["c"], "el": e["el"], "own_epoch_minus_ref_days": e["ep"]}
    (FIX / "horizons_smallbodies.json").write_text(json.dumps({
        "source": f"JPL Horizons API ({API}), fetched {now}", "request": url.split("?", 1)[1],
        "frame": "ICRF equatorial, heliocentric (500@10), geometric, AU, JD TDB", "ref_epoch_jd_tt": a.ref_jd,
        "offsets_days": OFFSETS, "elements_from": f"data/tiles/small-bodies/names.json (MPCORB.DAT file time {names.get('mpcorb_file_time', '?')})",
        "bodies": bodies}, indent=1) + "\n")

    gp = json.loads((ROOT / "data/cache/celestrak/gp_stations.json").read_text())
    iss = next(o for o in gp if o["NORAD_CAT_ID"] == 25544)
    ep = datetime.fromisoformat(iss["EPOCH"]).replace(tzinfo=timezone.utc)
    jd_ep = ep.timestamp() / 86400 + 2440587.5
    hours = [0, 1, 6, 24, 72]
    url, src, rows = vectors("-125544", "500@399", [round(jd_ep + h / 24, 9) for h in hours], "KM-S", "UT")
    (FIX / "horizons_iss.json").write_text(json.dumps({
        "source": f"JPL Horizons API ({API}), fetched {now}", "request": url.split("?", 1)[1], "horizons_target": src,
        "note": "Horizons' ISS trajectory is itself TLE-based ('Trajectory is TLE-based' in its header)",
        "frame": "ICRF equatorial, geocentric (500@399), geometric, km, JD UT", "omm": iss, "hours_after_epoch": hours,
        "vectors": [{"jd_ut": r["jd"], "xyz_km": r["xyz"], "vel_kms": r["vel"]} for r in rows]}, indent=1) + "\n")
    print(f"ISS: {src}, epoch {iss['EPOCH']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
