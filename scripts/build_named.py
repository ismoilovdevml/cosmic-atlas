#!/usr/bin/env python
"""Named-object catalogues for labels and search (docs/data-contract.md section 4).

  named-stars.json : IAU WGSN Catalog of Star Names (the "always up to date" table on the WGSN
                     site exopla.net/star-names/modern-iau-star-names/), resolved via SIMBAD
                     (Harvard mirror) to HIP / HD / HR / Bayer / Gaia DR3 ids; distance from the
                     Gaia DR3 or Hipparcos-2007 parallax (rule below), Bailer-Jones geometric
                     distance when the parallax is poor; mag = V (SIMBAD) else catalogue mag.
  messier-ngc.json : all Messier objects + NGC/IC objects with V <= 10 or B <= 10.5
                     from OpenNGC; distances: galaxies McConnachie / UNGC / Cosmicflows-4 /
                     Planck18(z>=0.003) / SIMBAD; globular clusters Baumgardt & Vasiliev 2021;
                     others SIMBAD parallax / SIMBAD mesDistance.

Requires data/raw/{local-group,local-volume,galaxies-cf4} from fetch_local_universe.py.
Usage: .venv/bin/python scripts/build_named.py [--refresh]
"""
from __future__ import annotations

import argparse
import html as htmllib
import json
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from catio import (GAIA_TAP, ROOT, SIMBAD_TAP, download, fetch_vizier, http, num, tap_sync,  # noqa: E402
                   utcnow, write_catalog_json)
from coords import comoving_pc, galactic_xyz, xyz_list  # noqa: E402
from fetch_local_universe import match_sky  # noqa: E402

RAW = ROOT / "data" / "raw"
CATS = ROOT / "data" / "tiles" / "catalogs"
WGSN_URL = "https://exopla.net/star-names/modern-iau-star-names/"
CSN_TXT_URL = "https://www.pas.rochester.edu/~emamajek/WGSN/IAU-CSN.txt"
OPENNGC_TAG = "v20260501"
OPENNGC = f"https://raw.githubusercontent.com/mattiaverga/OpenNGC/{OPENNGC_TAG}/database_files/"
BV21_URL = "https://people.smp.uq.edu.au/HolgerBaumgardt/globular/orbits_table.txt"
HR23_SRC = "J/A+A/673/A114/clusters"

CIT = {
    "wgsn": {"ref": "IAU Working Group on Star Names, IAU Catalog of Star Names (WGSN site, accessed "
                    "2026-11-13); Mamajek et al. 2022 WGSN reports", "url": WGSN_URL},
    "simbad": {"ref": "Wenger et al. 2000, A&AS 143, 9 (SIMBAD)", "doi": "10.1051/aas:2000332"},
    "gaia": {"ref": "Gaia Collaboration, Vallenari et al. 2023, A&A 674, A1 (Gaia DR3)", "doi": "10.1051/0004-6361/202243940"},
    "bj": {"ref": "Bailer-Jones et al. 2021, AJ 161, 147 (EDR3 distances)", "doi": "10.3847/1538-3881/abd806"},
    "hip": {"ref": "van Leeuwen 2007, A&A 474, 653 (Hipparcos new reduction)", "doi": "10.1051/0004-6361:20078357"},
    "openngc": {"ref": f"Verga, OpenNGC {OPENNGC_TAG} (CC-BY-SA-4.0)", "url": "https://github.com/mattiaverga/OpenNGC"},
    "bv21": {"ref": "Baumgardt & Vasiliev 2021, MNRAS 505, 5957 (GC distances; orbits_table.txt)",
             "doi": "10.1093/mnras/stab1474", "url": BV21_URL},
    "hr23": {"ref": "Hunt & Reffert 2023, A&A 673, A114 (Gaia DR3 star clusters; VizieR J/A+A/673/A114)",
             "doi": "10.1051/0004-6361/202346285"},
    "cf4": {"ref": "Tully et al. 2023, ApJ 944, 94 (Cosmicflows-4)", "doi": "10.3847/1538-4357/ac94d8"},
    "ungc": {"ref": "Karachentsev et al. 2013, AJ 145, 101 (UNGC)", "doi": "10.1088/0004-6256/145/4/101"},
    "mcc": {"ref": "McConnachie 2012, AJ 144, 4 (Jan 2021 update)", "doi": "10.1088/0004-6256/144/1/4"},
    "p18": {"ref": "Planck Collaboration 2020, A&A 641, A6", "doi": "10.1051/0004-6361/201833910"},
}

GREEK = {"α": "alf", "β": "bet", "γ": "gam", "δ": "del", "ε": "eps", "ζ": "zet", "η": "eta", "θ": "tet",
         "ι": "iot", "κ": "kap", "λ": "lam", "μ": "mu.", "ν": "nu.", "ξ": "ksi", "ο": "omi", "π": "pi.",
         "ρ": "rho", "σ": "sig", "τ": "tau", "υ": "ups", "φ": "phi", "χ": "chi", "ψ": "psi", "ω": "ome"}


def sv(x):
    """Non-empty string or None (pandas may turn None into NaN)."""
    return x if isinstance(x, str) and x else None


def sq(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def norm_id(s) -> str:
    return " ".join(str(s).split()) if isinstance(s, str) else ""


# ----------------------------------------------------------------------------- SIMBAD
def simbad_resolve(idents: list[str], chunk: int = 250) -> pd.DataFrame:
    """ident -> oid, main_id, ra, dec, plx, V, otype, redshift (one row per matched ident)."""
    out = []
    uniq = sorted({i for i in idents if i})
    for k in range(0, len(uniq), chunk):
        part = uniq[k:k + chunk]
        q = f"""SELECT i.id AS ident, b.oid, b.main_id, b.ra, b.dec, b.plx_value, b.plx_err, b.plx_bibcode,
 b.otype, b.rvz_redshift, b.rvz_type, f.V
 FROM ident AS i JOIN basic AS b ON i.oidref = b.oid LEFT JOIN allfluxes AS f ON f.oidref = b.oid
 WHERE i.id IN ({",".join(sq(x) for x in part)})"""
        out.append(tap_sync(SIMBAD_TAP, q))
    df = pd.concat(out, ignore_index=True) if out else pd.DataFrame()
    if len(df):
        df["ident"] = df["ident"].map(norm_id)
        df["main_id"] = df["main_id"].map(norm_id)
        df = df.drop_duplicates("ident")
    return df


def simbad_ids(oids: list[int], chunk: int = 300) -> dict[int, list[str]]:
    res = {}
    oids = sorted({int(o) for o in oids})
    for k in range(0, len(oids), chunk):
        part = oids[k:k + chunk]
        q = f"SELECT oidref, ids FROM ids WHERE oidref IN ({','.join(map(str, part))})"
        df = tap_sync(SIMBAD_TAP, q)
        for o, s in zip(df["oidref"], df["ids"]):
            res[int(o)] = [norm_id(x) for x in str(s).split("|")]
    return res


def simbad_mesdist(oids: list[int], chunk: int = 300) -> pd.DataFrame:
    out = []
    oids = sorted({int(o) for o in oids})
    for k in range(0, len(oids), chunk):
        part = oids[k:k + chunk]
        q = ("SELECT oidref, dist, unit, minus_err, plus_err, method, bibcode FROM mesDistance "
             f"WHERE oidref IN ({','.join(map(str, part))})")
        out.append(tap_sync(SIMBAD_TAP, q))
    df = pd.concat(out, ignore_index=True)
    scale = {"pc": 1.0, "kpc": 1e3, "Mpc": 1e6}
    df["unit"] = df["unit"].astype(str).str.strip()
    df["dist_pc"] = (pd.to_numeric(df["dist"], errors="coerce") * df["unit"].map(scale)).astype(float)
    df["method"] = df["method"].fillna("").astype(str).str.strip()
    df["year"] = pd.to_numeric(df["bibcode"].astype(str).str[:4], errors="coerce")
    return df[np.isfinite(df["dist_pc"])]


def pick_mesdist(rows: pd.DataFrame) -> tuple[float, str] | None:
    """Median of parallax-based entries if any, else of entries since 2010, else of all."""
    if rows is None or len(rows) == 0:
        return None
    plx = rows[rows["method"].str.lower().str.startswith(("plx", "paral"))]
    sub = plx if len(plx) else (rows[rows["year"] >= 2010] if (rows["year"] >= 2010).any() else rows)
    tag = "plx entries" if len(plx) else ("entries since 2010" if (rows["year"] >= 2010).any() else "all entries")
    d = float(np.median(sub["dist_pc"]))
    return d, f"SIMBAD mesDistance median of {len(sub)} {tag} ({', '.join(sorted(set(sub['bibcode'].astype(str)))[:4])})"


def pick_ids(ids: list[str]) -> dict:
    d = {}
    for s in ids:
        for key, pat in [("gaia_dr3", r"^Gaia DR3 (\d+)$"), ("hip", r"^HIP (\d+)$"), ("hd", r"^HD (\d+)$"),
                         ("hr", r"^HR (\d+)$"), ("pgc", r"^(?:PGC|LEDA) (\d+)$"), ("bayer", r"^\* ([a-z]{2,3}\.?\d{0,2} [A-Z][a-z]{2}.*)$"),
                         ("flamsteed", r"^\* (\d+ [A-Z][a-z]{2}.*)$"), ("name", r"^NAME (.+)$"),
                         ("messier", r"^M (\d+)$"), ("ngc", r"^NGC (\d+[A-Z]?)$"), ("ic", r"^IC (\d+[A-Z]?)$")]:
            m = re.match(pat, s)
            if m and key not in d:
                d[key] = m.group(1)
    return d


# ----------------------------------------------------------------------------- WGSN table
def parse_wgsn(html_text: str) -> pd.DataFrame:
    ths = [htmllib.unescape(re.sub("<[^>]+>", "", t)).strip()
           for t in re.findall(r"<th[^>]*>(.*?)</th>", html_text, re.S)]
    rows = re.findall(r'<tr id="table_2_row_\d+"[^>]*>(.*?)</tr>', html_text, re.S)
    data = []
    for r in rows:
        cells = [htmllib.unescape(re.sub("<[^>]+>", "", c)).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", r, re.S)]
        data.append(cells)
    ncol = max(len(c) for c in data)
    cols = ths[:ncol]
    df = pd.DataFrame([c + [""] * (ncol - len(c)) for c in data], columns=cols)
    return df


def build_named_stars(refresh: bool) -> dict:
    out = RAW / "named-stars"
    src = out / "source"
    page = download(WGSN_URL, src / "wgsn_modern_iau_star_names.html", refresh)
    download(CSN_TXT_URL, src / "IAU-CSN_2022.txt", refresh)
    w = parse_wgsn(page.read_text(encoding="utf-8"))
    expected = ["proper names", "NEC+", "Designation", "HIP", "Bayer ID", "Simbad spelling", "Constellation",
                "Origin", "Language", "Reference", "Date of Adoption", "image", "image_source", "RA", "DEC", "mag", "band"]
    assert list(w.columns[:len(expected)]) == expected, w.columns.tolist()
    w = w.rename(columns={"proper names": "name", "Designation": "desig", "HIP": "hip", "Bayer ID": "bayer",
                          "Simbad spelling": "simbad_spelling", "Constellation": "con", "Date of Adoption": "adopted",
                          "RA": "ra_wgsn", "DEC": "dec_wgsn", "mag": "mag_wgsn", "band": "band_wgsn"})
    n_rows = len(w)
    w = w[w["name"] != ""].drop_duplicates("name").reset_index(drop=True)

    # SIMBAD identifiers to try, in priority order
    def candidates(r) -> list[str]:
        c = []
        hip = re.sub(r"\s+", "", r.hip)
        if re.fullmatch(r"\d+", hip):
            c.append(f"HIP {hip}")
        elif re.fullmatch(r"\d+[A-C]", hip):
            c.append(f"HIP {hip[:-1]}{' ' + hip[-1]}")
        if r.desig and r.desig != "-":
            c.append(norm_id(r.desig.replace(" Parent Star", "")))
        m = re.fullmatch(r"([\u03b1-\u03c9])\s+([A-Z][a-z]{2})\s*([A-Z]?)", r.bayer.strip())
        if m and m.group(1) in GREEK:  # 'α Ori B' -> '* alf Ori B'
            c.append(f"* {GREEK[m.group(1)]} {m.group(2)}" + (f" {m.group(3)}" if m.group(3) else ""))
        if r.simbad_spelling:
            c.append("NAME " + r.simbad_spelling)
        c.append("NAME " + r.name)
        if m and m.group(1) in GREEK and m.group(3):  # last resort: primary of a component not in SIMBAD
            c.append(f"PRIMARY:* {GREEK[m.group(1)]} {m.group(2)}")
        return c

    cand = [candidates(r) for r in w.itertuples()]
    sim = simbad_resolve([c.removeprefix("PRIMARY:") for cs in cand for c in cs]).set_index("ident")
    picked, via_primary = [], []
    for cs in cand:
        hit = next((c for c in cs if c.removeprefix("PRIMARY:") in sim.index), None)
        via_primary.append(bool(hit and hit.startswith("PRIMARY:")))
        picked.append(hit.removeprefix("PRIMARY:") if hit else None)
    w["simbad_ident"] = picked
    w["via_primary"] = via_primary
    found = w["simbad_ident"].notna()
    s = sim.loc[w.loc[found, "simbad_ident"]].reset_index()
    for col in ["oid", "main_id", "ra", "dec", "plx_value", "plx_err", "plx_bibcode", "otype", "V"]:
        w.loc[found, "sb_" + col] = s[col].to_numpy()
    ids = simbad_ids(w.loc[found, "sb_oid"].astype(int).tolist())
    idd = [pick_ids(ids.get(int(o), [])) if pd.notna(o) else {} for o in w.get("sb_oid", pd.Series([np.nan] * len(w)))]
    w["gaia_dr3"] = [d.get("gaia_dr3") for d in idd]
    w["hip_id"] = [d.get("hip") for d in idd]
    w["hd"] = [d.get("hd") for d in idd]
    w["hr"] = [d.get("hr") for d in idd]
    w["bayer_sb"] = [d.get("bayer") or d.get("flamsteed") for d in idd]

    # Gaia DR3 astrometry + Bailer-Jones distances
    gids = sorted({int(g) for g in w["gaia_dr3"].dropna()})
    gq = f"""SELECT g.source_id, g.parallax, g.parallax_error, g.phot_g_mean_mag, g.bp_rp, g.ruwe,
 d.r_med_geo, d.r_lo_geo, d.r_hi_geo
 FROM gaiadr3.gaia_source AS g LEFT JOIN external.gaiaedr3_distance AS d ON d.source_id = g.source_id
 WHERE g.source_id IN ({",".join(map(str, gids))})"""
    gaia = tap_sync(GAIA_TAP, gq).set_index("source_id")
    # Hipparcos 2007 (van Leeuwen) parallaxes
    hip2, hip_url = fetch_vizier("I/311/hip2", src / "I_311_hip2.tsv", ["HIP", "Plx", "e_Plx", "Hpmag", "B-V"],
                                 refresh=refresh)
    hip2 = pd.DataFrame({"HIP": hip2["HIP"].astype(int), "plx": num(hip2["Plx"]), "e_plx": num(hip2["e_Plx"]),
                         "bv": num(hip2["B-V"])}).set_index("HIP")

    mes = simbad_mesdist(w.loc[found, "sb_oid"].astype(int).tolist())
    mes_by = {k: g for k, g in mes.groupby("oidref")}
    rec = []
    for r in w.itertuples():
        gid, hid = sv(r.gaia_dr3), sv(r.hip_id)
        g = gaia.loc[int(gid)] if gid and int(gid) in gaia.index else None
        h = hip2.loc[int(hid)] if hid and int(hid) in hip2.index else None
        gp = (float(g.parallax), float(g.parallax_error)) if g is not None and np.isfinite(g.parallax) and g.parallax > 0 else None
        hp = (float(h.plx), float(h.e_plx)) if h is not None and np.isfinite(h.plx) and h.plx > 0 else None
        gmag = float(g.phot_g_mean_mag) if g is not None and np.isfinite(g.phot_g_mean_mag) else np.nan
        ruwe = float(g.ruwe) if g is not None and np.isfinite(g.ruwe) else np.nan
        # Rule: Gaia DR3 unless (G < 4 mag, i.e. saturated regime, or RUWE > 1.4, or no Gaia parallax)
        # and Hipparcos exists; if both exist and Hipparcos has the smaller fractional error, use it.
        choice = None
        if gp and not (gmag < 4 or ruwe > 1.4):
            choice = ("gaia_dr3_plx", gp)
            if hp and hp[1] / hp[0] < gp[1] / gp[0]:
                choice = ("hip2007_plx", hp)
        elif hp:
            choice = ("hip2007_plx", hp)
        elif gp:
            choice = ("gaia_dr3_plx", gp)
        dist = lo = hi = np.nan
        method = ""
        if choice:
            p, e = choice[1]
            dist, lo = 1000.0 / p, 1000.0 / (p + e)
            hi = 1000.0 / (p - e) if p > e else np.nan
            method = choice[0]
            if e / p > 0.2 and g is not None and np.isfinite(g.r_med_geo):
                dist, lo, hi, method = float(g.r_med_geo), float(g.r_lo_geo), float(g.r_hi_geo), "bailer_jones_2021_geo"
        elif pd.notna(getattr(r, "sb_plx_value", np.nan)) and r.sb_plx_value > 0:
            p, e = float(r.sb_plx_value), float(r.sb_plx_err) if pd.notna(r.sb_plx_err) else np.nan
            dist, lo = 1000.0 / p, 1000.0 / (p + e) if np.isfinite(e) else np.nan
            hi = 1000.0 / (p - e) if np.isfinite(e) and p > e else np.nan
            method = f"simbad_plx ({r.sb_plx_bibcode})"
        if not np.isfinite(dist) and pd.notna(getattr(r, "sb_oid", np.nan)) and int(r.sb_oid) in mes_by:
            pk = pick_mesdist(mes_by[int(r.sb_oid)])
            if pk:
                dist, method = pk[0], "simbad_mesdistance " + pk[1]
        ra = float(r.sb_ra) if pd.notna(getattr(r, "sb_ra", np.nan)) else pd.to_numeric(r.ra_wgsn, errors="coerce")
        dec = float(r.sb_dec) if pd.notna(getattr(r, "sb_dec", np.nan)) else pd.to_numeric(r.dec_wgsn, errors="coerce")
        vmag = float(r.sb_V) if pd.notna(getattr(r, "sb_V", np.nan)) and not r.via_primary else np.nan
        mag_band = "V"
        if not np.isfinite(vmag):
            vmag = pd.to_numeric(r.mag_wgsn, errors="coerce")
            mag_band = r.band_wgsn or "unknown"
        if not np.isfinite(vmag) and np.isfinite(gmag):
            vmag, mag_band = gmag, "G"
        rec.append({"name": r.name, "ra": ra, "dec": dec, "dist_pc": dist, "dist_lo_pc": lo, "dist_hi_pc": hi,
                    "dist_method": method, "mag": vmag, "mag_band": mag_band if np.isfinite(vmag) else "",
                    "color": float(g.bp_rp) if g is not None and np.isfinite(g.bp_rp) else np.nan,
                    "gaia_dr3": gid, "hip": hid, "hd": sv(r.hd), "hr": sv(r.hr), "bayer": sv(r.bayer_sb),
                    "bayer_wgsn": sv(r.bayer), "desig": sv(r.desig), "con": sv(r.con), "adopted": sv(r.adopted),
                    "simbad_main_id": sv(getattr(r, "sb_main_id", None)), "simbad_ident": sv(r.simbad_ident),
                    "otype": sv(getattr(r, "sb_otype", None)), "gaia_g": gmag, "ruwe": ruwe,
                    "via_primary": bool(r.via_primary)})
    df = pd.DataFrame(rec)
    entries = []
    from types import SimpleNamespace
    for r0 in rec:
        r = SimpleNamespace(**r0)
        alt = []
        if r.bayer:
            alt.append(r.bayer)
        if r.bayer_wgsn:
            alt.append(r.bayer_wgsn if len(r.bayer_wgsn.split()) > 1 or not r.con else f"{r.bayer_wgsn} {r.con}")
        for pre, v in [("HIP", r.hip), ("HD", r.hd), ("HR", r.hr), ("Gaia DR3", r.gaia_dr3)]:
            if v:
                alt.append(f"{pre} {v}")
        if r.desig and r.desig != "-" and r.desig not in alt and not r.desig.startswith(("HR ", "HIP ")):
            alt.append(r.desig)
        if r.simbad_main_id and r.simbad_main_id.lstrip("* ").strip() not in alt and not r.simbad_main_id.startswith("NAME"):
            alt.append(r.simbad_main_id.lstrip("* ").strip())
        entries.append({"name": r.name, "alt": list(dict.fromkeys(alt)), "kind": "star",
                        "ra": round(float(r.ra), 6) if np.isfinite(r.ra) else None,
                        "dec": round(float(r.dec), 6) if np.isfinite(r.dec) else None,
                        "dist_pc": round(float(r.dist_pc), 4) if np.isfinite(r.dist_pc) else None,
                        "mag": round(float(r.mag), 2) if np.isfinite(r.mag) else None,
                        "xyz": xyz_list(r.ra, r.dec, r.dist_pc) if np.isfinite(r.ra) else None,
                        "ref": "IAU WGSN / SIMBAD / " + {"gaia_dr3_plx": "Gaia DR3", "hip2007_plx": "Hipparcos 2007",
                                                          "bailer_jones_2021_geo": "Bailer-Jones 2021"}.get(
                            r.dist_method, ("SIMBAD mesDistance" if r.dist_method.startswith("simbad_mes") else
                                            "SIMBAD plx") if r.dist_method else "no distance"),
                        "mag_band": r.mag_band, "dist_method": r.dist_method, "con": r.con,
                        **({"flag": "component not in SIMBAD: position/distance of the primary"} if r.via_primary else {})})
    size = write_catalog_json(CATS / "named-stars.json", entries)
    pq_df = df.assign(id=["Gaia DR3 " + g if g else ("HIP " + h if h else "WGSN " + n)
                          for g, h, n in zip(df["gaia_dr3"].fillna(""), df["hip"].fillna(""), df["name"])],
                      kind="star")
    xyz = galactic_xyz(pq_df["ra"].to_numpy(float), pq_df["dec"].to_numpy(float), pq_df["dist_pc"].to_numpy(float))
    pq_df["x_pc"], pq_df["y_pc"], pq_df["z_pc"] = xyz[:, 0], xyz[:, 1], xyz[:, 2]
    stats = {"wgsn_rows": n_rows, "unique_names": int(len(w)), "simbad_resolved": int(found.sum()),
             "unresolved": w.loc[~found, "name"].tolist(),
             "with_gaia_dr3_id": int(df["gaia_dr3"].notna().sum()),
             "dist_method_counts": {k: int(v) for k, v in df["dist_method"].str.split(" ").str[0].value_counts().items()},
             "no_distance": df.loc[~np.isfinite(df["dist_pc"]), "name"].tolist(),
             "simbad_ident_used": {k: int(v) for k, v in df["simbad_ident"].fillna("none").str.split(" ").str[0].value_counts().items()}}
    prov = {"service": {"wgsn": WGSN_URL, "simbad_tap": SIMBAD_TAP, "gaia_tap": GAIA_TAP, "hipparcos": hip_url},
            "cross_check_source": CSN_TXT_URL + " (IAU-CSN text, last updated 2022-04-04; older than the web table)",
            "queries": {"simbad": "ident IN (...) JOIN basic, allfluxes; ids; per batch of 250", "gaia": gq[:400] + " ..."},
            "selection": "every named row of the WGSN 'IAU-Catalog of Star Names (always up to date)' table; "
                         "SIMBAD identifier tried in order HIP n, Designation, 'NAME <Simbad spelling>', 'NAME <name>'",
            "distance_rule": "Gaia DR3 parallax unless G<4 or RUWE>1.4 or no Gaia parallax -> Hipparcos 2007 "
                             "(also used when its fractional error is smaller); if sigma_plx/plx > 0.2 and a "
                             "Bailer-Jones (2021) geometric distance exists, that is used; else SIMBAD best parallax. "
                             "dist = 1000/plx, lo/hi = 1000/(plx +- err).",
            "mag": "SIMBAD V; else WGSN catalogue mag (band in mag_band); else Gaia G",
            "color": "Gaia DR3 BP-RP or NaN",
            "stats": stats, "catalog_json": "data/tiles/catalogs/named-stars.json", "catalog_json_bytes": size,
            "citations": [CIT["wgsn"], CIT["simbad"], CIT["gaia"], CIT["bj"], CIT["hip"]]}
    return {"df": pq_df, "prov": prov}


def cluster_key(name: str) -> str:
    n = re.sub(r"^Cl ", "", name.replace("_", " ").strip()).lower().replace(" ", "")
    for a, b in (("melotte", "mel"), ("collinder", "cr"), ("trumpler", "tr")):
        n = n.replace(a, b)
    return n


def simbad_parents(oids: list[int], levels: int = 2) -> dict[int, list[int]]:
    """child oid -> ancestor oids (SIMBAD h_link), nearest first, up to `levels` levels."""
    anc = {o: [] for o in oids}
    frontier = {o: [o] for o in oids}
    for _ in range(levels):
        cur = sorted({x for v in frontier.values() for x in v})
        if not cur:
            break
        df = pd.concat([tap_sync(SIMBAD_TAP, "SELECT child, parent FROM h_link WHERE child IN (" +
                                 ",".join(map(str, cur[k:k + 300])) + ")") for k in range(0, len(cur), 300)])
        kids = {}
        for c, p_ in zip(df["child"], df["parent"]):
            kids.setdefault(int(c), []).append(int(p_))
        nxt = {}
        for o, fr in frontier.items():
            new = [p_ for f in fr for p_ in dict.fromkeys(kids.get(f, [])) if p_ not in anc[o] and p_ != o]
            anc[o] += new
            nxt[o] = new
        frontier = nxt
    return anc


def simbad_basic(oids: list[int]) -> pd.DataFrame:
    oids = sorted(set(oids))
    if not oids:
        return pd.DataFrame(columns=["oid", "main_id", "ra", "dec", "otype", "plx_value", "plx_err", "plx_bibcode"])
    return pd.concat([tap_sync(SIMBAD_TAP, "SELECT oid, main_id, ra, dec, otype, plx_value, plx_err, plx_bibcode "
                               "FROM basic WHERE oid IN (" + ",".join(map(str, oids[k:k + 300])) + ")")
                      for k in range(0, len(oids), 300)]).set_index("oid")


# ----------------------------------------------------------------------------- Messier / NGC
KIND = {"G": "galaxy", "GPair": "galaxy", "GTrpl": "galaxy", "GGroup": "galaxy", "OCl": "open_cluster",
        "GCl": "globular_cluster", "PN": "planetary_nebula", "HII": "nebula", "EmN": "nebula", "RfN": "nebula",
        "Neb": "nebula", "Cl+N": "cluster_nebula", "SNR": "supernova_remnant", "*Ass": "association",
        "**": "double_star", "*": "star", "Other": "other"}


def openngc_id(name: str) -> tuple[str, str]:
    """OpenNGC 'NGC0224' -> ('NGC 224', SIMBAD ident); addendum 'Mel022' -> 'Mel 22'."""
    m = re.match(r"^(NGC|IC)0*(\d+)\s*([A-Z]?)$", name)
    if m:
        s = f"{m.group(1)} {m.group(2)}{m.group(3)}"
        return s, s
    m = re.match(r"^M0*(\d+)$", name)
    if m:
        return f"M{m.group(1)}", f"M {m.group(1)}"
    m = re.match(r"^([A-Za-z]+)0*(\d+)$", name)
    if m:
        return f"{m.group(1)} {m.group(2)}", f"{m.group(1)} {m.group(2)}"
    return name, name


def build_messier_ngc(refresh: bool) -> dict:
    src = RAW / "messier-ngc" / "source"
    ngc = pd.read_csv(download(OPENNGC + "NGC.csv", src / "NGC.csv", refresh), sep=";", dtype=str)
    add = pd.read_csv(download(OPENNGC + "addendum.csv", src / "addendum.csv", refresh), sep=";", dtype=str)
    bv_path = download(BV21_URL, src / "baumgardt_orbits_table.txt", refresh)
    allc = pd.concat([ngc.assign(src="NGC.csv"), add.assign(src="addendum.csv")], ignore_index=True)
    v = pd.to_numeric(allc["V-Mag"], errors="coerce")
    b = pd.to_numeric(allc["B-Mag"], errors="coerce")
    bad = {"*", "**", "*Ass", "Dup", "NonEx", "Other", "Nova"}
    is_m = allc["M"].notna() & (allc["Type"] != "Dup")
    # OR, not fallback: OpenNGC V for some large galaxies is not a total magnitude (NGC 253: V 11.1, B 7.9)
    bright = ((v <= 10) | (b <= 10.5)) & ~allc["Type"].isin(bad) & allc["Name"].str.match(r"^(NGC|IC)")
    sel = allc[is_m | bright].copy().reset_index(drop=True)
    # M102: OpenNGC lists it as a duplicate of M101; common identification is NGC 5866
    m102 = allc["Name"].eq("NGC5866")
    if m102.any() and not sel["M"].eq("102").any():
        i = sel.index[sel["Name"] == "NGC5866"]
        if len(i):
            sel.loc[i, "M"] = "102"
        else:
            sel = pd.concat([sel, allc[m102].assign(M="102")], ignore_index=True)
    sel["display"], sel["sb_ident"] = zip(*sel["Name"].map(openngc_id))
    sel["mnum"] = pd.to_numeric(sel["M"], errors="coerce")
    sel["name"] = np.where(sel["mnum"].notna(), "M" + sel["mnum"].astype("Int64").astype(str), sel["display"])
    sel["ident"] = np.where(sel["mnum"].notna(), "M " + sel["mnum"].astype("Int64").astype(str), sel["sb_ident"])

    sim = simbad_resolve(sel["ident"].tolist() + sel["sb_ident"].tolist()).set_index("ident")
    sel["hit"] = [i if i in sim.index else (j if j in sim.index else None) for i, j in zip(sel["ident"], sel["sb_ident"])]
    ok = sel["hit"].notna()
    s = sim.loc[sel.loc[ok, "hit"]].reset_index()
    for col in ["oid", "main_id", "ra", "dec", "plx_value", "plx_err", "plx_bibcode", "otype", "rvz_redshift", "rvz_type", "V"]:
        sel.loc[ok, "sb_" + col] = s[col].to_numpy()
    ids = simbad_ids(sel.loc[ok, "sb_oid"].astype(int).tolist())
    mes = simbad_mesdist(sel.loc[ok, "sb_oid"].astype(int).tolist())
    mes_by = {k: g for k, g in mes.groupby("oidref")}

    # reference distance tables
    lg = pd.read_parquet(RAW / "local-group" / "local-group.parquet")
    lg = lg[np.isfinite(lg["dist_pc"]) & (lg["id"] != "MilkyWay")]
    lv = pd.read_parquet(RAW / "local-volume" / "local-volume.parquet")
    lv = lv[lv["dist_quality"].isin(["measured", "group"])]
    cf4 = pd.read_parquet(RAW / "galaxies-cf4" / "galaxies-cf4.parquet").set_index("pgc")
    bv = pd.read_csv(bv_path, sep=r"\s+", comment="#", header=None, usecols=[0, 1, 2, 5, 6],
                     names=["cluster", "ra", "dec", "rsun_kpc", "drsun_kpc"])

    hr, hr_url = fetch_vizier(HR23_SRC, src / "J_A+A_673_A114_clusters.tsv",
                              ["Name", "dist16", "dist50", "dist84", "Type", "N"], refresh=refresh)
    hr = hr[hr["Type"].str.strip() == "o"]  # open clusters only (g = globular, m = moving group, r = rejected)
    hr_by = {cluster_key(n): (float(d16), float(d50), float(d84)) for n, d16, d50, d84 in
             zip(hr["Name"], hr["dist16"], hr["dist50"], hr["dist84"])}

    # sexagesimal OpenNGC coords as fallback position
    from astropy.coordinates import SkyCoord
    import astropy.units as u
    has_c = sel["RA"].notna() & sel["Dec"].notna()
    c = SkyCoord(sel.loc[has_c, "RA"].tolist(), sel.loc[has_c, "Dec"].tolist(), unit=(u.hourangle, u.deg))
    sel.loc[has_c, "ra_ongc"], sel.loc[has_c, "dec_ongc"] = c.ra.deg, c.dec.deg
    sel["ra"] = sel["sb_ra"].where(sel["sb_ra"].notna(), sel["ra_ongc"]).astype(float)
    sel["dec"] = sel["sb_dec"].where(sel["sb_dec"].notna(), sel["dec_ongc"]).astype(float)
    ra, dec = sel["ra"].to_numpy(), sel["dec"].to_numpy()
    i_lg, _ = match_sky(ra, dec, lg["ra"].to_numpy(), lg["dec"].to_numpy(), 2.0)
    i_lv, _ = match_sky(ra, dec, lv["ra"].to_numpy(), lv["dec"].to_numpy(), 2.0)
    i_bv, _ = match_sky(ra, dec, bv["ra"].to_numpy(), bv["dec"].to_numpy(), 2.0)
    galaxies_ref = pd.concat([lg[["ra", "dec", "dist_pc"]].assign(src="McConnachie 2012 (Jan 2021)"),
                              lv[["ra", "dec", "dist_pc"]].assign(src="UNGC")], ignore_index=True)

    def ref_galaxy_distance(ra_, dec_, radius_arcmin):
        j, sp = match_sky(np.array([ra_]), np.array([dec_]), galaxies_ref["ra"].to_numpy(),
                          galaxies_ref["dec"].to_numpy(), radius_arcmin)
        return (float(galaxies_ref["dist_pc"].iat[j[0]]), galaxies_ref["src"].iat[j[0]]) if j[0] >= 0 else None

    anc = simbad_parents(sel.loc[ok, "sb_oid"].astype(int).tolist())
    pb = simbad_basic([a for v in anc.values() for a in v])
    pmes = simbad_mesdist(pb.index.tolist()) if len(pb) else pd.DataFrame(columns=["oidref"])
    pmes_by = {k: g for k, g in pmes.groupby("oidref")}

    def parent_distance(oid):
        for a in anc.get(oid, []):
            if a not in pb.index:
                continue
            b_ = pb.loc[a]
            if str(b_["otype"]).strip() in ("G", "GiG", "GiP", "IG", "LSB", "AGN", "SBG", "EmG", "BiC", "GiC", "rG", "H2G"):
                gd = ref_galaxy_distance(b_["ra"], b_["dec"], 30.0)
                if gd:
                    return gd[0], f"host galaxy {norm_id(b_['main_id'])} via SIMBAD hierarchy ({gd[1]})"
            pk = pick_mesdist(pmes_by.get(a))
            if pk:
                return pk[0], f"parent {norm_id(b_['main_id'])} via SIMBAD hierarchy: {pk[1]}"
            if pd.notna(b_["plx_value"]) and b_["plx_value"] > 0 and pd.notna(b_["plx_err"]) and b_["plx_value"] / b_["plx_err"] >= 5:
                return 1000 / float(b_["plx_value"]), f"parent {norm_id(b_['main_id'])} SIMBAD plx ({b_['plx_bibcode']})"
        return None

    mc_ref = {"LMC": (80.89375, -69.756111, 6.0), "SMC": (13.186667, -72.828611, 3.0)}

    rec = []
    for k, r in sel.iterrows():
        kind = KIND.get(r["Type"], "other")
        oid = int(r["sb_oid"]) if pd.notna(r.get("sb_oid")) else None
        idd = pick_ids(ids.get(oid, [])) if oid else {}
        dist = lo = hi = np.nan
        how = ""
        if kind == "galaxy":
            if i_lg[k] >= 0:
                g = lg.iloc[i_lg[k]]
                dist, lo, hi, how = g.dist_pc, g.dist_lo_pc, g.dist_hi_pc, "McConnachie 2012 (Jan 2021)"
            elif i_lv[k] >= 0:
                g = lv.iloc[i_lv[k]]
                dist, how = g.dist_pc, f"UNGC ({g.dist_method})"
            elif idd.get("pgc") and int(idd["pgc"]) in cf4.index:
                g = cf4.loc[int(idd["pgc"])]
                dist, lo, hi, how = g.dist_pc, g.dist_lo_pc, g.dist_hi_pc, f"Cosmicflows-4 ({g.dist_methods})"
            elif pd.notna(r.get("sb_rvz_redshift")) and r["sb_rvz_redshift"] >= 0.003:
                dist, how = float(comoving_pc(r["sb_rvz_redshift"])), "Planck18 comoving (SIMBAD redshift)"
        elif kind == "globular_cluster" and i_bv[k] >= 0:
            g = bv.iloc[i_bv[k]]
            dist, how = g.rsun_kpc * 1e3, "Baumgardt & Vasiliev 2021"
            lo, hi = (g.rsun_kpc - g.drsun_kpc) * 1e3, (g.rsun_kpc + g.drsun_kpc) * 1e3
        if kind in ("open_cluster", "cluster_nebula"):
            for cid in [r["display"], r["name"]] + ids.get(oid, []):
                hk = hr_by.get(cluster_key(cid))
                if hk:
                    lo, dist, hi = hk
                    how = f"Hunt & Reffert 2023 ({cid})"
                    break
        if not np.isfinite(dist) and kind in ("open_cluster", "cluster_nebula", "star", "double_star") and pd.notna(r.get("sb_plx_value")) \
                and r["sb_plx_value"] > 0 and pd.notna(r.get("sb_plx_err")) and r["sb_plx_value"] / r["sb_plx_err"] >= 10:
            p, e = float(r["sb_plx_value"]), float(r["sb_plx_err"])
            dist, lo, hi, how = 1000 / p, 1000 / (p + e), 1000 / (p - e), f"SIMBAD plx ({r['sb_plx_bibcode']})"
        if not np.isfinite(dist) and oid in mes_by:
            pk = pick_mesdist(mes_by[oid])
            if pk:
                dist, how = pk
        if not np.isfinite(dist) and pd.notna(r.get("sb_plx_value")) and r["sb_plx_value"] > 0 \
                and pd.notna(r.get("sb_plx_err")) and r["sb_plx_value"] / r["sb_plx_err"] >= 5:
            p, e = float(r["sb_plx_value"]), float(r["sb_plx_err"])
            dist, lo, hi, how = 1000 / p, 1000 / (p + e), 1000 / (p - e), f"SIMBAD plx ({r['sb_plx_bibcode']})"
        if not np.isfinite(dist) and oid:
            pdist = parent_distance(oid)
            if pdist:
                dist, how = pdist
        if not np.isfinite(dist):
            for mc, (mra, mdec, rad) in mc_ref.items():
                sepdeg = SkyCoord(r["ra"] * u.deg, r["dec"] * u.deg).separation(SkyCoord(mra * u.deg, mdec * u.deg)).deg
                gd = ref_galaxy_distance(mra, mdec, 5.0)
                if sepdeg < rad and gd:
                    dist, how = gd[0], f"assumed {mc} member (within {rad:g} deg of its centre; {gd[1]})"
                    break
        vm = pd.to_numeric(r["V-Mag"], errors="coerce")
        band = "V"
        if not np.isfinite(vm) and pd.notna(r.get("sb_V")):
            vm = float(r["sb_V"])
        if not np.isfinite(vm):
            vm, band = pd.to_numeric(r["B-Mag"], errors="coerce"), "B"
        alt = []
        if r["name"].startswith("M"):
            alt.append(r["display"]) if r["display"] != r["name"] else None
        elif pd.notna(r["mnum"]):
            alt.append(f"M{int(r['mnum'])}")
        if isinstance(r.get("Common names"), str):
            alt += [x.strip() for x in r["Common names"].split(",") if x.strip()]
        for key, pre in [("ngc", "NGC "), ("ic", "IC "), ("pgc", "PGC ")]:
            if idd.get(key) and pre + idd[key] not in alt and pre + idd[key] != r["name"]:
                alt.append(pre + idd[key])
        if isinstance(r.get("sb_main_id"), str) and r["sb_main_id"] not in alt and r["sb_main_id"] != r["name"] \
                and r["sb_main_id"].replace(" ", "") != r["name"]:
            alt.append(r["sb_main_id"])
        rec.append({"name": r["name"], "alt": list(dict.fromkeys(alt)), "kind": kind, "ra": r["ra"], "dec": r["dec"],
                    "dist_pc": dist, "dist_lo_pc": lo, "dist_hi_pc": hi, "dist_method": how,
                    "mag": vm, "mag_band": band if np.isfinite(vm) else "", "type_openngc": r["Type"],
                    "otype_simbad": r.get("sb_otype"), "simbad_main_id": r.get("sb_main_id"),
                    "messier": int(r["mnum"]) if pd.notna(r["mnum"]) else None, "openngc_name": r["Name"],
                    "pgc": idd.get("pgc")})
    df = pd.DataFrame(rec)
    df = df.sort_values(["messier", "name"], na_position="last").reset_index(drop=True)
    entries = []
    for r in df.itertuples():
        e = {"name": r.name, "alt": r.alt, "kind": r.kind, "ra": round(float(r.ra), 5), "dec": round(float(r.dec), 5),
             "dist_pc": float(f"{r.dist_pc:.5g}") if np.isfinite(r.dist_pc) else None,
             "mag": round(float(r.mag), 2) if np.isfinite(r.mag) else None,
             "xyz": xyz_list(r.ra, r.dec, r.dist_pc), "ref": "OpenNGC / SIMBAD / " + (r.dist_method.split(" (")[0] if r.dist_method else "no distance"),
             "mag_band": r.mag_band, "dist_method": r.dist_method}
        if r.messier and not np.isnan(r.messier):
            e["messier"] = int(r.messier)
        entries.append(e)
    size = write_catalog_json(CATS / "messier-ngc.json", entries)
    pq_df = df.assign(id=df["name"], color=np.nan, alt=df["alt"].map(lambda a: "; ".join(a)))
    xyz = galactic_xyz(pq_df["ra"].to_numpy(float), pq_df["dec"].to_numpy(float), pq_df["dist_pc"].to_numpy(float))
    pq_df["x_pc"], pq_df["y_pc"], pq_df["z_pc"] = xyz[:, 0], xyz[:, 1], xyz[:, 2]
    stats = {"objects": int(len(df)), "messier": int(df["messier"].notna().sum()),
             "ngc_ic_bright_non_messier": int(df["messier"].isna().sum()),
             "simbad_resolved": int(ok.sum()), "unresolved": sel.loc[~ok, "Name"].tolist(),
             "with_distance": int(np.isfinite(df["dist_pc"]).sum()),
             "no_distance": df.loc[~np.isfinite(df["dist_pc"]), "name"].tolist(),
             "dist_source_counts": {k: int(v) for k, v in df["dist_method"].str.split(" \\(").str[0].value_counts().items()},
             "kind_counts": {k: int(v) for k, v in df["kind"].value_counts().items()}}
    prov = {"service": {"openngc": OPENNGC, "simbad_tap": SIMBAD_TAP, "baumgardt": BV21_URL, "hunt_reffert_2023": hr_url},
            "selection": "all 110 Messier objects (M102 := NGC 5866; OpenNGC marks M102 as a duplicate of M101) + "
                         "NGC/IC objects with V <= 10 or B <= 10.5, excluding OpenNGC types "
                         "*, **, *Ass, Dup, NonEx, Other, Nova",
            "distance_rule": {"galaxy": "McConnachie (<=2') > UNGC measured/group (<=2') > CF4 by PGC > Planck18 comoving "
                                        "of SIMBAD redshift (z>=0.003) > SIMBAD mesDistance",
                              "globular_cluster": "Baumgardt & Vasiliev 2021 Rsun (<=2') > SIMBAD mesDistance > SIMBAD plx",
                              "open_cluster": "Hunt & Reffert 2023 dist50 (name match, Type o) > SIMBAD plx (plx/err>=10) > SIMBAD mesDistance > SIMBAD plx (>=5)",
                              "star/double_star": "SIMBAD plx (plx/err>=10) > SIMBAD mesDistance > SIMBAD plx (>=5)",
                              "fallbacks": "SIMBAD h_link parent (<=2 levels): host galaxy distance (McConnachie/UNGC <=30') or parent mesDistance/plx; then objects within 6 deg of the LMC / 3 deg of the SMC get the McConnachie LMC/SMC distance (flagged)",
                              "nebulae/other": "SIMBAD mesDistance (median of plx-based entries, else since 2010, else all) > SIMBAD plx (>=5)"},
            "mag": "OpenNGC V-Mag, else SIMBAD V, else OpenNGC B-Mag (band in mag_band)",
            "stats": stats, "catalog_json": "data/tiles/catalogs/messier-ngc.json", "catalog_json_bytes": size,
            "citations": [CIT["openngc"], CIT["simbad"], CIT["bv21"], CIT["hr23"], CIT["mcc"], CIT["ungc"], CIT["cf4"], CIT["p18"]]}
    return {"df": pq_df, "prov": prov}


def save(layer: str, res: dict, started: str) -> None:
    out = RAW / layer
    out.mkdir(parents=True, exist_ok=True)
    df = res["df"].copy()
    df["id"] = df["id"].astype("string")
    for c in ["ra", "dec", "dist_pc", "dist_lo_pc", "dist_hi_pc"]:
        df[c] = df[c].astype("float64")
    for c in ["mag", "color"]:
        df[c] = df[c].astype("float32")
    df["kind"] = df["kind"].astype("category")
    for c in df.columns:
        if df[c].dtype == object:
            df[c] = df[c].map(lambda x: None if x is None or (isinstance(x, float) and np.isnan(x)) else str(x))
    dest = out / f"{layer}.parquet"
    df.to_parquet(dest, index=False)
    prov = {"layer": layer, "started_utc": started, "finished_utc": utcnow(), "rows": int(len(df)),
            "file": str(dest.relative_to(ROOT)), "file_bytes": dest.stat().st_size, **res["prov"]}
    (out / "PROVENANCE.json").write_text(json.dumps(prov, indent=2, ensure_ascii=False))
    print(f"{layer}: {len(df)} rows; json {prov['catalog_json_bytes']} B; stats:",
          json.dumps(prov["stats"], ensure_ascii=False)[:1500])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--only", choices=["stars", "messier"], default=None)
    a = ap.parse_args()
    started = utcnow()
    if a.only in (None, "stars"):
        save("named-stars", build_named_stars(a.refresh), started)
    if a.only in (None, "messier"):
        save("messier-ngc", build_messier_ngc(a.refresh), started)


if __name__ == "__main__":
    main()
