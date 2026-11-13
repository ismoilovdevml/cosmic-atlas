#!/usr/bin/env python
"""Galaxy shapes for the viewer's dot -> disk -> thumbnail LOD (docs/data-contract.md section 4b).

For every galaxy in data/tiles/catalogs/{local-volume,local-group,messier-ngc}.json this collects
the apparent major/minor axis, the position angle, an inclination estimate and the morphology,
each with its own source key, and writes data/tiles/catalogs/galaxy-shapes.json.

Sources, in priority order per field:

  axes (D25)    HyperLEDA live database (logd25, logr25; 25 B-mag/arcsec^2 isophote)
                -> OpenNGC v20260501 MajAx/MinAx (taken from LEDA by OpenNGC)
                -> HyperLEDA 2003 on VizieR VII/237 (logD25, logR25)
                -> UNGC a26, b/a (Holmberg isophote, 26.5 B-mag/arcsec^2, so ~1.3x larger than D25)
                -> McConnachie 2012 (Jan 2021 update): 2 r_h along the major axis, b/a = 1 - e
                   (dwarf spheroidals have no D25; 2 r_h is the half-light diameter)
  PA            HyperLEDA live pa -> OpenNGC PosAng -> VII/237 PA (B1950, precessed to J2000 here)
                -> McConnachie PA. North through East, of the major axis, J2000.
  inclination   HyperLEDA live incl (from logr25 and type, Paturel+ 1997 / Makarov+ 2014)
                -> UNGC i -> derived here from b/a with an intrinsic thickness q0 = 0.2
                (Hubble 1926: cos^2 i = (q^2 - q0^2) / (1 - q0^2)).
                Not given for spheroidal systems (E, dE, dSph, dS0): shape = "spheroid".
  morphology    HyperLEDA type / t -> OpenNGC Hubble -> UNGC TT + Mcl

Catalogue galaxies are matched to PGC numbers by their 'PGC n' alias, else by SIMBAD identifier
lookup of their names (Harvard SIMBAD TAP), else by a 1.5 arcmin SIMBAD cone for an object of
galaxy type.

Services: HyperLEDA at atlas.obs-hp.fr (leda.univ-lyon1.fr redirects there), VizieR at
vizier.cfa.harvard.edu (cdsarc.cds.unistra.fr times out from the build host), SIMBAD TAP at
simbad.harvard.edu. Downloads are cached in data/cache/galaxy-shapes/ (gitignored). The provenance
block (services, priorities, counts, citations) goes to data/tiles/catalogs/provenance/galaxy-shapes.json.

Usage:
  .venv/bin/python scripts/build_galaxy_shapes.py [--refresh]
  .venv/bin/python scripts/build_galaxy_shapes.py --check M31 M33 M81 M101 "NGC 253" LMC
      (prints ours vs SIMBAD galdim vs NED RC3 D25 for those names; writes nothing)
"""
from __future__ import annotations

import argparse
import io
import json
import re
import sys
import urllib.parse
from pathlib import Path

import numpy as np
import pandas as pd
import astropy.units as u
from astropy.coordinates import FK4, SkyCoord
from astropy.table import Table

sys.path.insert(0, str(Path(__file__).resolve().parent))
from catio import ROOT, SIMBAD_TAP, download, fetch_vizier, http, num, tap_sync, utcnow  # noqa: E402

CATS = ROOT / "data" / "tiles" / "catalogs"
CACHE = ROOT / "data" / "cache" / "galaxy-shapes"
OUT = CATS / "galaxy-shapes.json"
PROV = CATS / "provenance" / "galaxy-shapes.json"
INPUTS = ["local-volume.json", "local-group.json", "messier-ngc.json"]
LEDA = "http://atlas.obs-hp.fr/hyperleda/fG.cgi"
OPENNGC_TAG = "v20260501"
OPENNGC = f"https://raw.githubusercontent.com/mattiaverga/OpenNGC/{OPENNGC_TAG}/database_files/"
MCC_URL = "https://www.cadc-ccda.hia-iha.nrc-cnrc.gc.ca/files/vault/PANDAS/NearbyGals/NearbyGalaxies_Jan2021_PUBLIC.fits"
Q0 = 0.2  # intrinsic disk thickness for the b/a -> inclination fallback

SOURCES = {
    "hyperleda": {"ref": "HyperLEDA, Makarov et al. 2014, A&A 570, A13 (live database, meandata table; "
                         "fields logd25, logr25, pa, incl, t, type)", "doi": "10.1051/0004-6361/201423496",
                  "url": "http://atlas.obs-hp.fr/hyperleda/"},
    "openngc": {"ref": f"Verga, OpenNGC {OPENNGC_TAG} (CC-BY-SA-4.0); galaxy axes/PA/Hubble type from LEDA",
                "url": "https://github.com/mattiaverga/OpenNGC"},
    "leda2003": {"ref": "Paturel et al. 2003, A&A 412, 45 (HYPERLEDA I, VizieR VII/237; PA precessed B1950 -> J2000)",
                 "doi": "10.1051/0004-6361:20031411"},
    "ungc": {"ref": "Karachentsev, Makarov & Kaisina 2013, AJ 145, 101 (UNGC, VizieR J/AJ/145/101; a26 = "
                    "Holmberg diameter, i = inclination)", "doi": "10.1088/0004-6256/145/4/101"},
    "mcc": {"ref": "McConnachie 2012, AJ 144, 4 (Jan 2021 update; r_h, e = 1 - b/a, PA)",
            "doi": "10.1088/0004-6256/144/1/4", "url": MCC_URL},
    "derived": {"ref": "Derived here from b/a with intrinsic thickness q0 = 0.2 (Hubble 1926, ApJ 64, 321)",
                "doi": "10.1086/143018"},
    "simbad": {"ref": "Wenger et al. 2000, A&AS 143, 9 (SIMBAD; used only to find PGC numbers)",
               "doi": "10.1051/aas:2000332"},
}

SHORT = {"hyperleda": "HyperLEDA (Makarov+ 2014)", "openngc": "OpenNGC (LEDA)", "leda2003": "HyperLEDA 2003 (Paturel+ 2003)",
         "ungc": "UNGC (Karachentsev+ 2013)", "mcc": "McConnachie 2012", "derived": "derived from b/a (q0 = 0.2)"}
AXES_DEF = {"hyperleda": "D25", "openngc": "D25", "leda2003": "D25", "ungc": "a26 (Holmberg)", "mcc": "2 r_h"}


def catalog_key(s: str) -> str:
    """Same normalisation as web/src/data/manifest.ts catalogKey()."""
    k = re.sub(r"[^a-z0-9*+]", "", s.lower())
    m = re.fullmatch(r"(?:messier|m)0*(\d{1,3})", k)
    if m:
        return f"m{m.group(1)}"
    n = re.fullmatch(r"(ngc|ic|ugc|pgc|hip|hd)0*(\d+)", k)
    return f"{n.group(1)}{n.group(2)}" if n else k


def f_or_none(v, nd: int = 3):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return round(x, nd) if np.isfinite(x) else None


# ----------------------------------------------------------------------------- input objects
def load_objects() -> list[dict]:
    """Galaxy entries of the three catalogues, grouped by shared name/alias (as the viewer does)."""
    rows = []
    for fn in INPUTS:
        for e in json.loads((CATS / fn).read_text()):
            if e.get("kind") not in ("galaxy", "lg_galaxy") or re.match(r"(?i)milky way", e["name"]):
                continue
            if e.get("ra") is None or e.get("dec") is None:
                continue
            rows.append({**e, "_cat": fn})
    groups: list[dict] = []
    by_key: dict[str, int] = {}
    for e in rows:
        names = [e["name"], *(e.get("alt") or [])]
        keys = {catalog_key(n) for n in names if n}
        hit = sorted({by_key[k] for k in keys if k in by_key})
        if hit:
            g = groups[hit[0]]
            for j in hit[1:]:  # merge groups joined by this entry
                o = groups[j]
                g["entries"] += o["entries"]
                g["keys"] |= o["keys"]
                o["entries"], o["keys"] = [], set()
                for k in g["keys"]:
                    by_key[k] = hit[0]
        else:
            groups.append({"entries": [], "keys": set()})
            g = groups[-1]
            hit = [len(groups) - 1]
        g["entries"].append(e)
        g["keys"] |= keys
        for k in keys:
            by_key[k] = hit[0]
    out = []
    for g in groups:
        if not g["entries"]:
            continue
        es = g["entries"]
        # primary: messier-ngc > local-volume > local-group (shortest, most familiar names first)
        order = {"messier-ngc.json": 0, "local-volume.json": 1, "local-group.json": 2}
        es.sort(key=lambda e: order[e["_cat"]])
        names = list(dict.fromkeys(n for e in es for n in [e["name"], *(e.get("alt") or [])] if n))
        sep = SkyCoord([e["ra"] for e in es] * u.deg, [e["dec"] for e in es] * u.deg)
        spread = float(sep.separation(sep[0]).arcmin.max())
        out.append({"name": es[0]["name"], "names": names, "ra": es[0]["ra"], "dec": es[0]["dec"],
                    "cats": sorted({e["_cat"].removesuffix(".json") for e in es}), "spread_arcmin": spread,
                    "entries": es})
    return out


# ----------------------------------------------------------------------------- PGC numbers
def simbad_variants(name: str) -> list[str]:
    """SIMBAD-style spellings of a catalogue name ('UGC12894' -> 'UGC 12894', 'LMC' -> 'NAME LMC')."""
    v = [name]
    m = re.fullmatch(r"([A-Za-z]+)\s*0*(\d+[A-Za-z]?)", name.strip())
    if m:
        v.append(f"{m.group(1)} {m.group(2)}")
    m = re.fullmatch(r"(ESO|MCG|KK|KKH|KKR|KKS|KDG|DDO|UGCA|AGC|LV|HIPASS|DWINGELOO)\s*(.+)", name.strip(), re.I)
    if m:
        v.append(f"{m.group(1).upper()} {m.group(2)}")
    if not re.search(r"\d", name):
        v.append(f"NAME {name}")
    return list(dict.fromkeys(s for s in v if s))


def sq(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def resolve_pgc(objs: list[dict], refresh: bool) -> None:
    cache = CACHE / "simbad_pgc.json"
    known = json.loads(cache.read_text()) if cache.exists() and not refresh else {}
    # 1) explicit alias
    for o in objs:
        for n in o["names"]:
            m = re.fullmatch(r"(?:PGC|LEDA)\s*0*(\d+)", n.strip(), re.I)
            if m:
                o["pgc"], o["pgc_how"] = int(m.group(1)), "alias"
                break
    # 2) SIMBAD identifier lookup -> oid -> 'PGC n' / 'LEDA n' identifier
    todo = [o for o in objs if "pgc" not in o]
    idents = sorted({v for o in todo for n in o["names"] for v in simbad_variants(n)} - set(known))
    for k in range(0, len(idents), 200):
        part = idents[k:k + 200]
        q = (f"SELECT i.id AS ident, i.oidref FROM ident AS i WHERE i.id IN ({','.join(sq(x) for x in part)})")
        df = tap_sync(SIMBAD_TAP, q)
        hits = dict(zip(df["ident"].map(lambda s: " ".join(str(s).split())), df["oidref"].astype(int))) if len(df) else {}
        oids = sorted(set(hits.values()))
        pgc_of: dict[int, int] = {}
        for j in range(0, len(oids), 300):
            q2 = (f"SELECT oidref, id FROM ident WHERE oidref IN ({','.join(map(str, oids[j:j + 300]))}) "
                  "AND (id LIKE 'PGC %' OR id LIKE 'LEDA %')")
            d2 = tap_sync(SIMBAD_TAP, q2)
            for oid, s in zip(d2["oidref"], d2["id"]):
                m = re.fullmatch(r"(?:PGC|LEDA)\s+0*(\d+)", " ".join(str(s).split()))
                if m:
                    pgc_of.setdefault(int(oid), int(m.group(1)))
        for x in part:
            nx = " ".join(x.split())
            oid = hits.get(nx)
            known[x] = pgc_of.get(oid) if oid is not None else None
    for o in todo:
        for n in o["names"]:
            p = next((known.get(v) for v in simbad_variants(n) if known.get(v)), None)
            if p:
                o["pgc"], o["pgc_how"] = int(p), f"SIMBAD ident ({n})"
                break
    # 3) cone search for the rest
    for o in [o for o in objs if "pgc" not in o]:
        key = f"cone:{o['ra']:.5f},{o['dec']:.5f}"
        if key not in known:
            q = ("SELECT b.oid, DISTANCE(POINT('ICRS', b.ra, b.dec), POINT('ICRS', "
                 f"{o['ra']}, {o['dec']})) AS sep FROM basic AS b WHERE CONTAINS(POINT('ICRS', b.ra, b.dec), "
                 f"CIRCLE('ICRS', {o['ra']}, {o['dec']}, 0.025)) = 1 AND b.otype IN "
                 "('G', 'GiG', 'GiP', 'GiC', 'BiC', 'LSB', 'bCG', 'SBG', 'H2G', 'EmG', 'AGN', 'SyG', 'Sy1', 'Sy2', 'rG', 'LIN', 'IG', 'PaG') "
                 "ORDER BY sep")
            df = tap_sync(SIMBAD_TAP, q)
            pgc = None
            for oid in df["oid"].astype(int).tolist()[:3] if len(df) else []:
                d2 = tap_sync(SIMBAD_TAP, f"SELECT id FROM ident WHERE oidref = {oid} AND (id LIKE 'PGC %' OR id LIKE 'LEDA %')")
                if len(d2):
                    m = re.fullmatch(r"(?:PGC|LEDA)\s+0*(\d+)", " ".join(str(d2["id"].iat[0]).split()))
                    if m:
                        pgc = int(m.group(1))
                        break
            known[key] = pgc
        if known[key]:
            o["pgc"], o["pgc_how"] = int(known[key]), "SIMBAD cone 1.5 arcmin"
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(known, indent=0, sort_keys=True))


# ----------------------------------------------------------------------------- HyperLEDA live
LEDA_FIELDS = ["objname", "pgc", "logd25", "e_logd25", "logr25", "e_logr25", "pa", "incl", "t", "e_t", "type"]


def leda_url(sql: str) -> str:
    q = {"n": "meandata", "c": "o", "of": "1,leda,simbad", "nra": "l", "nakd": "1",
         "d": ",".join(LEDA_FIELDS), "sql": sql, "ob": "", "a": "csv[,]"}
    return LEDA + "?" + urllib.parse.urlencode(q)


def parse_leda_csv(text: str) -> pd.DataFrame:
    lines = [ln for ln in text.splitlines() if ln and not ln.startswith("#")]
    if not lines:
        return pd.DataFrame(columns=LEDA_FIELDS)
    return pd.read_csv(io.StringIO("\n".join(lines)), dtype=str, keep_default_na=False).apply(lambda c: c.str.strip())


def fetch_leda(pgcs: list[int], refresh: bool) -> tuple[pd.DataFrame, list[str]]:
    frames, urls = [], []
    pgcs = sorted(set(pgcs))
    for k in range(0, len(pgcs), 250):
        part = pgcs[k:k + 250]
        url = leda_url(f"pgc in ({','.join(map(str, part))})")
        cache = CACHE / f"leda_{k // 250:03d}.csv"
        if refresh or not cache.exists() or cache.stat().st_size == 0:
            txt = http("GET", url, timeout=300).text
            if "objname" not in txt:
                raise RuntimeError(f"HyperLEDA: unexpected answer {txt[:300]}")
            cache.write_text(txt)
        frames.append(parse_leda_csv(cache.read_text()))
        urls.append(url)
    df = pd.concat(frames, ignore_index=True)
    df["pgc"] = pd.to_numeric(df["pgc"], errors="coerce").astype("Int64")
    return df.drop_duplicates("pgc").set_index("pgc"), urls


# ----------------------------------------------------------------------------- VizieR VII/237
def precess_pa_b1950(ra2000: float, dec2000: float, pa1950: float) -> float:
    """PA measured in the B1950 (FK4) frame -> PA in ICRS/J2000 at the same object."""
    c = SkyCoord(ra2000 * u.deg, dec2000 * u.deg, frame="icrs")
    c4 = c.transform_to(FK4(equinox="B1950"))
    tip4 = c4.directional_offset_by(pa1950 * u.deg, 1 * u.arcmin)
    tip = SkyCoord(tip4.ra, tip4.dec, frame=FK4(equinox="B1950")).icrs
    return float(c.position_angle(tip).deg) % 180.0


def fetch_leda2003(pgcs: list[int], refresh: bool) -> tuple[pd.DataFrame, list[str]]:
    frames, urls = [], []
    pgcs = sorted(set(pgcs))
    for k in range(0, len(pgcs), 200):
        part = pgcs[k:k + 200]
        df, url = fetch_vizier("VII/237/pgc", CACHE / f"vii237_{k // 200:03d}.tsv",
                               ["PGC", "MType", "logD25", "logR25", "PA"],
                               extra={"PGC": ",".join(map(str, part))}, refresh=refresh)
        frames.append(df)
        urls.append(url)
    df = pd.concat(frames, ignore_index=True)
    df["PGC"] = pd.to_numeric(df["PGC"], errors="coerce").astype("Int64")
    return df.drop_duplicates("PGC").set_index("PGC"), urls


# ----------------------------------------------------------------------------- OpenNGC / UNGC / McC
def openngc_key(name: str) -> str | None:
    m = re.fullmatch(r"(NGC|IC)\s*0*(\d+)\s*([A-Z]?)", name.strip(), re.I)
    return f"{m.group(1).upper()}{int(m.group(2)):04d}{m.group(3).upper()}" if m else None


def load_openngc(refresh: bool) -> pd.DataFrame:
    p = download(OPENNGC + "NGC.csv", CACHE / "NGC.csv", refresh)
    df = pd.read_csv(p, sep=";", dtype=str, keep_default_na=False)
    return df.set_index("Name")


def load_ungc(refresh: bool) -> tuple[pd.DataFrame, str]:
    df, url = fetch_vizier("J/AJ/145/101/catalog", CACHE / "J_AJ_145_101_shapes.tsv",
                           ["Name", "a26", "b/a", "A26", "i", "TT", "Mcl", "Dist"], refresh=refresh)
    df = df[df["Name"] != ""].copy()
    df["Name"] = df["Name"].str.strip()
    return df.drop_duplicates("Name").set_index("Name"), url


def load_mcc(refresh: bool) -> pd.DataFrame:
    p = download(MCC_URL, CACHE / "NearbyGalaxies_Jan2021_PUBLIC.fits", refresh)
    t = Table.read(p, hdu=1)
    d = {"name": [str(n).strip() for n in t["GalaxyName"]]}
    for c in ["PA", "e=1-b/a", "rh"]:
        a = np.asarray(t[c], float)
        a[(a >= 99) | (a <= -99)] = np.nan
        d[c] = a
    df = pd.DataFrame(d)
    df["key"] = df["name"].str.lstrip("*")
    return df.set_index("key")


# ----------------------------------------------------------------------------- assemble
def incl_from_q(q: float) -> float:
    q = min(max(q, Q0), 1.0)
    return float(np.degrees(np.arccos(np.sqrt((q * q - Q0 * Q0) / (1 - Q0 * Q0)))))


SPHEROID_MCL = {"Sph", "dE", "dEem", "dS0em", "Tr"}


def assemble(objs, leda, l03, ngc, ungc, mcc) -> list[dict]:
    out = []
    for o in objs:
        pgc = o.get("pgc")
        L = leda.loc[pgc] if pgc is not None and pgc in leda.index else None
        P = l03.loc[pgc] if pgc is not None and pgc in l03.index else None
        N = next((ngc.loc[k] for n in o["names"] if (k := openngc_key(n)) and k in ngc.index), None)
        U = next((ungc.loc[n] for n in [e["name"] for e in o["entries"] if e["_cat"] == "local-volume.json"] if n in ungc.index), None)
        Mc = None
        for e in o["entries"]:
            if e["_cat"] == "local-group.json":
                for n in [e["name"], *(e.get("alt") or [])]:
                    k = n.lstrip("*").replace(" ", "")
                    if k in mcc.index:
                        Mc = mcc.loc[k]
                        break
        rec: dict = {"name": o["name"], "keys": o["names"], "ra": round(o["ra"], 5), "dec": round(o["dec"], 5)}
        if pgc is not None:
            rec["pgc"] = int(pgc)
        flags = []

        # ---- axes
        maj = mnr = None
        src = None
        if L is not None and f_or_none(L["logd25"]) is not None:
            maj = 0.1 * 10 ** float(L["logd25"])
            r = f_or_none(L["logr25"])
            mnr = maj / 10 ** r if r is not None else None
            src = "hyperleda"
        elif N is not None and f_or_none(N["MajAx"]) is not None:
            maj, mnr, src = float(N["MajAx"]), f_or_none(N["MinAx"]), "openngc"
        elif P is not None and f_or_none(P["logD25"]) is not None:
            maj = 0.1 * 10 ** float(P["logD25"])
            r = f_or_none(P["logR25"])
            mnr = maj / 10 ** r if r is not None else None
            src = "leda2003"
        elif U is not None and f_or_none(U["a26"]) is not None:
            maj = float(U["a26"])
            q = f_or_none(U["b/a"])
            mnr = maj * q if q is not None else None
            src = "ungc"
        elif Mc is not None and np.isfinite(Mc["rh"]):
            maj = 2.0 * float(Mc["rh"])
            mnr = maj * (1 - float(Mc["e=1-b/a"])) if np.isfinite(Mc["e=1-b/a"]) else None
            src = "mcc"
        if maj is None or not maj > 0:
            flags.append("no axes")
        else:
            rec["major_arcmin"] = round(maj, 3)
            rec["minor_arcmin"] = round(mnr, 3) if mnr else None
            if not mnr:
                flags.append("no axis ratio (minor = major assumed)")
            rec["axes_src"] = src
            rec["axes_def"] = AXES_DEF[src]

        # ---- position angle
        pa = None
        if L is not None and f_or_none(L["pa"]) is not None:
            pa, psrc = float(L["pa"]), "hyperleda"
        elif N is not None and f_or_none(N["PosAng"]) is not None:
            pa, psrc = float(N["PosAng"]), "openngc"
        elif P is not None and f_or_none(P["PA"]) is not None:
            pa, psrc = precess_pa_b1950(o["ra"], o["dec"], float(P["PA"])), "leda2003"
        elif Mc is not None and np.isfinite(Mc["PA"]):
            pa, psrc = float(Mc["PA"]), "mcc"
        if pa is not None:
            rec["pa_deg"] = round(pa % 180.0, 2)
            rec["pa_src"] = psrc
        else:
            flags.append("no position angle")

        # ---- morphology
        morph = tval = None
        msrc = None
        if L is not None and (L["type"] or f_or_none(L["t"]) is not None):
            morph, tval, msrc = L["type"] or None, f_or_none(L["t"], 1), "hyperleda"
        if morph is None and N is not None and N["Hubble"]:
            morph, msrc = N["Hubble"], "openngc"
        if U is not None:
            if tval is None and f_or_none(U["TT"]) is not None:
                tval = f_or_none(U["TT"], 1)
                msrc = msrc or "ungc"
            if morph is None and U["Mcl"]:
                morph, msrc = U["Mcl"], "ungc"
        if morph or tval is not None:
            rec["morph"] = morph
            rec["t"] = tval
            rec["morph_src"] = msrc
        mcl = U["Mcl"] if U is not None else ""
        spheroid = (tval is not None and tval <= -3.0) or mcl in SPHEROID_MCL or \
            (morph is not None and re.fullmatch(r"(?:E\d?|dE.*|dSph|Sph|cE|dS0.*)", morph) is not None)
        # McConnachie-only dwarfs without a morphology are dwarf spheroidals/irregulars; spheroid if
        # they have no HI-like disk indication (we only know the shape here)
        if src == "mcc" and morph is None:
            spheroid = True
        rec["shape"] = "spheroid" if spheroid else "disk"

        # ---- inclination (disks only)
        if not spheroid:
            if L is not None and f_or_none(L["incl"]) is not None:
                rec["incl_deg"], rec["incl_src"] = round(float(L["incl"]), 1), "hyperleda"
            elif U is not None and f_or_none(U["i"]) is not None:
                rec["incl_deg"], rec["incl_src"] = float(U["i"]), "ungc"
            elif rec.get("minor_arcmin") and rec.get("major_arcmin"):
                rec["incl_deg"], rec["incl_src"] = round(incl_from_q(rec["minor_arcmin"] / rec["major_arcmin"]), 1), "derived"
            else:
                flags.append("no inclination")
        # apparent magnitude for the renderer's photometry (some entries, e.g. M31 in local-group, have none)
        for e in o["entries"]:  # entries are sorted messier-ngc (V) > local-volume (B) > local-group (V)
            if e.get("mag") is not None:
                rec["mag"], rec["mag_band"] = e["mag"], e.get("mag_band") or "V"
                rec["mag_src"] = e["_cat"].removesuffix(".json")
                break
        if o["spread_arcmin"] > 3:
            flags.append(f"catalogue positions differ by {o['spread_arcmin']:.1f} arcmin")
        # docs/content-contract.md section 3: kind, docs slug, unit-suffixed facts with a per-key citation
        prim = o["entries"][0]
        rec["kind"] = "lg_galaxy" if any(e["kind"] == "lg_galaxy" for e in o["entries"]) else "galaxy"
        rec["docs"] = "local-group" if rec["kind"] == "lg_galaxy" else "galaxy"
        facts, fref = {}, {}
        dist = prim.get("dist_pc")
        if rec.get("major_arcmin") and dist and np.isfinite(dist) and dist > 0:
            kpc = np.radians(1 / 60) * dist / 1e3
            facts["major_kpc"] = round(rec["major_arcmin"] * kpc, 2)
            fref["major_kpc"] = f"{SHORT[rec['axes_src']]} {rec['axes_def']} at {dist / 1e6:.3g} Mpc ({prim['ref']})"
            if rec.get("minor_arcmin"):
                facts["minor_kpc"] = round(rec["minor_arcmin"] * kpc, 2)
                fref["minor_kpc"] = fref["major_kpc"]
        if rec.get("incl_deg") is not None:
            facts["inclination_deg"] = rec["incl_deg"]
            fref["inclination_deg"] = SHORT[rec["incl_src"]]
        if rec.get("pa_deg") is not None:
            facts["position_angle_deg"] = rec["pa_deg"]
            fref["position_angle_deg"] = SHORT[rec["pa_src"]]
        if rec.get("morph"):
            facts["type"] = rec["morph"]
            fref["type"] = SHORT[rec["morph_src"]]
        if facts:
            rec["facts"], rec["facts_ref"] = facts, fref
        rec["cats"] = o["cats"]
        if flags:
            rec["flags"] = flags
        out.append(rec)
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--refresh", action="store_true", help="re-download every cached source")
    ap.add_argument("--check", nargs="*", help="compare these names with SIMBAD and NED, write nothing")
    a = ap.parse_args()
    if a.check is not None:
        check(a.check or ["M31", "M33", "M81", "M101", "NGC 253", "LMC"])
        return
    started = utcnow()
    CACHE.mkdir(parents=True, exist_ok=True)
    objs = load_objects()
    print(f"{len(objs)} galaxies after merging the three catalogues", flush=True)
    resolve_pgc(objs, a.refresh)
    pgcs = [o["pgc"] for o in objs if "pgc" in o]
    print(f"PGC numbers: {len(pgcs)} / {len(objs)}", flush=True)
    leda, leda_urls = fetch_leda(pgcs, a.refresh)
    l03, l03_urls = fetch_leda2003(pgcs, a.refresh)
    ngc = load_openngc(a.refresh)
    ungc, ungc_url = load_ungc(a.refresh)
    mcc = load_mcc(a.refresh)
    recs = assemble(objs, leda, l03, ngc, ungc, mcc)
    recs.sort(key=lambda r: -(r.get("major_arcmin") or 0))
    stats = {
        "galaxies": len(recs),
        "with_pgc": sum("pgc" in r for r in recs),
        "with_axes": sum("major_arcmin" in r for r in recs),
        "with_pa": sum("pa_deg" in r for r in recs),
        "with_incl": sum("incl_deg" in r for r in recs),
        "spheroids": sum(r["shape"] == "spheroid" for r in recs),
        "axes_src": pd.Series([r.get("axes_src", "none") for r in recs]).value_counts().to_dict(),
        "pa_src": pd.Series([r.get("pa_src", "none") for r in recs]).value_counts().to_dict(),
        "incl_src": pd.Series([r.get("incl_src", "none") for r in recs]).value_counts().to_dict(),
    }
    doc = {
        "version": 1,
        "generated_utc": started,
        "script": "scripts/build_galaxy_shapes.py",
        "conventions": {
            "major_arcmin": "apparent major-axis diameter, arcmin (definition in axes_def: D25 = 25 B-mag/arcsec^2 "
                            "isophote; a26 (Holmberg) is ~1.3x D25; 2 r_h = half-light diameter)",
            "minor_arcmin": "apparent minor-axis diameter, same isophote (null: unknown)",
            "pa_deg": "position angle of the major axis, degrees North through East, J2000, 0..180",
            "incl_deg": "inclination of the disk, 0 = face-on (disks only); the near side is not known",
            "shape": "disk (thin oriented disk) or spheroid (E/dE/dSph: drawn as a camera-facing ellipse)",
            "t": "de Vaucouleurs numerical type T", "morph": "morphological type string",
            "mag": "apparent magnitude copied from the first catalogue entry that has one (mag_band, mag_src)",
            "kind/docs/facts/facts_ref": "docs/content-contract.md section 3 (facts: major_kpc/minor_kpc at the "
                                         "primary entry's catalogue distance, inclination_deg, position_angle_deg, type)",
            "keys": "every name/alias of the merged catalogue entries (viewer looks shapes up by catalogKey)",
            "*_src": "key into sources",
        },
        "sources": SOURCES,
        "provenance": "data/tiles/catalogs/provenance/galaxy-shapes.json",
        "galaxies": recs,
    }
    OUT.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")))
    # content contract section 3: provenance block next to the catalogue
    prov = {
        "catalog": str(OUT.relative_to(ROOT)), "bytes": OUT.stat().st_size, "started_utc": started, "finished_utc": utcnow(),
        "script": "scripts/build_galaxy_shapes.py",
        "inputs": [f"data/tiles/catalogs/{f}" for f in INPUTS],
        "service": {"hyperleda": leda_urls, "vizier_vii237": l03_urls, "vizier_ungc": ungc_url, "openngc": OPENNGC + "NGC.csv",
                    "mcconnachie": MCC_URL, "simbad_tap": SIMBAD_TAP},
        "pgc_matching": "alias 'PGC n' > SIMBAD identifier lookup of every name > SIMBAD 1.5 arcmin cone (galaxy otypes)",
        "priority": {"axes": "hyperleda > openngc > leda2003 > ungc > mcc", "pa": "hyperleda > openngc > leda2003 > mcc",
                     "inclination": "hyperleda > ungc > derived (q0 = 0.2), disks only", "morphology": "hyperleda > openngc > ungc"},
        "facts_keys": "major_kpc, minor_kpc (D25 at the primary entry's catalogue distance), inclination_deg, position_angle_deg, type",
        "cache": "data/cache/galaxy-shapes/ (gitignored)",
        "stats": stats,
        "citations": list(SOURCES.values()),
    }
    PROV.parent.mkdir(parents=True, exist_ok=True)
    PROV.write_text(json.dumps(prov, indent=2, ensure_ascii=False))
    print(json.dumps(stats, indent=1))
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.0f} KiB) and {PROV.relative_to(ROOT)}")


# ----------------------------------------------------------------------------- spot check
def check(names: list[str]) -> None:
    from astroquery.ipac.ned import Ned

    doc = json.loads(OUT.read_text())
    idx = {catalog_key(k): r for r in doc["galaxies"] for k in r["keys"]}
    print("| galaxy | ours: major x minor (arcmin), PA, incl [src] | SIMBAD galdim (bibcode) | NED RC3 D25 x b/a, PA |")
    print("|---|---|---|---|")
    for n in names:
        r = idx.get(catalog_key(n))
        if not r:
            print(f"| {n} | not in galaxy-shapes.json | | |")
            continue
        ours = (f"{r.get('major_arcmin', float('nan')):.1f} x {r.get('minor_arcmin') or float('nan'):.1f}, "
                f"PA {r.get('pa_deg', 'n/a')}, i {r.get('incl_deg', 'n/a')} "
                f"[{r.get('axes_src')}/{r.get('pa_src')}/{r.get('incl_src', '-')}]")
        sb = tap_sync(SIMBAD_TAP, "SELECT b.galdim_majaxis, b.galdim_minaxis, b.galdim_angle, b.galdim_bibcode "
                                  f"FROM ident AS i JOIN basic AS b ON i.oidref = b.oid WHERE i.id = {sq(simbad_variants(n)[-1] if not re.search(r'[0-9]', n) else n)}")
        s = (f"{sb['galdim_majaxis'].iat[0]:.1f} x {sb['galdim_minaxis'].iat[0]:.1f}, PA {sb['galdim_angle'].iat[0]} "
             f"({sb['galdim_bibcode'].iat[0]})") if len(sb) else "n/a"
        try:
            t = Ned.get_table(n if re.search(r"\d", n) else {"LMC": "Large Magellanic Cloud"}.get(n, n), table="diameters")
            rc3 = [row for row in t if str(row["Frequency targeted"]).startswith("RC3 D_25, R_25")]
            if rc3:
                row = rc3[0]
                d = 0.1 * 10 ** float(row["Major Axis"])
                rr = row["Axis Ratio"]
                ba = 10 ** -float(rr) if rr is not np.ma.masked else float("nan")
                pa = row["Position Angle"]
                ned = f"{d:.1f}' x b/a {ba:.2f} (minor {d * ba:.1f}'), PA {pa if pa is not np.ma.masked else 'n/a'}"
            else:
                ned = "no RC3 D25 row"
        except Exception as exc:  # noqa: BLE001 - report, do not hide
            ned = f"NED error: {exc}"
        print(f"| {n} | {ours} | {s} | {ned} |")


if __name__ == "__main__":
    main()
