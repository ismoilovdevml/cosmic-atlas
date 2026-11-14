#!/usr/bin/env python3
"""Build data/tiles/satellites/: a CelesTrak GP snapshot (Earth satellites, SGP4 in the browser)
and the James Webb Space Telescope's track from JPL Horizons.

Why a snapshot: CelesTrak's usage policy (https://celestrak.org/usage-policy.php, updated
2026-11-12) asks clients to "only download data once per update" (GP data update every 2 hours)
and says it now enforces limits "for larger data sets, like the Active list for GP data and the
Starlink list". Its responses do send `Access-Control-Allow-Origin: *`, so a browser could fetch
them, but one request per viewer would break that policy. The viewer therefore reads this file,
and a scheduled job may rebuild it (never more often than every 2 hours).

Inputs (data/cache/celestrak/, fetched by this script only when missing or older than 2 h):
  gp_active.json    https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json
  gp_stations.json  https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=json
  gp_starlink.json  https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=json
JWST: Horizons COMMAND='-170', CENTER='500@399' (geocentric), geometric ICRF state vectors,
daily, converted to the contract frame (Galactic, pc and pc/day) like build_spacecraft.py.

Output:
  gp.json    {"fields": [...OMM keys...], "rows": [[...], ...], "group": [0|1|2 per row]}
             group 0 = space stations, 1 = Starlink, 2 = other active satellites
  jwst.json  catalogue-style entry with a geocentric `track` (t0_jd_tdb, step_days, n, xyz_pc, vel_pc_per_day)
  meta.json  snapshot time, counts, sources, policy notes

usage: build_satellites.py [--refresh]
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from build_spacecraft import icrs_to_gal
from catio import http

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data/cache/celestrak"
OUT = ROOT / "data/tiles/satellites"
GP = "https://celestrak.org/NORAD/elements/gp.php?GROUP={g}&FORMAT=json"
API = "https://ssd.jpl.nasa.gov/api/horizons.api"
PC_PER_AU = 4.84813681109536e-6
KM_PER_AU = 149597870.7
FIELDS = ["OBJECT_NAME", "OBJECT_ID", "EPOCH", "MEAN_MOTION", "ECCENTRICITY", "INCLINATION", "RA_OF_ASC_NODE",
          "ARG_OF_PERICENTER", "MEAN_ANOMALY", "NORAD_CAT_ID", "BSTAR", "MEAN_MOTION_DOT", "MEAN_MOTION_DDOT"]
JWST_SPAN = ("2026-01-01", "2028-12-31", "1 d")


def gp(group: str, refresh: bool) -> tuple[list, str]:
    p = CACHE / f"gp_{group}.json"
    age = time.time() - p.stat().st_mtime if p.exists() else 1e9
    if refresh and age < 7200:
        print(f"  {p.name}: {age / 60:.0f} min old; CelesTrak updates every 2 h, so it is not fetched again")
    if not p.exists() or (refresh and age >= 7200):
        r = http("GET", GP.format(g=group), retries=1, timeout=120)  # one try: the policy says stop on any non-200
        CACHE.mkdir(parents=True, exist_ok=True)
        p.write_bytes(r.content)
    fetched = datetime.fromtimestamp(p.stat().st_mtime, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return json.loads(p.read_text()), fetched


def jwst_track(M: np.ndarray) -> dict:
    p = {"format": "json", "COMMAND": "'-170'", "EPHEM_TYPE": "'VECTORS'", "CENTER": "'500@399'",
         "START_TIME": f"'{JWST_SPAN[0]}'", "STOP_TIME": f"'{JWST_SPAN[1]}'", "STEP_SIZE": f"'{JWST_SPAN[2]}'",
         "REF_PLANE": "'FRAME'", "REF_SYSTEM": "'ICRF'", "VEC_TABLE": "'2'", "VEC_CORR": "'NONE'",
         "OUT_UNITS": "'AU-D'", "CSV_FORMAT": "'YES'", "OBJ_DATA": "'NO'"}
    url = API + "?" + urllib.parse.urlencode(p)
    res = http("GET", url, timeout=120).json()["result"]
    if "$$SOE" not in res:
        raise RuntimeError(res[:1500])
    src = next((l.strip() for l in res.splitlines() if l.startswith("Target body name")), "")
    a, b = res.index("$$SOE") + 5, res.index("$$EOE")
    rows = np.array([[float(x) for x in [l.split(",")[0]] + l.split(",")[2:8]] for l in res[a:b].strip().splitlines()])
    jd = rows[:, 0]
    assert np.allclose(np.diff(jd), 1.0)
    pos = (rows[:, 1:4] @ M.T) * PC_PER_AU
    vel = (rows[:, 4:7] @ M.T) * PC_PER_AU
    r_km = np.linalg.norm(rows[:, 1:4], axis=1) * KM_PER_AU
    return {
        "name": "James Webb Space Telescope", "alt": ["JWST", "Webb", "Horizons -170"], "kind": "satellite",
        "docs": "spacecraft", "facts": {"horizons_id": -170, "launch": "2021-12-25"},
        "ref": "JPL Horizons, geocentric geometric state vectors (ICRF), " + src,
        "provenance": {"service": API, "request": url, "horizons_source": src,
                       "geocentric_km_range": [round(float(r_km.min())), round(float(r_km.max()))]},
        "track": {"t0_jd_tdb": float(jd[0]), "step_days": 1.0, "n": int(len(jd)),
                  "xyz_pc": [float(f"{v:.10e}") for v in pos.ravel()],
                  "vel_pc_per_day": [float(f"{v:.9e}") for v in vel.ravel()]},
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--refresh", action="store_true", help="re-fetch CelesTrak if the cache is >= 2 h old")
    a = ap.parse_args(argv)
    OUT.mkdir(parents=True, exist_ok=True)
    active, t_active = gp("active", a.refresh)
    stations, t_st = gp("stations", a.refresh)
    starlink, t_sl = gp("starlink", a.refresh)
    st_ids = {o["NORAD_CAT_ID"] for o in stations}
    sl_ids = {o["NORAD_CAT_ID"] for o in starlink}
    by_id = {o["NORAD_CAT_ID"]: o for o in active}
    for o in stations + starlink:  # the groups are subsets of 'active' today; keep any that are not
        by_id.setdefault(o["NORAD_CAT_ID"], o)
    objs = sorted(by_id.values(), key=lambda o: o["NORAD_CAT_ID"])
    rows, group = [], []
    for o in objs:
        rows.append([o.get(k) for k in FIELDS])
        group.append(0 if o["NORAD_CAT_ID"] in st_ids else 1 if o["NORAD_CAT_ID"] in sl_ids else 2)
    (OUT / "gp.json").write_text(json.dumps({"fields": FIELDS, "rows": rows, "group": group}, separators=(",", ":")) + "\n")
    epochs = sorted(o["EPOCH"] for o in objs)
    jw = jwst_track(icrs_to_gal())
    (OUT / "jwst.json").write_text(json.dumps(jw, separators=(",", ":")) + "\n")
    meta = {
        "version": 1, "title": "Earth satellites (CelesTrak GP snapshot) + JWST (JPL Horizons)",
        "snapshot_utc": t_active, "count": len(objs),
        "groups": {"stations": group.count(0), "starlink": group.count(1), "other_active": group.count(2)},
        "element_epochs_utc": {"oldest": epochs[0], "median": epochs[len(epochs) // 2], "newest": epochs[-1]},
        "files": {"gp.json": (OUT / "gp.json").stat().st_size, "jwst.json": (OUT / "jwst.json").stat().st_size},
        "credit": "Satellite orbits: CelesTrak GP data (T.S. Kelso), from the 18th Space Defense Squadron catalogue; SGP4 by satellite.js; JWST: JPL Horizons",
        "policy": "CelesTrak usage policy: download once per 2-hour update; no licence text found (checked 2026-11-14). Not fetched per viewer.",
        "sources": {"active": {"url": GP.format(g="active"), "fetched_utc": t_active},
                    "stations": {"url": GP.format(g="stations"), "fetched_utc": t_st},
                    "starlink": {"url": GP.format(g="starlink"), "fetched_utc": t_sl},
                    "jwst": {"url": jw["provenance"]["request"], "source": jw["provenance"]["horizons_source"]}},
        "built_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    (OUT / "meta.json").write_text(json.dumps(meta, indent=1) + "\n")
    print(f"{len(objs)} satellites ({meta['groups']}), epochs {epochs[0]} .. {epochs[-1]}")
    print(f"gp.json {meta['files']['gp.json'] / 1e6:.2f} MB, jwst.json {meta['files']['jwst.json'] / 1e3:.0f} kB "
          f"(JWST {jw['track']['n']} days, {jw['provenance']['geocentric_km_range']} km from Earth)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
