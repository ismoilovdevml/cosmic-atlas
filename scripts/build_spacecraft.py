#!/usr/bin/env python3
"""Build data/tiles/catalogs/spacecraft.json: heliocentric tracks of the interstellar probes.

Source: JPL Horizons API (https://ssd.jpl.nasa.gov/api/horizons.api), geometric heliocentric
state vectors (CENTER='500@10', REF_PLANE='FRAME', REF_SYSTEM='ICRF', VEC_TABLE='2',
VEC_CORR='NONE', OUT_UNITS='AU-D'), 2000-01-01 to 2040-01-01 TDB every 30 days. Where Horizons
has no ephemeris for part of that span (New Horizons before its 2006 launch), the span is
clipped to the coverage Horizons reports and the clip is recorded in the entry's provenance.

Output: a JSON list of catalogue entries (docs/content-contract.md section 3 shape), one per
probe, each with a `track`:

    {"t0_jd_tdb": ..., "step_days": 30, "n": N,
     "xyz_pc": [x0, y0, z0, x1, ...],          # heliocentric Galactic Cartesian, pc (contract §1)
     "vel_pc_per_day": [vx0, vy0, vz0, ...]}   # same frame, pc / day

`xyz` / `dist_pc` of the entry are the position at the build time (UTC now), for tools that
read catalogues statically. The viewer interpolates the track (cubic Hermite) at the
simulation time instead.

The ICRS -> Galactic rotation comes from astropy (`Galactic`), the same frame the tiles use.

usage: build_spacecraft.py [--out data/tiles/catalogs/spacecraft.json]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.parse
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import astropy.units as u
from astropy.coordinates import SkyCoord

from catio import http  # repo helper: requests with retries/back-off

ROOT = Path(__file__).resolve().parents[1]
API = "https://ssd.jpl.nasa.gov/api/horizons.api"
PC_PER_AU = 4.84813681109536e-6
START, STOP, STEP = "2000-01-01", "2040-01-01", "30 d"

PROBES = [
    # Horizons id, name, docs slug, launch (UTC date)
    (-31, "Voyager 1", "voyager-1", "1977-09-05"),
    (-32, "Voyager 2", "spacecraft", "1977-08-20"),
    (-23, "Pioneer 10", "spacecraft", "1972-03-03"),
    (-24, "Pioneer 11", "spacecraft", "1973-04-06"),
    (-98, "New Horizons", "spacecraft", "2006-01-19"),
]


def icrs_to_gal() -> np.ndarray:
    """Rows = Galactic axes in ICRS components (astropy), so gal = M @ icrs."""
    e = SkyCoord(x=[1, 0, 0], y=[0, 1, 0], z=[0, 0, 1], unit=u.pc, frame="icrs", representation_type="cartesian")
    g = e.galactic.cartesian
    # columns = images of the ICRS unit vectors
    return np.array([g.x.value, g.y.value, g.z.value])


def params(cmd: int, start: str) -> dict:
    return {
        "format": "json", "COMMAND": f"'{cmd}'", "EPHEM_TYPE": "'VECTORS'", "CENTER": "'500@10'",
        "START_TIME": f"'{start}'", "STOP_TIME": f"'{STOP}'", "STEP_SIZE": f"'{STEP}'",
        "REF_PLANE": "'FRAME'", "REF_SYSTEM": "'ICRF'", "VEC_TABLE": "'2'", "VEC_CORR": "'NONE'",
        "OUT_UNITS": "'AU-D'", "CSV_FORMAT": "'YES'", "OBJ_DATA": "'NO'",
    }


def fetch(cmd: int, start: str) -> tuple[str, str]:
    url = API + "?" + urllib.parse.urlencode(params(cmd, start))
    return url, http("GET", url, timeout=120).json()["result"]


def parse(result: str) -> tuple[str, np.ndarray]:
    src = next((l.strip() for l in result.splitlines() if l.startswith("Target body name")), "")
    a, b = result.index("$$SOE") + 5, result.index("$$EOE")
    rows = []
    for line in result[a:b].strip().splitlines():
        p = [x.strip() for x in line.split(",")]
        rows.append([float(p[0])] + [float(x) for x in p[2:8]])
    return src, np.array(rows)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", default=str(ROOT / "data/tiles/catalogs/spacecraft.json"))
    a = ap.parse_args(argv)
    M = icrs_to_gal()
    now = datetime.now(timezone.utc)
    jd_now = now.timestamp() / 86400 + 2440587.5 + 69.184 / 86400  # UTC -> ~TDB (TT-UTC = 69.184 s)
    out = []
    for cmd, name, docs, launch in PROBES:
        start = START
        url, res = fetch(cmd, start)
        clipped = None
        if "$$SOE" not in res:
            m = re.search(r"prior to A\.D\. (\d{4})-([A-Z]{3})-(\d{2})", res)
            if not m:
                print(f"{name}: Horizons error:\n{res[:800]}", file=sys.stderr)
                return 1
            d = datetime.strptime(f"{m.group(1)}-{m.group(2).title()}-{m.group(3)}", "%Y-%b-%d")
            start = (d + timedelta(days=1)).strftime("%Y-%m-%d")
            clipped = f"Horizons has no ephemeris before {m.group(0).removeprefix('prior to ')}; track starts {start}"
            url, res = fetch(cmd, start)
        src, arr = parse(res)
        jd = arr[:, 0]
        step = np.diff(jd)
        assert np.allclose(step, 30.0), f"{name}: uneven step"
        pos = (arr[:, 1:4] @ M.T) * PC_PER_AU
        vel = (arr[:, 4:7] @ M.T) * PC_PER_AU
        # position now (linear in the 30-day cell is fine for this static field)
        i = int(np.clip(np.searchsorted(jd, jd_now) - 1, 0, len(jd) - 2))
        f = (jd_now - jd[i]) / 30.0
        p_now = pos[i] * (1 - f) + pos[i + 1] * f
        dist = float(np.linalg.norm(p_now))
        out.append({
            "name": name,
            "alt": [f"Horizons {cmd}"],
            "kind": "spacecraft",
            "docs": docs,
            "dist_pc": round(dist, 12),
            "xyz": [round(float(v), 12) for v in p_now],
            "facts": {"launch": launch, "horizons_id": cmd},
            "ref": "JPL Horizons, heliocentric geometric state vectors (ICRF), " + src,
            "provenance": {
                "service": API, "request": url, "fetched_utc": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "horizons_source": src, "frame_conversion": "ICRS -> Galactic with astropy Galactic; AU -> pc (IAU 2012 AU)",
                **({"clipped": clipped} if clipped else {}),
            },
            "track": {
                "t0_jd_tdb": float(jd[0]), "step_days": 30.0, "n": int(len(jd)),
                "xyz_pc": [round(float(v), 13) for v in pos.ravel()],
                "vel_pc_per_day": [float(f"{v:.9e}") for v in vel.ravel()],
            },
        })
        print(f"{name}: {len(jd)} samples {jd[0]:.1f}..{jd[-1]:.1f} JD TDB, now {dist / PC_PER_AU:.2f} AU"
              + (f" ({clipped})" if clipped else ""))
    Path(a.out).write_text(json.dumps(out, separators=(",", ":")) + "\n")
    print(f"wrote {a.out} ({Path(a.out).stat().st_size / 1024:.0f} KiB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
