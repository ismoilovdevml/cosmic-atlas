#!/usr/bin/env python3
"""Build data/tiles/catalogs/planet-features.json: named surface features and landing sites of the
Moon and Mars, for labels, search and fly-to on the streamed surface (web/src/solar/surface).

Sources
  * IAU Gazetteer of Planetary Nomenclature (USGS Astrogeology), "center points" shapefiles,
    https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/{MOON,MARS}_nomenclature_center_pts.zip
    (linked from https://planetarynames.wr.usgs.gov/GIS_Downloads). USGS-produced data are U.S.
    public domain. Coordinates: planetocentric latitude, east longitude 0-360 (Moon 2000 / Mars
    2000), the same system as the NASA Trek tiles.
  * Wikidata labels in Russian and Uzbek, joined on P2824 (Gazetteer of Planetary Nomenclature ID),
    SPARQL https://query.wikidata.org/sparql; Wikidata is CC0.
  * Apollo lunar-module positions: NSSDCA, "Apollo Landing Site Coordinates"
    (https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_sites.html; LRO-derived, Wagner et al. 2017,
    Icarus 283, 92). Apollo 11 itself is the gazetteer's Statio Tranquillitatis.
  * Mars landers: coordinates as listed in Wikipedia "List of artificial objects on Mars" (raw
    wikitext, its cited sources are the NSSDCA master catalogue and mission pages); see LANDERS.

Selection: the gazetteer minus the Moon's lettered "Satellite Feature" craters; per body the
N_LARGEST largest features by diameter, plus every feature with an Uzbek Wikidata label, every
feature with a Russian label and a diameter >= MIN_KNOWN_KM, the FAMOUS ones (Tycho, Copernicus,
Gale, Jezero ...), every "Statio" (lunar landing-site names) and the landers above.

Output: a JSON array of catalogue entries (contract section 4 keys; ra/dec/dist_pc/xyz are null
because these points are fixed to a rotating body; the viewer places them at the simulation time):
    {"name", "alt", "kind": "surface_feature" | "landing_site", "body": "moon" | "mars",
     "lat", "lon" (planetocentric, east 0-360), "diam_km", "type", "names": {"en","uz","ru"},
     "gid", "link", "origin", "ref"}
Provenance: data/tiles/catalogs/provenance/planet-features.json.

usage: build_planet_features.py [--refresh]
"""
from __future__ import annotations

import argparse
import json
import re
import struct
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from catio import CACHE, CATS, download, http, utcnow, write_catalog_json, write_provenance  # noqa: E402

GAZ = "https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/{body}_nomenclature_center_pts.zip"
WIKIDATA = "https://query.wikidata.org/sparql"
SPARQL = """SELECT ?gid ?ru ?uz WHERE { ?i wdt:P2824 ?gid .
 OPTIONAL { ?i rdfs:label ?ru FILTER(lang(?ru) = "ru") }
 OPTIONAL { ?i rdfs:label ?uz FILTER(lang(?uz) = "uz") } }"""
N_LARGEST = 300
MIN_KNOWN_KM = 80.0
# well-known features smaller than that (landing regions, polar exploration targets)
FAMOUS = {"moon": {"Kepler", "Aristarchus", "Shackleton", "Copernicus", "Tycho"},
          "mars": {"Gale", "Jezero", "Gusev", "Endeavour", "Holden", "Eberswalde"}}

# Lunar "Statio" names are landing sites; the mission that landed there (search aliases)
STATIO_MISSION = {
    "Statio Tranquillitatis": ("Apollo 11", "Apollo 11", "Аполлон-11"),
    "Guang Han Gong": ("Chang'e 3", "Chang'e 3", "Чанъэ-3"),
    "Statio Tianhe": ("Chang'e 4", "Chang'e 4", "Чанъэ-4"),
    "Statio Tianchuan": ("Chang'e 5", "Chang'e 5", "Чанъэ-5"),
    "Statio Tianjiang": ("Chang'e 6", "Chang'e 6", "Чанъэ-6"),
    "Statio Shiv Shakti": ("Chandrayaan-3", "Chandrayaan-3", "Чандраян-3"),
}

# NSSDCA lunar-module coordinates (deg N, deg E), LRO / Wagner et al. 2017
APOLLO_LM = [
    ("Apollo 12", "Аполлон-12", -3.0128, -23.4219),
    ("Apollo 14", "Аполлон-14", -3.64589, -17.47194),
    ("Apollo 15", "Аполлон-15", 26.13239, 3.63330),
    ("Apollo 16", "Аполлон-16", -8.9734, 15.5011),
    ("Apollo 17", "Аполлон-17", 20.1911, 30.7723),
]
NSSDC_APOLLO = "NSSDCA, Apollo Landing Site Coordinates (lunar module; LRO, Wagner et al. 2017, Icarus 283, 92)"

# Mars landers: (en, ru, uz, lat, east lon, extra aliases, ref note)
WIKI_MARS = "Wikipedia, List of artificial objects on Mars (raw wikitext 2026-11-14; sources there: NSSDCA master catalogue, mission pages)"
LANDERS = [
    ("Curiosity (Bradbury Landing)", "Кьюриосити", "Curiosity", -4.5895, 137.4417, ["Curiosity", "Bradbury Landing", "Mars Science Laboratory"]),
    ("Perseverance (Octavia E. Butler Landing)", "Персеверанс", "Perseverance", 18.4457, 77.4508, ["Perseverance", "Mars 2020", "Ingenuity"]),
    ("Spirit (Columbia Memorial Station)", "Спирит", "Spirit", -14.5718, 175.4785, ["Spirit", "MER-A"]),
    ("Opportunity (Challenger Memorial Station)", "Оппортьюнити", "Opportunity", -1.9462, 354.4734, ["Opportunity", "MER-B"]),
    ("InSight", "InSight", "InSight", 4.5024, 135.6234, []),
    ("Zhurong", "Чжужун", "Zhurong", 25.1, 109.9, ["Tianwen-1"]),
    ("Mars Pathfinder (Carl Sagan Memorial Station)", "Марс Пасфайндер", "Mars Pathfinder", 19.33, 360 - 33.55, ["Pathfinder", "Sojourner"]),
    ("Viking 1 (Thomas Mutch Memorial Station)", "Викинг-1", "Viking 1", 22.697, 360 - 48.222, ["Viking 1"]),
    ("Viking 2 (Gerald Soffen Memorial Station)", "Викинг-2", "Viking 2", 48.269, 360 - 225.990, ["Viking 2"]),
    ("Phoenix", "Феникс", "Phoenix", 68.22, 360 - 125.7, []),
]

# Uzbek names the brief asks for that Wikidata does not carry (search aliases + label)
UZ_OVERRIDE = {"Tycho": "Tixo", "Copernicus": "Kopernik"}


def read_dbf(data: bytes) -> list[dict]:
    """Minimal dBASE III reader (the shapefile attribute table)."""
    n, hl, rl = struct.unpack("<IHH", data[4:12])
    fields, o = [], 32
    while data[o] != 0x0D:
        d = data[o:o + 32]
        fields.append((d[:11].split(b"\0")[0].decode(), d[16]))
        o += 32
    rows = []
    for i in range(n):
        r = data[hl + i * rl: hl + (i + 1) * rl]
        p, row = 1, {}
        for name, ln in fields:
            row[name] = r[p:p + ln].decode("utf-8", "replace").strip()
            p += ln
        rows.append(row)
    return rows


def uz_apostrophes(s: str) -> str:
    """oʻ / gʻ with U+02BB, the tutuq belgisi (other apostrophes) with U+02BC."""
    s = re.sub(r"([OoGg])['‘’`ʼ]", "\\1ʻ", s)
    return re.sub(r"['’`]", "ʼ", s)


def strip_disambig(s: str) -> str:
    return re.sub(r"\s*\([^)]*\)\s*$", "", s).strip()


def wikidata_labels(refresh: bool) -> dict[str, dict]:
    """Russian / Uzbek labels per gazetteer id (Wikidata P2824), cached as JSON."""
    cache = CACHE / "planet-features" / "wikidata_p2824.json"
    if refresh or not cache.exists():
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(http("GET", WIKIDATA, params={"query": SPARQL, "format": "json"}, timeout=180).text)
    out: dict[str, dict] = {}
    for b in json.loads(cache.read_text())["results"]["bindings"]:
        d = out.setdefault(b["gid"]["value"], {})
        for k in ("ru", "uz"):
            if k in b:
                d.setdefault(k, b[k]["value"])
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true")
    a = ap.parse_args()
    started = utcnow()
    wd = wikidata_labels(a.refresh)
    entries: list[dict] = []
    counts = {}
    for body in ("MOON", "MARS"):
        zpath = download(GAZ.format(body=body), CACHE / "planet-features" / f"{body}_nomenclature_center_pts.zip", refresh=a.refresh)
        with zipfile.ZipFile(zpath) as z:
            dbf = next(n for n in z.namelist() if n.endswith(".dbf"))
            rows = read_dbf(z.read(dbf))
        total = len(rows)
        rows = [r for r in rows if r["type"] != "Satellite Feature" and r["approval"] == "Adopted by IAU"]
        for r in rows:
            r["d"] = float(r["diameter"] or 0)
            r["gid"] = r["link"].rstrip("/").split("/")[-1]
        rows.sort(key=lambda r: -r["d"])
        keep = {id(r) for r in rows[:N_LARGEST]}
        keep |= {id(r) for r in rows if r["d"] >= MIN_KNOWN_KM and wd.get(r["gid"], {}).get("ru")}
        b = body.lower()
        keep |= {id(r) for r in rows if wd.get(r["gid"], {}).get("uz")}
        keep |= {id(r) for r in rows if r["type"] == "Statio" or r["clean_name"] in FAMOUS[b]}
        n_body = 0
        for r in rows:
            if id(r) not in keep:
                continue
            en = r["name"] or r["clean_name"]
            lab = wd.get(r["gid"], {})
            ru = strip_disambig(lab.get("ru", "")) or en
            uz = UZ_OVERRIDE.get(r["clean_name"]) or uz_apostrophes(strip_disambig(lab.get("uz", ""))) or en
            alt = [x for x in dict.fromkeys([r["clean_name"], uz, ru]) if x and x != en]
            kind = "surface_feature"
            if r["type"] == "Statio":
                kind = "landing_site"
                m = STATIO_MISSION.get(en)
                if m:
                    alt = [x for x in dict.fromkeys([*alt, *m]) if x != en]
                    # label shows the mission with the IAU name
                    en_l, uz_l, ru_l = f"{m[0]} ({en})", f"{m[1]} ({en})", f"{m[2]} ({en})"
                    uz, ru = uz_l, ru_l
                    alt.append(en_l)
            entries.append({
                "name": en, "alt": alt, "kind": kind, "ra": None, "dec": None, "dist_pc": None, "mag": None, "xyz": None,
                "ref": f"IAU/USGS Gazetteer of Planetary Nomenclature, feature {r['gid']}",
                "body": b, "lat": round(float(r["center_lat"]), 5), "lon": round(float(r["center_lon"]) % 360, 5),
                "diam_km": round(r["d"], 3), "type": r["type"].split(",")[0], "code": r["code"],
                "names": {"en": f"{STATIO_MISSION[en][0]} ({en})" if en in STATIO_MISSION else en, "uz": uz, "ru": ru}, "gid": int(r["gid"]), "link": r["link"].replace("http://", "https://"),
                "origin": r["origin"],
            })
            n_body += 1
        counts[b] = {"gazetteer_rows": total, "selected": n_body}
    for en, ru, lat, lon in APOLLO_LM:
        entries.append({
            "name": en, "alt": [ru], "kind": "landing_site", "ra": None, "dec": None, "dist_pc": None, "mag": None, "xyz": None,
            "ref": NSSDC_APOLLO, "body": "moon", "lat": lat, "lon": round(lon % 360, 5), "diam_km": 0.0, "type": "Landing site",
            "names": {"en": en, "uz": en, "ru": ru},
        })
    for en, ru, uz, lat, lon, aliases, in LANDERS:
        entries.append({
            "name": en, "alt": [x for x in dict.fromkeys([uz, ru, *aliases]) if x != en], "kind": "landing_site",
            "ra": None, "dec": None, "dist_pc": None, "mag": None, "xyz": None,
            "ref": WIKI_MARS, "body": "mars", "lat": lat, "lon": round(lon % 360, 5), "diam_km": 0.0, "type": "Landing site",
            "names": {"en": en, "uz": uz, "ru": ru},
        })
    counts["landers"] = {"apollo_lm": len(APOLLO_LM), "mars": len(LANDERS)}
    out = CATS / "planet-features.json"
    size = write_catalog_json(out, entries, drop_none=False)
    write_provenance("planet-features", {
        "catalog": "data/tiles/catalogs/planet-features.json", "bytes": size, "started_utc": started, "finished_utc": utcnow(),
        "counts": counts, "entries": len(entries),
        "selection": f"non-satellite IAU features: {N_LARGEST} largest per body + Uzbek-labelled + Russian-labelled >= {MIN_KNOWN_KM} km + {sorted(FAMOUS['moon'] | FAMOUS['mars'])} + all Statio + landers",
        "service": {"gazetteer": [GAZ.format(body="MOON"), GAZ.format(body="MARS")], "wikidata": WIKIDATA,
                    "apollo": "https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_sites.html",
                    "mars_landers": "https://en.wikipedia.org/w/index.php?title=List_of_artificial_objects_on_Mars&action=raw"},
        "licences": {"gazetteer": "USGS-produced data, U.S. public domain", "wikidata": "CC0", "nssdc": "NASA, U.S. public domain"},
        "coordinates": "planetocentric latitude, east longitude 0-360 (Moon 2000, Mars 2000)",
        "caveats": ["Viking 1/2, Pathfinder and Phoenix coordinates are older NSSDCA values (control networks of their time; may be off by ~1 km)",
                    "Uzbek names: Wikidata 'uz' labels where present (apostrophes normalised to U+02BB/U+02BC), else the IAU name; Tycho->Tixo and Copernicus->Kopernik are set by hand"],
    })
    print(f"{out}: {len(entries)} entries, {size} B; {counts}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
