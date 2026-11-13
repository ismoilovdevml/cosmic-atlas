#!/usr/bin/env python
"""seti.json: messages sent to the stars (kind `message`) and the Wow! signal (kind `seti_signal`).

No confirmed extraterrestrial signal has ever been detected. The Wow! signal (1977) was seen once
and never again; recent work favours a natural (astrophysical) origin. Every entry says so in facts.

PROVENANCE
  Messages (send date, target): Zaitsev 2006 (arXiv:physics/0610031, Table 3: Arecibo 1974,
      Cosmic Call 1 1999, Teen Age Message 2001, Cosmic Call 2 2003) and, for later ones, the
      "Active SETI" table on English Wikipedia (raw wikitext revision fetched at build time; that
      table cites Zaitsev, BBC News 2008-10-09, lonesignal.com and sonarcalling.com). Arecibo also:
      The Staff at the NAIC 1975, Icarus 26, 462.
  Message position: the CURRENT LIGHT FRONT, i.e. the target direction at distance
      c * (AS_OF - send date); AS_OF is the build date (stored in every entry). The target star's
      distance comes from its SIMBAD parallax (Gaia DR3 for almost all), M13 from Baumgardt &
      Vasiliev 2021 (7.42 +- 0.08 kpc). arrival_year = send year + target distance in light years.
  Wow! signal: Ehman 1998 ("The Big Ear Wow! Signal ... after 20 years", bigear.org/wow20th.htm):
      B1950 R.A. 19h22m25s (positive horn) or 19h25m17s (negative horn) +- 10s, Dec -27d03m +- 20m,
      transformed here to ICRS with astropy (FK4 B1950 -> ICRS). Revised fields, frequency and flux:
      Mendez et al. 2025 (arXiv:2508.10657): 19h25m02s or 19h27m55s +- 3s, -26d57m +- 20m (J2000),
      1420.726 +- 0.005 MHz, > 250 Jy. Candidate Sun-like star in the field: 2MASS 19281982-2640123
      (Caballero 2022, IJA; arXiv:2011.06090) = Gaia DR3 6766185791864654720 (not in SIMBAD):
      position from Gaia DR3 (VizieR I/355), distance = Bailer-Jones et al. 2021 geometric (I/352).
  Breakthrough Listen target lists are not included (no matching kind in the content contract).

Output: data/tiles/catalogs/seti.json, provenance in data/tiles/catalogs/provenance/.
Usage: .venv/bin/python scripts/build_seti.py [--refresh] [--as-of YYYY-MM-DD]
"""
from __future__ import annotations

import argparse
import datetime as dt
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import astropy.units as u
from astropy.coordinates import FK4, ICRS, SkyCoord
from astropy.time import Time

sys.path.insert(0, str(Path(__file__).resolve().parent))
from catio import CACHE, CATS, SIMBAD_TAP, download, fetch_vizier, sig, tap_sync, utcnow, write_catalog_json, write_provenance  # noqa: E402
from coords import xyz_list  # noqa: E402

NAME = "seti"
LY_PER_PC = 3.261563777
WIKI = "https://en.wikipedia.org/w/index.php?title=Active_SETI&action=raw"
BV21_URL = "https://people.smp.uq.edu.au/HolgerBaumgardt/globular/orbits_table.txt"
NO_ET = "No confirmed extraterrestrial signal has ever been detected."
REF = {
    "zaitsev06": "Zaitsev 2006, Messaging to Extra-Terrestrial Intelligence, arXiv:physics/0610031 (Table 3)",
    "naic75": "The Staff at the National Astronomy and Ionosphere Center 1975, Icarus 26, 462 (The Arecibo message of 1974)",
    "wiki": "Wikipedia, 'Active SETI' (table of messages sent; its sources: Zaitsev VAK-2004, BBC News 2008-10-09, "
            "lonesignal.com, sonarcalling.com), wikitext fetched at build time",
    "bv21": "Baumgardt & Vasiliev 2021, MNRAS 505, 5957 (M13 distance 7.42 +- 0.08 kpc)",
    "ehman98": "Ehman 1998, The Big Ear Wow! Signal: What We Know and Don't Know About It After 20 Years (bigear.org/wow20th.htm)",
    "mendez25": "Mendez et al. 2025, Arecibo Wow! II: Revised Properties of the Wow! Signal, arXiv:2508.10657",
    "mendez24": "Mendez, Ortiz Ceballos & Zuluaga 2024, Arecibo Wow! I: An Astrophysical Explanation, arXiv:2408.08513",
    "caballero22": "Caballero 2022, An approximation to determine the source of the WOW! Signal, Int. J. Astrobiology (arXiv:2011.06090)",
    "simbad": "SIMBAD (Wenger et al. 2000) parallax, Gaia DR3 for the stars",
}

# (message, send date, target display name, SIMBAD identifier, transmitter, source)
MESSAGES = [
    ("Arecibo message", "1974-11-16", "M13", "M 13", "Arecibo 305 m radar", "zaitsev06"),
    ("Cosmic Call 1", "1999-05-24", "16 Cyg A", "HD 186408", "Evpatoria RT-70", "zaitsev06"),
    ("Cosmic Call 1", "1999-06-30", "15 Sge", "HD 190406", "Evpatoria RT-70", "zaitsev06"),
    ("Cosmic Call 1", "1999-06-30", "HD 178428", "HD 178428", "Evpatoria RT-70", "zaitsev06"),
    ("Cosmic Call 1", "1999-07-01", "HD 190360", "HD 190360", "Evpatoria RT-70", "zaitsev06"),
    ("Teen Age Message", "2001-08-29", "HD 197076", "HD 197076", "Evpatoria RT-70", "zaitsev06"),
    ("Teen Age Message", "2001-09-03", "47 UMa", "HD 95128", "Evpatoria RT-70", "zaitsev06"),
    ("Teen Age Message", "2001-09-03", "37 Gem", "HD 50692", "Evpatoria RT-70", "zaitsev06"),
    ("Teen Age Message", "2001-09-03", "HD 126053", "HD 126053", "Evpatoria RT-70", "zaitsev06"),
    ("Teen Age Message", "2001-09-04", "HD 76151", "HD 76151", "Evpatoria RT-70", "zaitsev06"),
    ("Teen Age Message", "2001-09-04", "HD 193664", "HD 193664", "Evpatoria RT-70", "zaitsev06"),
    ("Cosmic Call 2", "2003-07-06", "HIP 4872", "HIP 4872", "Evpatoria RT-70", "zaitsev06"),
    ("Cosmic Call 2", "2003-07-06", "HD 245409", "HD 245409", "Evpatoria RT-70", "zaitsev06"),
    ("Cosmic Call 2", "2003-07-06", "55 Cnc", "HD 75732", "Evpatoria RT-70", "zaitsev06"),
    ("Cosmic Call 2", "2003-07-06", "HD 10307", "HD 10307", "Evpatoria RT-70", "zaitsev06"),
    ("Cosmic Call 2", "2003-07-06", "47 UMa", "HD 95128", "Evpatoria RT-70", "zaitsev06"),
    ("Across the Universe", "2008-02-04", "Polaris", "HIP 11767", "NASA Deep Space Network", "wiki"),
    ("A Message From Earth", "2008-10-09", "Gliese 581", "HIP 74995", "Evpatoria RT-70", "wiki"),
    ("Hello From Earth", "2009-08-28", "Gliese 581", "HIP 74995", "NASA DSN Canberra", "wiki"),
    ("RuBisCo Stars", "2009-11-07", "GJ 83.1", "GJ 83.1", "", "wiki"),
    ("RuBisCo Stars", "2009-11-07", "Teegarden's Star", "NAME Teegarden's Star", "", "wiki"),
    ("RuBisCo Stars", "2009-11-07", "kappa1 Ceti", "GJ 137", "", "wiki"),
    ("Wow! Reply", "2012-08-15", "HIP 34511", "HIP 34511", "Arecibo 305 m", "wiki"),
    ("Wow! Reply", "2012-08-15", "37 Gem", "HD 50692", "Arecibo 305 m", "wiki"),
    ("Wow! Reply", "2012-08-15", "55 Cnc", "HD 75732", "Arecibo 305 m", "wiki"),
    ("Lone Signal", "2013-07-10", "GJ 526", "HD 119850", "Jamesburg Earth Station", "wiki"),
    ("JAXA Space Camp UDSC-1", "2013-09-22", "55 Cnc", "HD 75732", "JAXA Usuda", "wiki"),
    ("JAXA Space Camp UDSC-2", "2014-08-23", "55 Cnc", "HD 75732", "JAXA Usuda", "wiki"),
    ("A Simple Response to an Elemental Message", "2016-10-10", "Polaris", "HIP 11767", "ESA Cebreros", "wiki"),
    ("Sonar Calling GJ 273b", "2017-10-16", "Luyten's Star", "HIP 36208", "EISCAT Tromso", "wiki"),
    ("CALL to the COSMOS'83", "1983-08-15", "Altair", "HIP 97649", "Usuda / ISAS", "wiki"),
]
WOW_STAR = "Gaia DR3 6766185791864654720"  # = 2MASS J19281982-2640123 (Gaia DR3 cone match, 0.3 arcsec)
TRANSMITTER_NOTE = "transmitter as commonly reported; not used for any number"


def simbad(idents: list[str]) -> pd.DataFrame:
    q = ("SELECT i.id AS ident, b.main_id, b.ra, b.dec, b.plx_value, b.plx_err, b.plx_bibcode FROM ident AS i "
         "JOIN basic AS b ON i.oidref = b.oid WHERE i.id IN (" + ",".join("'" + x.replace("'", "''") + "'" for x in idents) + ")")
    df = tap_sync(SIMBAD_TAP, q)
    df["ident"] = df["ident"].str.split().str.join(" ")
    return df.drop_duplicates("ident").set_index("ident")


def years_between(a: dt.date, b: dt.date) -> float:
    return (Time(b.isoformat()) - Time(a.isoformat())).to_value(u.yr)  # Julian years: 1 ly per yr


def check_wiki(text: str) -> list[str]:
    """Each 'wiki' message's send date must appear in the fetched wikitext (guards against edits)."""
    bad = []
    for msg, date, *_rest, src in MESSAGES:
        if src == "wiki" and date not in text:
            bad.append(f"{msg} {date}")
    return bad


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--as-of", default=dt.date.today().isoformat(), help="light-front epoch (default: today)")
    a = ap.parse_args()
    started = utcnow()
    as_of = dt.date.fromisoformat(a.as_of)
    src = CACHE / NAME
    wiki = download(WIKI, src / "active_seti.wikitext", a.refresh).read_text()
    wiki_bad = check_wiki(wiki)
    bv = download(BV21_URL, src / "baumgardt_orbits_table.txt", a.refresh).read_text()
    m13 = re.search(r"^NGC_6205\s+(\S+)\s+(\S+)\s+\S+\s+\S+\s+(\S+)\s+(\S+)", bv, re.M)
    m13_kpc, m13_err = float(m13[3]), float(m13[4])

    ids = sorted({m[3] for m in MESSAGES})
    sb = simbad(ids)
    missing = [i for i in ids if i not in sb.index]
    assert not missing, f"SIMBAD did not resolve {missing}"

    entries = []
    for msg, date, tname, ident, tx, srck in MESSAGES:
        s = sb.loc[ident]
        if ident == "M 13":
            tdist_pc, dref = m13_kpc * 1e3, REF["bv21"]
        else:
            tdist_pc, dref = 1000.0 / float(s.plx_value), f"SIMBAD parallax {float(s.plx_value):.4f} mas ({s.plx_bibcode})"
        sent = dt.date.fromisoformat(date)
        front_ly = years_between(sent, as_of)
        target_ly = tdist_pc * LY_PER_PC
        front_pc = front_ly / LY_PER_PC
        multi = sum(m[0] == msg for m in MESSAGES) > 1
        name = f"{msg} → {tname}" if multi else msg
        alt = [msg] if multi else [f"{msg} → {tname}"]
        if msg == "Arecibo message":
            alt += ["Arecibo message 1974", "Arecibo"]
        facts = {"sent": date, "target": f"{tname} ({' '.join(s.main_id.split())})",
                 "target_dist_ly": sig(target_ly, 4), "light_front_ly": round(front_ly, 2), "as_of": as_of.isoformat(),
                 "arrival_year": int(round(sent.year + (sent.timetuple().tm_yday - 1) / 365.25 + target_ly)),
                 "reached_target": bool(front_ly >= target_ly), "note": NO_ET}
        if tx:
            facts["transmitter"] = tx
        e = {"name": name, "alt": alt, "kind": "message", "ra": round(float(s.ra), 5), "dec": round(float(s.dec), 5),
             "dist_pc": sig(front_pc, 6), "mag": None, "xyz": xyz_list(float(s.ra), float(s.dec), front_pc),
             "ref": REF[srck] + ("; " + REF["naic75"] if msg == "Arecibo message" else ""),
             "facts": facts, "facts_ref": {"target_dist_ly": dref, "sent": REF[srck], "transmitter": TRANSMITTER_NOTE},
             "position_note": "marker = current light front (target direction, distance c x time since sending, as_of date)"}
        if msg == "Arecibo message":
            e["docs"] = "arecibo-message"
        entries.append(e)

    # --- Wow! signal ------------------------------------------------------------------------------
    b1950 = {"positive horn": "19h22m25s", "negative horn": "19h25m17s"}
    for horn, ra_s in b1950.items():
        c = SkyCoord(ra_s, "-27d03m", frame=FK4(equinox="B1950", obstime="B1950")).transform_to(ICRS())
        entries.append({
            "name": f"Wow! signal ({horn})", "alt": ["Wow! signal", "Wow signal", "Big Ear 1977", f"Wow! {horn}"],
            "kind": "seti_signal", "ra": round(c.ra.deg, 4), "dec": round(c.dec.deg, 4), "dist_pc": None, "mag": None,
            "xyz": None, "docs": "wow-signal", "ref": REF["ehman98"],
            "facts": {"detected": "1977-08-15", "telescope": "Big Ear, Ohio State University",
                      "position_b1950": f"RA {ra_s} ± 10 s, Dec -27°03′ ± 20′ ({horn})",
                      "revised_field_j2000": "RA 19h25m02s or 19h27m55s ± 3 s, Dec -26°57′ ± 20′",
                      "frequency_mhz": [1420.726, 0.005], "peak_flux_jy": "> 250", "duration_s": 72,
                      "repeat_detections": 0,
                      "status": "seen once, never again; Mendez et al. favour a natural hydrogen-line flare. " + NO_ET},
            "facts_ref": {"position_b1950": REF["ehman98"], "revised_field_j2000": REF["mendez25"],
                          "frequency_mhz": REF["mendez25"], "peak_flux_jy": REF["mendez25"],
                          "duration_s": REF["ehman98"], "status": REF["mendez24"]},
            "position_note": "direction only: the source distance is unknown; B1950 -> ICRS with astropy"})
    # the candidate star is not in SIMBAD: Gaia DR3 + Bailer-Jones (2021) geometric distance from VizieR
    gid = WOW_STAR.split()[-1]
    g, g_url = fetch_vizier("I/355/gaiadr3", src / "wow_star_gaiadr3.tsv", ["Source", "RA_ICRS", "DE_ICRS", "Plx", "e_Plx"],
                            extra={"Source": gid}, refresh=a.refresh)
    bj, bj_url = fetch_vizier("I/352/gedr3dis", src / "wow_star_bj21.tsv", ["Source", "rgeo", "b_rgeo", "B_rgeo"],
                              extra={"Source": gid}, refresh=a.refresh)
    assert len(g) == 1 and len(bj) == 1, (len(g), len(bj))
    ra_w, de_w, plx_w, eplx_w = (float(g.iloc[0][c]) for c in ("RA_ICRS", "DE_ICRS", "Plx", "e_Plx"))
    d_pc, d_lo, d_hi = (float(bj.iloc[0][c]) for c in ("rgeo", "b_rgeo", "B_rgeo"))
    entries.append({
        "name": "2MASS J19281982-2640123", "alt": ["Wow! candidate star", "Wow! signal candidate Sun-like star", WOW_STAR],
        "kind": "seti_signal", "ra": round(ra_w, 5), "dec": round(de_w, 5), "dist_pc": sig(d_pc, 4), "mag": None,
        "xyz": xyz_list(ra_w, de_w, d_pc), "docs": "wow-signal", "ref": REF["caballero22"],
        "dist_lo_pc": sig(d_lo, 4), "dist_hi_pc": sig(d_hi, 4),
        "facts": {"role": "the one Sun-like star (Gaia data) in the Wow! field (Caballero 2022): a target, not a detection",
                  "dist_ly": sig(d_pc * LY_PER_PC, 3), "note": NO_ET},
        "facts_ref": {"dist_ly": f"Bailer-Jones et al. 2021 geometric distance (Gaia EDR3; DR3 parallax {plx_w:.4f} ± {eplx_w:.4f} mas)"}})

    size = write_catalog_json(CATS / f"{NAME}.json", entries)
    prov = {"catalog": f"data/tiles/catalogs/{NAME}.json", "bytes": size, "started_utc": started, "finished_utc": utcnow(),
            "as_of": as_of.isoformat(), "statement": NO_ET,
            "counts": {"messages": sum(e["kind"] == "message" for e in entries),
                       "distinct_message_projects": len({m[0] for m in MESSAGES}),
                       "seti_signal": sum(e["kind"] == "seti_signal" for e in entries)},
            "wiki_check_missing_dates": wiki_bad,
            "service": {"wikipedia": WIKI, "simbad_tap": SIMBAD_TAP, "bv21": BV21_URL, "gaia_dr3": g_url, "bj21": bj_url},
            "light_front": "light_front_ly = Julian years between the send date and as_of (1 ly per yr); marker at that "
                           "distance toward the target",
            "skipped": "Breakthrough Listen nearby-star list (Isaacson et al. 2017): no matching kind in the content contract",
            "citations": list(REF.values())}
    write_provenance(NAME, prov)
    print(f"{NAME}: {len(entries)} entries, {size} B, as_of {as_of}; wiki dates not found: {wiki_bad}")


if __name__ == "__main__":
    main()
