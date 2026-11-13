#!/usr/bin/env python
"""black-holes.json: measured black holes, kind `black_hole` (docs/content-contract.md section 3).

PROVENANCE
  Stellar-mass BHs in X-ray transients: BlackCAT (Corral-Santana et al. 2016, A&A 587, A61), the
      UPDATED online version (www.astro.puc.cl/BlackCAT, "Last modified: 22 September 2025", 73
      transients). Only the dynamically confirmed systems (bold rows on transients.php) are taken;
      distance, BH mass and orbital period come from each object's info.php page with the original
      reference (ADS bibcode) per number. Fallback when the site is down: VizieR J/A+A/587/A61
      (tablea1 + tablea4, the 2016 paper version).
  Persistent high-mass X-ray binaries (not in BlackCAT, which lists transients): Cyg X-1
      (Miller-Jones et al. 2021), LMC X-1 (Orosz et al. 2009), LMC X-3 (Orosz et al. 2014); the LMC
      ones at the LMC distance of Pietrzynski et al. 2019.
  Dormant BHs found by Gaia: Gaia BH1 (El-Badry et al. 2023a), BH2 (El-Badry et al. 2023b), BH3
      (Gaia Collaboration, Panuzzo et al. 2024). Positions from Gaia DR3 (Gaia TAP).
  Supermassive: Sgr A* (GRAVITY 2022 mass + R0; GRAVITY 2019 values kept as facts), M87* (EHT 2019
      Papers I and VI), and a handful of nearby galaxies from the van den Bosch (2016) compilation
      (VizieR J/ApJ/831/134, tables 2+3; distance and mass from the same table so they are
      consistent; original measurement reference from its refs table).
  Every value was checked against the cited paper's abstract/text on 2026-11-13 (see the
  `facts_ref` / `ref` of each entry).

Output: data/tiles/catalogs/black-holes.json, provenance in data/tiles/catalogs/provenance/.
Usage: .venv/bin/python scripts/build_black_holes.py [--refresh]
"""
from __future__ import annotations

import argparse
import html as htmllib
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import astropy.units as u
from astropy.coordinates import SkyCoord

sys.path.insert(0, str(Path(__file__).resolve().parent))
from catio import (CACHE, CATS, SIMBAD_TAP, download, fetch_vizier, num, sig, tap_sync, utcnow,  # noqa: E402
                   write_catalog_json, write_provenance)
from coords import xyz_list  # noqa: E402

NAME = "black-holes"
BLACKCAT = "https://www.astro.puc.cl/BlackCAT/"
VDB16 = "J/ApJ/831/134"

REF = {
    "gravity19": ("GRAVITY Collaboration, Abuter et al. 2019, A&A 625, L10", "10.1051/0004-6361/201935656"),
    "gravity22": ("GRAVITY Collaboration, Abuter et al. 2022, A&A 657, L12", "10.1051/0004-6361/202142465"),
    "eht19_1": ("Event Horizon Telescope Collaboration 2019, ApJL 875, L1 (Paper I)", "10.3847/2041-8213/ab0ec7"),
    "eht19_6": ("Event Horizon Telescope Collaboration 2019, ApJL 875, L6 (Paper VI)", "10.3847/2041-8213/ab1141"),
    "bh1": ("El-Badry et al. 2023, MNRAS 518, 1057 (Gaia BH1)", "10.1093/mnras/stac3140"),
    "bh2": ("El-Badry et al. 2023, MNRAS 521, 4323 (Gaia BH2)", "10.1093/mnras/stad799"),
    "bh3": ("Gaia Collaboration, Panuzzo et al. 2024, A&A 686, L2 (Gaia BH3)", "10.1051/0004-6361/202449763"),
    "cygx1": ("Miller-Jones et al. 2021, Science 371, 1046 (Cyg X-1)", "10.1126/science.abb3363"),
    "lmcx1": ("Orosz et al. 2009, ApJ 697, 573 (LMC X-1)", "10.1088/0004-637X/697/1/573"),
    "lmcx3": ("Orosz et al. 2014, ApJ 794, 154 (LMC X-3)", "10.1088/0004-637X/794/2/154"),
    "lmc": ("Pietrzynski et al. 2019, Nature 567, 200 (LMC distance 49.59 kpc)", "10.1038/s41586-019-0999-4"),
    "blackcat": ("Corral-Santana et al. 2016, A&A 587, A61 (BlackCAT; online version, last modified 2025-09-22)",
                 "10.1051/0004-6361/201527130"),
    "vdb16": ("van den Bosch 2016, ApJ 831, 134 (BH mass compilation; VizieR J/ApJ/831/134)", "10.3847/0004-637X/831/2/134"),
    "gaia": ("Gaia Collaboration, Vallenari et al. 2023, A&A 674, A1 (Gaia DR3 positions)", "10.1051/0004-6361/202243940"),
}

LMC_PC = 49590.0  # Pietrzynski et al. 2019: 49.59 +- 0.09 (stat) +- 0.54 (sys) kpc
LMC_ERR = 545.0   # stat (+) sys in quadrature


def entry(name, alt, ra, dec, d, lo, hi, facts, ref_key, docs=None, facts_ref=None, **extra):
    ref, doi = REF[ref_key]
    e = {"name": name, "alt": alt, "kind": "black_hole", "ra": round(float(ra), 6), "dec": round(float(dec), 6),
         "dist_pc": sig(d, 6), "mag": None, "xyz": xyz_list(ra, dec, d) if d else None,
         "ref": ref, "doi": doi, "dist_lo_pc": sig(lo, 6), "dist_hi_pc": sig(hi, 6), "facts": facts}
    if docs:
        e["docs"] = docs
    if facts_ref:
        e["facts_ref"] = facts_ref
    e.update(extra)
    return e


def simbad_positions(idents: list[str]) -> pd.DataFrame:
    """SIMBAD (Harvard mirror) ICRS position per identifier (Gaia DR3 ids give the Gaia DR3 position)."""
    q = ("SELECT i.id AS ident, b.main_id, b.ra, b.dec, b.coo_bibcode FROM ident AS i JOIN basic AS b ON i.oidref = b.oid "
         "WHERE i.id IN (" + ",".join("'" + x.replace("'", "''") + "'" for x in idents) + ")")
    df = tap_sync(SIMBAD_TAP, q)
    df["ident"] = df["ident"].str.split().str.join(" ")
    return df.set_index("ident")


POS_IDS = {"Sgr A*": "NAME Sgr A*", "M87*": "M 87", "Cyg X-1": "V* V1357 Cyg", "LMC X-1": "X LMC X-1",
           "LMC X-3": "X LMC X-3", "Gaia BH1": "Gaia DR3 4373465352415301632",
           "Gaia BH2": "Gaia DR3 5870569352746779008", "Gaia BH3": "Gaia DR3 4318465066420528000"}


def curated() -> list[dict]:
    out = []
    pos = simbad_positions(list(POS_IDS.values()))
    missing = [k for k, v in POS_IDS.items() if v not in pos.index]
    assert not missing, f"SIMBAD did not resolve {missing}"
    P = {k: (float(pos.loc[v, "ra"]), float(pos.loc[v, "dec"])) for k, v in POS_IDS.items()}
    # --- Sgr A*: position = SIMBAD 'NAME Sgr A*' (VLBA, Reid & Brunthaler 2004) ---------------------
    r0, r0_err = 8277.0, float(np.hypot(9.0, 33.0))  # GRAVITY 2022: 8277 +- 9 (stat) +- ~30-33 (sys) pc
    out.append(entry(
        "Sgr A*", ["Sagittarius A*", "Sgr A star", "Milky Way black hole"], *P["Sgr A*"],
        r0, r0 - r0_err, r0 + r0_err,
        {"mass_msun": [4.297e6, 0.012e6], "type": "supermassive", "mass_2019_msun": [4.152e6, 0.014e6],
         "dist_2019_kpc": [8.178, 0.013]},
        "gravity22", docs="sgr-a-star",
        facts_ref={"mass_msun": REF["gravity22"][0] + " (stat. error; sys. ~0.04e6)",
                   "mass_2019_msun": REF["gravity19"][0], "dist_2019_kpc": REF["gravity19"][0] + " (stat.; sys. 22 pc)"},
        dist_note="R0 = 8277 +- 9 (stat) pc, GRAVITY 2022; lo/hi add the ~33 pc systematic in quadrature"))
    # --- M87*: position of the M87 core (vdB16/SIMBAD), EHT mass and distance -------------------------
    out.append(entry(
        "M87*", ["M87 black hole", "Powehi", "NGC 4486 nucleus", "Virgo A*"], *P["M87*"],
        16.8e6, 16.0e6, 17.6e6,
        {"mass_msun": [6.5e9, 0.7e9], "type": "supermassive", "host": "M87 (NGC 4486)", "shadow_diameter_uas": [42, 3]},
        "eht19_1", docs="m87-black-hole",
        facts_ref={"mass_msun": REF["eht19_1"][0], "shadow_diameter_uas": REF["eht19_1"][0]},
        dist_note="D = 16.8 +- 0.8 Mpc adopted in " + REF["eht19_6"][0]))
    # --- Gaia BH1/2/3 --------------------------------------------------------------------------------
    bh = [("Gaia BH1", "bh1", 477.0, 4.0, {"mass_msun": [9.62, 0.18], "type": "stellar, dormant",
                                             "orbital_period_days": 185.59, "companion": "G dwarf", "discovered": 2022},
           "distance 477 +- 4 pc from the Gaia DR3 orbital astrometric solution (El-Badry et al. 2023a, Sect. 3.1)"),
          ("Gaia BH2", "bh2", 1160.0, 20.0, {"mass_msun": [8.94, 0.34], "type": "stellar, dormant",
                                              "orbital_period_days": 1277, "companion": "red giant", "discovered": 2023},
           "distance 1.16 +- 0.02 kpc from the Gaia astrometric solution (El-Badry et al. 2023b, Sect. 4)"),
          ("Gaia BH3", "bh3", 590.6, 5.8, {"mass_msun": [32.70, 0.82], "type": "stellar, dormant",
                                            "orbital_period_days": 4253, "companion": "very metal-poor giant", "discovered": 2024},
           "distance 590.6 +- 5.8 pc (Panuzzo et al. 2024, Appendix B); period 11.6 yr")]
    for nm, rk, d, de, facts, note in bh:
        out.append(entry(nm, [POS_IDS[nm]], *P[nm], d, d - de, d + de, facts, rk,
                         docs="gaia-bh3" if nm == "Gaia BH3" else None,
                         facts_ref={"mass_msun": REF[rk][0], "position": REF["gaia"][0] + " via SIMBAD"}, dist_note=note))
    # --- persistent HMXBs ----------------------------------------------------------------------------
    out.append(entry("Cyg X-1", ["Cygnus X-1", "HD 226868", "V1357 Cyg", "HDE 226868"], *P["Cyg X-1"],
                     2220.0, 2050.0, 2400.0,
                     {"mass_msun": [21.2, 2.2], "type": "stellar, X-ray binary (HMXB)"},
                     "cygx1", facts_ref={"mass_msun": REF["cygx1"][0]},
                     dist_note="2.22 +0.18 -0.17 kpc, VLBA parallax (Miller-Jones et al. 2021)"))
    out.append(entry("LMC X-1", ["X LMC X-1"], *P["LMC X-1"], LMC_PC, LMC_PC - LMC_ERR, LMC_PC + LMC_ERR,
                     {"mass_msun": [10.91, 1.41], "type": "stellar, X-ray binary (HMXB)", "orbital_period_days": 3.90917,
                      "host": "Large Magellanic Cloud"},
                     "lmcx1", facts_ref={"mass_msun": REF["lmcx1"][0], "orbital_period_days": REF["lmcx1"][0]},
                     dist_note="LMC distance, " + REF["lmc"][0]))
    out.append(entry("LMC X-3", ["X LMC X-3"], *P["LMC X-3"], LMC_PC, LMC_PC - LMC_ERR, LMC_PC + LMC_ERR,
                     {"mass_msun": [6.98, 0.56], "type": "stellar, X-ray binary (HMXB)", "host": "Large Magellanic Cloud"},
                     "lmcx3", facts_ref={"mass_msun": REF["lmcx3"][0]},
                     dist_note="LMC distance, " + REF["lmc"][0]))
    return out


# ------------------------------------------------------------------------------------- BlackCAT
NUM = r"[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?"


def _txt(s: str) -> str:
    s = re.sub(r"<sup>\s*\+?(" + NUM + r")\s*</sup>\s*<sub>\s*-?(" + NUM + r")\s*</sub>", r" +\1 -\2 ", s)
    s = re.sub(r"&plusmn;\s*<sup>\s*(" + NUM + r")\s*</sup>\s*<sub>\s*(" + NUM + r")\s*</sub>", r" +\1 -\2 ", s)
    s = re.sub(r"<br\s*/?>", " ; ", s)
    s = htmllib.unescape(re.sub(r"<[^>]+>", " ", s))
    s = s.replace("–", "-").replace("±", " ± ").replace("∼", "~").replace("–", "-")
    return re.sub(r"\s+", " ", s).replace("± +", "+").strip(" ;/")


def parse_measure(raw: str):
    """BlackCAT cell -> (best value, lo err, hi err, text). Several measurements separated by '/' or
    line breaks: the one with the smallest relative error wins. Limits/ranges -> value None."""
    text = _txt(raw)
    best = None
    for part in re.split(r"\s*[;/]\s*", text):
        m = re.fullmatch(rf"({NUM}) ± ({NUM})", part)
        if m:
            v, e = float(m[1]), float(m[2])
            cand = (v, e, e)
        else:
            m = re.fullmatch(rf"({NUM}) \+({NUM}) -({NUM})", part)
            cand = (float(m[1]), float(m[3]), float(m[2])) if m else None
        if cand and cand[0] > 0 and (best is None or max(cand[1:]) / cand[0] < max(best[1:]) / best[0]):
            best = cand
    if best:
        return best[0], best[1], best[2], text
    m = re.fullmatch(rf"~\s*({NUM})", text)
    if m:
        return float(m[1]), None, None, text
    return None, None, None, text


def _refs(cell: str) -> list[str]:
    return re.findall(r"abs/([^'\"]+)['\"]", cell)


def blackcat(refresh: bool) -> tuple[list[dict], dict]:
    src = CACHE / NAME / "blackcat"
    lst = download(BLACKCAT + "transients.php", src / "transients.html", refresh).read_text()
    rows = re.findall(r"<tr style=font-weight:bold>(.*?)</tr>", lst, re.S)
    n_all = len(re.findall(r'<tr style=font-weight:(?:bold|normal)>', lst))
    modified = re.search(r"Last modified:\s*([^<.]+)", download(BLACKCAT, src / "index.html", refresh).read_text())
    out = []
    for r in rows:
        bid = re.search(r"info\.php\?id=(\d+)", r)[1]
        cells = re.findall(r'<td class="column-([a-z-]+)-list">(.*?)</td>', r, re.S)
        c = {}
        for k, v in cells:
            c.setdefault(k, []).append(v)
        names = [x.strip() for x in re.split(r"<br\s*/?>", re.sub(r"</?a[^>]*>", "", c["name"][0])) if x.strip()]
        name = htmllib.unescape(names[0])
        alt = [a.strip() for n in names[1:] for a in re.split(r"\s*=\s*", htmllib.unescape(n)) if a.strip()]
        ra_s, dec_s = (re.sub(r"<[^>]+>", "", x).strip() for x in c["coord"][:2])
        sc = SkyCoord(ra_s, dec_s, unit=(u.hourangle, u.deg))
        page = re.sub(r"\s+", " ", download(BLACKCAT + f"info.php?id={bid}", src / f"info_{bid}.html", refresh).read_text())
        assert "Dynamically confirmed BH" in page, name

        def row(label_re):
            m = re.search(label_re + r"\s*</th>\s*<td[^>]*>(.*?)</td>\s*<td[^>]*>(.*?)</td>", page)
            return (m[1], _refs(m[2])) if m else (None, [])

        draw, dref = row(r"Distance \[kpc\]")
        mraw, mref = row(r"BH mass \(M<sub>1</sub>\) \[M<sub>&#x2609;</sub>\]")
        praw, pref = row(r"<th>Orbital period \(P<sub>orb</sub>\) \[h\]")
        sraw, _ = row(r"<th>Star's spectral type")
        yr = re.search(r"Year of discovery: </strong>\s*(\d{4})", page)
        d, dlo, dhi, dtext = parse_measure(draw or "")
        mv, mlo, mhi, mtext = parse_measure(mraw or "")
        pv, _, _, ptext = parse_measure(praw or "")
        facts = {"type": "stellar, X-ray binary (LMXB transient)"}
        if mv is not None:
            facts["mass_msun"] = [mv, mlo] if mlo == mhi else [mv, mlo, mhi]
        elif mtext:
            facts["mass_msun"] = mtext.replace(" - ", "–")
        if pv is not None:
            facts["orbital_period_days"] = sig(pv / 24.0, 6)
        if sraw and _txt(sraw):
            facts["companion"] = _txt(sraw)
        if yr:
            facts["discovered"] = int(yr[1])
        dist_pc = d * 1e3 if d else None
        lo = (d - dlo) * 1e3 if d and dlo is not None else None
        hi = (d + dhi) * 1e3 if d and dhi is not None else None
        e = entry(name, list(dict.fromkeys(alt)), sc.ra.deg, sc.dec.deg, dist_pc, lo, hi, facts, "blackcat",
                  facts_ref={"mass_msun": "BlackCAT: " + (", ".join(mref) or "n/a"),
                             "distance": "BlackCAT: " + (", ".join(dref) or "n/a"),
                             "orbital_period_days": "BlackCAT: " + (", ".join(pref) or "n/a")},
                  dist_note=f"BlackCAT distance cell: '{dtext}'" + ("" if d else " (no usable distance: direction only)"),
                  url=BLACKCAT + f"info.php?id={bid}")
        out.append(e)
    stats = {"blackcat_rows": n_all, "dynamically_confirmed": len(rows),
             "blackcat_last_modified": modified[1].strip() if modified else None,
             "without_distance": [e["name"] for e in out if e["dist_pc"] is None]}
    return out, stats


def blackcat_vizier(refresh: bool) -> tuple[list[dict], dict]:
    """Fallback: the 2016 paper tables on VizieR."""
    src = CACHE / NAME / "vizier"
    t1, _ = fetch_vizier("J/A+A/587/A61/tablea1", src / "tablea1.tsv", refresh=refresh)
    t4, _ = fetch_vizier("J/A+A/587/A61/tablea4", src / "tablea4.tsv", refresh=refresh)
    t4 = t4.set_index("Name")
    out = []
    for r in t1[t1["f_Name"] == "*"].itertuples():
        sc = SkyCoord(r.RAJ2000, r.DEJ2000, unit=(u.hourangle, u.deg))
        d = pd.to_numeric(r.Dist, errors="coerce")
        de = pd.to_numeric(r.e_Dist, errors="coerce")
        ok = np.isfinite(d) and r.l_Dist == ""
        facts = {"type": "stellar, X-ray binary (LMXB transient)", "discovered": int(r.Year)}
        if r.Name in t4.index:
            m = t4.loc[r.Name]
            mv = pd.to_numeric(m["M1"], errors="coerce")
            facts["mass_msun"] = (f"{m['l_M1']} {mv}".strip() if m["l_M1"].strip() not in ("", "=") else float(mv))
        out.append(entry(r.Name, [r.Ctp.strip("()")] if r.Ctp else [], sc.ra.deg, sc.dec.deg,
                         d * 1e3 if ok else None, (d - de) * 1e3 if ok and np.isfinite(de) else None,
                         (d + de) * 1e3 if ok and np.isfinite(de) else None, facts, "blackcat"))
    return out, {"source": "VizieR J/A+A/587/A61 (2016 version; online BlackCAT unavailable)"}


# ------------------------------------------------------------------------------- SMBH in galaxies
SMBH = {  # vdB16 name -> (display name, alt names)
    "NGC0224": ("M31*", ["Andromeda black hole", "M31 nucleus", "NGC 224 nucleus"]),
    "NGC0221": ("M32*", ["M32 black hole", "NGC 221 nucleus"]),
    "NGC4258": ("NGC 4258 megamaser BH", ["M106 black hole", "NGC 4258 nucleus"]),
    "NGC5128": ("Centaurus A*", ["Cen A black hole", "NGC 5128 nucleus"]),
    "NGC3031": ("M81*", ["M81 black hole", "NGC 3031 nucleus"]),
    "NGC4594": ("Sombrero black hole", ["M104 black hole", "NGC 4594 nucleus"]),
    "NGC4649": ("M60 black hole", ["NGC 4649 nucleus"]),
    "NGC3115": ("NGC 3115 black hole", ["Spindle Galaxy black hole"]),
    "NGC1068": ("M77 black hole", ["NGC 1068 nucleus"]),
    "Circinus": ("Circinus Galaxy black hole", ["Circinus nucleus"]),
    "NGC1277": ("NGC 1277 black hole", []),
    "NGC4889": ("NGC 4889 black hole", ["Coma cluster BCG black hole"]),
}
METHOD = {"star": "stellar dynamics", "gas": "gas dynamics", "maser": "water megamaser", "reverb": "reverberation mapping"}


def smbh_vdb16(refresh: bool) -> tuple[list[dict], dict]:
    src = CACHE / NAME / "vdb16"
    cols = ["Name", "f_Name", "Dist", "e_Dist", "logBHMass", "E_logBHMass", "e_logBHMass", "Meth", "Refs", "SimbadName"]
    t2, url2 = fetch_vizier(VDB16 + "/table2", src / "table2.tsv", cols, refresh=refresh)
    t3, _ = fetch_vizier(VDB16 + "/table3", src / "table3.tsv", cols, refresh=refresh)
    refs, _ = fetch_vizier(VDB16 + "/refs", src / "refs.tsv", ["Ref", "BibCode", "Auth"], refresh=refresh)
    refs = {r.Ref.strip(): f"{r.Auth.strip()} ({r.BibCode.strip()})" for r in refs.itertuples()}
    t = pd.concat([t2, t3[t3["f_Name"] == "2"]], ignore_index=True).drop_duplicates("Name")
    t = t.set_index("Name")
    out = []
    for key, (nm, alt) in SMBH.items():
        r = t.loc[key]
        logm, ep, em = (float(r[c]) for c in ("logBHMass", "E_logBHMass", "e_logBHMass"))
        m = 10 ** logm
        d = float(r["Dist"]) * 1e6
        de = pd.to_numeric(r["e_Dist"], errors="coerce")
        orig = "; ".join(refs.get(x.strip(), x.strip()) for x in r["Refs"].split(","))
        facts = {"mass_msun": [sig(m, 3), sig(m - 10 ** (logm - em), 2), sig(10 ** (logm + ep) - m, 2)],
                 "type": "supermassive", "method": METHOD.get(r["Meth"].strip(), r["Meth"].strip()),
                 "host": re.sub(r"^NAME |^NGC0*", lambda m: "" if m[0] == "NAME " else "NGC ", r["SimbadName"].strip() or key)}
        out.append(entry(nm, alt, float(r["_RAJ2000"]), float(r["_DEJ2000"]), d,
                         d - de * 1e6 if np.isfinite(de) and de > 0 else None,
                         d + de * 1e6 if np.isfinite(de) and de > 0 else None, facts, "vdb16",
                         facts_ref={"mass_msun": f"{REF['vdb16'][0]}; original measurement: {orig}"},
                         dist_note="distance from the same compilation (mass scales with distance)"))
    return out, {"vdb16_url": url2, "selected": list(SMBH)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true")
    a = ap.parse_args()
    started = utcnow()
    cur = curated()
    try:
        bc, bc_stats = blackcat(a.refresh)
    except Exception as exc:  # noqa: BLE001 - site down: fall back to the paper version
        print(f"BlackCAT online failed ({exc}); using VizieR 2016 tables")
        bc, bc_stats = blackcat_vizier(a.refresh)
    smbh, smbh_stats = smbh_vdb16(a.refresh)
    entries = cur + smbh + bc
    size = write_catalog_json(CATS / f"{NAME}.json", entries)
    prov = {"catalog": f"data/tiles/catalogs/{NAME}.json", "bytes": size, "started_utc": started, "finished_utc": utcnow(),
            "counts": {"total": len(entries), "curated": len(cur), "smbh_vdb16": len(smbh), "blackcat_dynamical": len(bc),
                       "with_distance": sum(e["dist_pc"] is not None for e in entries)},
            "service": {"blackcat": BLACKCAT, "vizier": "https://vizier.cfa.harvard.edu (CfA mirror)", "simbad_tap": SIMBAD_TAP},
            "blackcat": bc_stats, "smbh": smbh_stats,
            "rules": "dist_pc = best published distance; lo/hi = 1-sigma (asymmetric where published). facts.mass_msun = value, "
                     "[value, err] or [value, err_minus, err_plus]; limits and ranges are kept as text.",
            "citations": [{"ref": r, "doi": d} for r, d in REF.values()]}
    write_provenance(NAME, prov)
    print(f"{NAME}: {len(entries)} entries, {size} B; BlackCAT {bc_stats}")


if __name__ == "__main__":
    main()
