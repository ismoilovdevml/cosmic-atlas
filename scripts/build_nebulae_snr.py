#!/usr/bin/env python
"""nebulae-snr.json: nebulae (kind `nebula`) and supernova remnants (kind `snr`).

PROVENANCE
  Nebulae: OpenNGC (Verga, tag v20260501, CC-BY-SA-4.0) objects of type PN, HII, EmN, RfN, Neb and
      Cl+N (NGC.csv + addendum.csv), positions from SIMBAD (Harvard mirror), else OpenNGC.
      Distances, first rule that applies:
        1. literature override (LIT below: Orion Nebula, Kounkel et al. 2017 VLBA);
        2. planetary nebulae: Gaia EDR3 central-star distance of Gonzalez-Santamaria et al. 2021
           (A&A 656, A51; VizieR J/A+A/656/A51 tablea1+tablea2), matched by name or within 1 arcmin;
        3. SIMBAD mesDistance (median of parallax-based entries, else of entries since 2010, else all);
        4. SIMBAD parallax with plx/err >= 5;
        5. the SIMBAD parent (h_link, <= 2 levels): its mesDistance, e.g. a host galaxy for HII regions
           in M33 (flagged in dist_method).
      Frew et al. 2016 (MNRAS 455, 1459) is not on the VizieR mirror and is not used.
  Supernova remnants: Green's catalogue, "2024 October version" (310 SNRs; Green 2025, JApA 46, 14),
      summary table https://www.mrao.cam.ac.uk/surveys/snrs/snrs.data.html. Green gives no
      distances; they come from Ranasinghe & Leahy 2023 (ApJS 265, 53; VizieR J/ApJS/265/53, column
      X = heliocentric distance, matched by Galactic name), except LIT overrides (Crab: VLBI parallax
      of the Crab pulsar, Lin et al. 2023; R&L list 3.37 kpc for G184.6-5.8). OpenNGC objects of type
      SNR lying inside a Green remnant are merged into it as aliases (M1, NGC 1952, NGC 6960 ...);
      the others (LMC remnants) are kept as their own entries with a SIMBAD distance.

Output: data/tiles/catalogs/nebulae-snr.json, provenance in data/tiles/catalogs/provenance/.
Usage: .venv/bin/python scripts/build_nebulae_snr.py [--refresh]
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
from catio import (CACHE, CATS, SIMBAD_TAP, download, fetch_vizier, num, sig, utcnow,  # noqa: E402
                   write_catalog_json, write_provenance)
from coords import xyz_list  # noqa: E402
from build_named import (OPENNGC, OPENNGC_TAG, openngc_id, pick_mesdist, simbad_basic, simbad_mesdist,  # noqa: E402
                         simbad_parents, simbad_resolve)

NAME = "nebulae-snr"
GREEN_URL = "https://www.mrao.cam.ac.uk/surveys/snrs/snrs.data.html"
NEB_TYPES = {"PN": "planetary", "HII": "HII region", "EmN": "emission", "RfN": "reflection", "Neb": "nebula",
             "Cl+N": "cluster + nebula"}
CIT = {
    "openngc": ("Verga, OpenNGC " + OPENNGC_TAG + " (CC-BY-SA-4.0)", None),
    "gs21": ("Gonzalez-Santamaria et al. 2021, A&A 656, A51 (PN central stars in Gaia EDR3)", None),
    "simbad": ("Wenger et al. 2000, A&AS 143, 9 (SIMBAD mesDistance)", "10.1051/aas:2000332"),
    "green": ("Green 2025, JApA 46, 14 (Catalogue of Galactic SNRs, 2024 October version; arXiv:2411.03367)", None),
    "rl23": ("Ranasinghe & Leahy 2023, ApJS 265, 53 (SNR distances)", None),
    "kounkel17": ("Kounkel et al. 2017, ApJ 834, 142 (VLBA distance to the ONC, 388 +- 5 pc)", "10.3847/1538-4357/834/2/142"),
    "lin23": ("Lin et al. 2023, arXiv:2306.01617 (Crab pulsar VLBI parallax 0.53 +- 0.06 mas, d = 1.90 +0.22 -0.18 kpc)", None),
}
# literature distances (pc): key = OpenNGC name or Green G-name
LIT = {"NGC1976": (388.0, 383.0, 393.0, "kounkel17"), "NGC1982": (388.0, 383.0, 393.0, "kounkel17"),
       "G184.6-5.8": (1900.0, 1720.0, 2120.0, "lin23")}
DOCS = {"G184.6-5.8": "crab-nebula"}
DISPLAY = {"Kepler": "Kepler's SNR", "Tycho": "Tycho's SNR", "Vela (XYZ)": "Vela SNR"}
EXTRA_ALIASES = {"Cassiopeia A": ["Cas A"], "Vela SNR": ["Vela supernova remnant"], "Crab Nebula": ["Taurus A"]}
PARENT_MAX_DEG = 10.0  # a SIMBAD parent farther than this from the object is a bad link, not used


def gnum(x: str):
    """Green table cell -> number when plain, else the text (keeps '?' uncertainty flags)."""
    try:
        return float(x) if x.strip() else None
    except ValueError:
        return x


def tidy(n: str) -> str:
    """'IC443' -> 'IC 443' (Green writes some catalogue names without a space)."""
    return re.sub(r"^(IC|NGC)(?=\d)", lambda m: m[1] + " ", n)


def cite(k):
    r, d = CIT[k]
    return {"ref": r, **({"doi": d} if d else {})}


# --------------------------------------------------------------------------------- Green 2024
def parse_green(page: str) -> pd.DataFrame:
    pre = re.search(r"<PRE>(.*?)</PRE>", page, re.S | re.I)[1]
    rows = []
    for ln in pre.splitlines():
        m = re.match(r'\s*<A HREF="snrs\.(G[^"]+)\.html">\s*([\d.]+)\s+([-+][\d.]+)</A>\s+(\d\d) (\d\d) (\d\d)\s+([-+]\d\d) (\d\d)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*(.*)$', ln)
        if not m:
            continue
        g, l, b, rh, rm, rs, dd, dm, size, typ, flux, idx, other = m.groups()
        ax = [float(x) for x in re.findall(r"[\d.]+", size)]
        rows.append({"gname": g, "l": float(l), "b": float(b), "ra_s": f"{rh} {rm} {rs}", "dec_s": f"{dd} {dm}",
                     "size": size, "maj_arcmin": max(ax) if ax else np.nan, "type": typ, "flux_1ghz_jy": flux,
                     "index": idx, "other": htmllib.unescape(other.strip())})
    df = pd.DataFrame(rows)
    c = SkyCoord(df["ra_s"].tolist(), df["dec_s"].tolist(), unit=(u.hourangle, u.deg))
    df["ra"], df["dec"] = c.ra.deg, c.dec.deg
    return df


def gkey(l: float, b: float) -> str:
    return f"{l:.1f}{b:+.1f}"


def snr_entries(refresh: bool) -> tuple[pd.DataFrame, dict]:
    src = CACHE / NAME
    page = download(GREEN_URL, src / "green_snrs.data.html", refresh).read_text(errors="replace")
    version = re.search(r"(\d{4} \w+ version)", page)
    g = parse_green(page)
    rl, rl_url = fetch_vizier("J/ApJS/265/53/table1", src / "rl23_table1.tsv",
                              ["SNR", "l_X", "X", "f_X", "e_X", "E_X", "_Glon", "_Glat"], refresh=refresh)
    ext = rl["SNR"].str.extract(r"G(\d+\.\d)([-+]\d+\.\d)")
    rl["key"] = [gkey(float(lv), float(bv)) for lv, bv in ext.itertuples(index=False, name=None)]
    rl = rl.drop_duplicates("key").set_index("key")
    rec = []
    for r in g.itertuples():
        k = gkey(r.l, r.b)
        d = lo = hi = None
        how = ""
        if r.gname in LIT:
            d, lo, hi, ck = LIT[r.gname]
            how = CIT[ck][0]
        elif k in rl.index:
            x = rl.loc[k]
            xv = pd.to_numeric(x["X"], errors="coerce")
            if np.isfinite(xv) and x["l_X"].strip() in ("", "="):
                d = xv * 1e3
                el, eh = pd.to_numeric(x["e_X"], errors="coerce"), pd.to_numeric(x["E_X"], errors="coerce")
                lo = (xv - el) * 1e3 if np.isfinite(el) else None
                hi = (xv + eh) * 1e3 if np.isfinite(eh) else None
                how = CIT["rl23"][0] + (f" (flag {x['f_X'].strip()})" if x["f_X"].strip() else "")
        rec.append({"gname": r.gname, "ra": r.ra, "dec": r.dec, "dist_pc": d, "lo": lo, "hi": hi, "how": how,
                    "size": r.size, "maj": r.maj_arcmin, "type": r.type, "flux": r.flux_1ghz_jy, "index": r.index,
                    "other": [x.strip() for x in r.other.split(",") if x.strip()]})
    df = pd.DataFrame(rec)
    return df, {"green_version": version[1] if version else None, "green_rows": len(g), "rl23_url": rl_url,
                "green_with_distance": int(df["dist_pc"].notna().sum())}


# ------------------------------------------------------------------------------------ OpenNGC
def openngc(refresh: bool) -> pd.DataFrame:
    src = CACHE / NAME / "openngc"
    ngc = pd.read_csv(download(OPENNGC + "NGC.csv", src / "NGC.csv", refresh), sep=";", dtype=str)
    add = pd.read_csv(download(OPENNGC + "addendum.csv", src / "addendum.csv", refresh), sep=";", dtype=str)
    a = pd.concat([ngc, add], ignore_index=True)
    sel = a[a["Type"].isin(list(NEB_TYPES) + ["SNR"])].copy().reset_index(drop=True)
    sel["display"], sel["sb_ident"] = zip(*sel["Name"].map(openngc_id))
    mnum = pd.to_numeric(sel["M"], errors="coerce")
    sel["mname"] = ["M" + str(int(m)) if np.isfinite(m) else "" for m in mnum]  # "" = not Messier
    c = SkyCoord(sel["RA"].tolist(), sel["Dec"].tolist(), unit=(u.hourangle, u.deg))
    sel["ra_o"], sel["dec_o"] = c.ra.deg, c.dec.deg
    return sel


def gs21(refresh: bool) -> tuple[pd.DataFrame, str]:
    src = CACHE / NAME
    t1, url = fetch_vizier("J/A+A/656/A51/tablea1", src / "gs21_tablea1.tsv", ["PNG", "OName", "GaiaEDR3", "Group", "RA_ICRS", "DE_ICRS"],
                           refresh=refresh)
    t2, _ = fetch_vizier("J/A+A/656/A51/tablea2", src / "gs21_tablea2.tsv", ["PNG", "Plx", "e_Plx", "Dist", "b_Dist", "B_Dist"],
                         refresh=refresh)
    t = t1.merge(t2, on="PNG", how="inner")
    for col in ("Dist", "b_Dist", "B_Dist", "RA_ICRS", "DE_ICRS"):
        t[col] = num(t[col])
    return t[np.isfinite(t["Dist"])].reset_index(drop=True), url


def norm(s: str) -> str:
    return re.sub(r"\s+", "", str(s)).upper()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true")
    a = ap.parse_args()
    started = utcnow()
    snr, snr_stats = snr_entries(a.refresh)
    o = openngc(a.refresh)

    # --- SIMBAD for all OpenNGC objects ---------------------------------------------------------
    o["ident"] = [f"M {m[1:]}" if m else s for m, s in zip(o["mname"], o["sb_ident"])]
    sim = simbad_resolve(o["ident"].tolist() + o["sb_ident"].tolist()).set_index("ident")
    o["hit"] = [i if i in sim.index else (j if j in sim.index else "") for i, j in zip(o["ident"], o["sb_ident"])]
    for col in ("oid", "main_id", "ra", "dec", "plx_value", "plx_err", "plx_bibcode", "otype", "V"):
        o["sb_" + col] = [sim.loc[h, col] if h else np.nan for h in o["hit"]]
    o["ra"] = np.where(o["sb_ra"].notna(), o["sb_ra"], o["ra_o"]).astype(float)
    o["dec"] = np.where(o["sb_dec"].notna(), o["sb_dec"], o["dec_o"]).astype(float)
    oids = [int(x) for x in o["sb_oid"].dropna()]
    mes = simbad_mesdist(oids)
    mes_by = {k: v for k, v in mes.groupby("oidref")}

    # --- merge OpenNGC SNRs into Green remnants ---------------------------------------------------
    gc = SkyCoord(snr["ra"].to_numpy() * u.deg, snr["dec"].to_numpy() * u.deg)
    snr["alt_extra"] = [[] for _ in range(len(snr))]
    snr["mag"] = None
    standalone_snr, snr_retyped = [], []
    for k, r in o[o["Type"] == "SNR"].iterrows():
        sep = SkyCoord(r["ra"] * u.deg, r["dec"] * u.deg).separation(gc).arcmin
        inside = np.where(sep <= np.maximum(snr["maj"].fillna(1).to_numpy() / 2, 1.0))[0]
        if len(inside):
            j = inside[np.argmin(sep[inside])]
            names = [x for x in [r["mname"], r["display"]] if x] + \
                    [x.strip() for x in str(r.get("Common names") or "").split(",") if x.strip() and x != "nan"]
            snr.at[j, "alt_extra"] = snr.at[j, "alt_extra"] + names
            vm = pd.to_numeric(r["V-Mag"], errors="coerce")
            if np.isfinite(vm) and snr.at[j, "mag"] is None:
                snr.at[j, "mag"] = float(vm)
        else:
            standalone_snr.append(k)

    # --- PN distances (GS21) ----------------------------------------------------------------------
    pn, gs_url = gs21(a.refresh)
    pn_names = {}
    for i, nm in enumerate(pn["OName"]):
        for part in str(nm).split(","):
            pn_names.setdefault(norm(part), i)
    pnc = SkyCoord(pn["RA_ICRS"].to_numpy() * u.deg, pn["DE_ICRS"].to_numpy() * u.deg)

    # parents for the fallback (HII regions in other galaxies, nebulae inside named complexes)
    anc = simbad_parents(oids)
    pb = simbad_basic([x for v in anc.values() for x in v])
    pmes = simbad_mesdist(pb.index.tolist()) if len(pb) else pd.DataFrame(columns=["oidref"])
    pmes_by = {k: v for k, v in pmes.groupby("oidref")}

    def neb_distance(r) -> tuple:
        if r["Name"] in LIT:
            d, lo, hi, ck = LIT[r["Name"]]
            return d, lo, hi, CIT[ck][0]
        if r["Type"] == "PN":
            cand = [norm(r["display"])] + ([norm(r["mname"])] if r["mname"] else [])
            idx = next((pn_names[c] for c in cand if c in pn_names), None)
            if idx is None:
                sep = SkyCoord(r["ra"] * u.deg, r["dec"] * u.deg).separation(pnc).arcmin
                if sep.min() <= 1.0:
                    idx = int(np.argmin(sep))
            if idx is not None:
                p = pn.iloc[idx]
                return float(p.Dist), float(p.b_Dist), float(p.B_Dist), \
                    f"{CIT['gs21'][0]}: {p.PNG}, Gaia EDR3 {p.GaiaEDR3} (group {p.Group})"
        oid = int(r["sb_oid"]) if pd.notna(r["sb_oid"]) else None
        if oid in mes_by:
            pk = pick_mesdist(mes_by[oid])
            if pk:
                return pk[0], None, None, pk[1]
        p, e = r["sb_plx_value"], r["sb_plx_err"]
        if pd.notna(p) and pd.notna(e) and p > 0 and p / e >= 5:
            return 1000 / p, 1000 / (p + e), 1000 / (p - e), f"SIMBAD parallax ({r['sb_plx_bibcode']})"
        for par in anc.get(oid, []) if oid else []:
            if par in pb.index and SkyCoord(r["ra"] * u.deg, r["dec"] * u.deg).separation(
                    SkyCoord(float(pb.loc[par, "ra"]) * u.deg, float(pb.loc[par, "dec"]) * u.deg)).deg > PARENT_MAX_DEG:
                continue
            if par in pmes_by:
                pk = pick_mesdist(pmes_by[par])
                if pk:
                    pname = " ".join(str(pb.loc[par, "main_id"]).split()) if par in pb.index else str(par)
                    return pk[0], None, None, f"parent {pname} (SIMBAD hierarchy): {pk[1]}"
        return None, None, None, ""

    entries = []
    # nebulae
    for k, r in o[o["Type"] != "SNR"].iterrows():
        d, lo, hi, how = neb_distance(r)
        name = r["mname"] or r["display"]
        common = [x.strip() for x in str(r.get("Common names") or "").split(",") if x.strip() and x != "nan"]
        alt = ([r["display"]] if r["mname"] else []) + common
        if isinstance(r["sb_main_id"], str):
            mid = " ".join(r["sb_main_id"].split())
            if mid.replace(" ", "") not in (name.replace(" ", ""), r["display"].replace(" ", "")) and not mid.startswith("NAME"):
                alt.append(mid)
        vm = pd.to_numeric(r["V-Mag"], errors="coerce")
        facts = {"type": NEB_TYPES[r["Type"]]}
        if np.isfinite(pd.to_numeric(r["MajAx"], errors="coerce")):
            facts["size_arcmin"] = sig(float(r["MajAx"]), 3)
        entries.append({"name": name, "alt": list(dict.fromkeys(alt)), "kind": "nebula", "ra": round(float(r["ra"]), 5),
                        "dec": round(float(r["dec"]), 5), "dist_pc": sig(d, 4), "mag": sig(vm, 3) if np.isfinite(vm) else None,
                        "xyz": xyz_list(r["ra"], r["dec"], d) if d else None, "ref": "OpenNGC / " + (how.split(":")[0].split(" (")[0] if how else "no distance"),
                        "dist_lo_pc": sig(lo, 4), "dist_hi_pc": sig(hi, 4), "dist_method": how or None, "facts": facts,
                        "openngc_type": r["Type"]})
    # SNRs (Green)
    for r in snr.itertuples():
        other = [tidy(x) for x in r.other]
        disp = DISPLAY.get(other[0], other[0]) if other else r.gname
        other += EXTRA_ALIASES.get(disp, [])
        alt = list(dict.fromkeys(([r.gname] if disp != r.gname else []) + [f"SNR {r.gname}"] + other + list(r.alt_extra)))
        alt = [x for x in alt if x != disp]
        facts = {"type": {"S": "shell", "F": "filled-centre (plerion)", "C": "composite"}.get(r.type.rstrip("?"), r.type),
                 "size_arcmin": gnum(r.size), "flux_1ghz_jy": gnum(r.flux), "spectral_index": gnum(r.index)}
        facts = {k: v for k, v in facts.items() if v is not None}
        e = {"name": disp, "alt": alt, "kind": "snr", "ra": round(float(r.ra), 4), "dec": round(float(r.dec), 4),
             "dist_pc": sig(r.dist_pc, 4), "mag": r.mag, "xyz": xyz_list(r.ra, r.dec, r.dist_pc) if r.dist_pc else None,
             "ref": CIT["green"][0] + (" / " + ("Lin et al. 2023" if r.gname == "G184.6-5.8" else "Ranasinghe & Leahy 2023") if r.dist_pc else ""),
             "dist_lo_pc": sig(r.lo, 4), "dist_hi_pc": sig(r.hi, 4), "dist_method": r.how or None, "facts": facts,
             "facts_ref": {k: CIT["green"][0] for k in facts if k != "type"}}
        if r.gname in DOCS:
            e["docs"] = DOCS[r.gname]
        entries.append(e)
    # OpenNGC SNRs outside the Galaxy (not in Green)
    for k in standalone_snr:
        r = o.loc[k]
        d, lo, hi, how = neb_distance(r)
        # OpenNGC calls it SNR but SIMBAD does not (NGC 6334 is the Cat's Paw HII region): a nebula
        is_snr = str(r["sb_otype"]).strip() in ("SNR", "SNR?")
        if not is_snr:
            snr_retyped.append(r["display"])
        entries.append({"name": r["display"], "alt": [], "kind": "snr" if is_snr else "nebula", "ra": round(float(r["ra"]), 5), "dec": round(float(r["dec"]), 5),
                        "dist_pc": sig(d, 4), "mag": None, "xyz": xyz_list(r["ra"], r["dec"], d) if d else None,
                        "ref": "OpenNGC / " + (how.split(":")[0] if how else "no distance"), "dist_method": how or None,
                        "facts": {"type": "supernova remnant (not in Green's Galactic catalogue)" if is_snr
                                  else f"nebula (OpenNGC type SNR, SIMBAD type {str(r['sb_otype']).strip()})"}})

    size = write_catalog_json(CATS / f"{NAME}.json", entries, drop_none=True)
    neb = [e for e in entries if e["kind"] == "nebula"]
    sn = [e for e in entries if e["kind"] == "snr"]
    how = pd.Series([(e.get("dist_method") or "none").split(":")[0].split(" (")[0] for e in neb]).value_counts()
    prov = {"catalog": f"data/tiles/catalogs/{NAME}.json", "bytes": size, "started_utc": started, "finished_utc": utcnow(),
            "service": {"openngc": OPENNGC, "green": GREEN_URL, "simbad_tap": SIMBAD_TAP, "gs21": gs_url},
            "counts": {"nebulae": len(neb), "nebulae_with_distance": sum(e.get("dist_pc") is not None for e in neb),
                       "nebulae_by_type": o[o["Type"] != "SNR"]["Type"].value_counts().to_dict(),
                       "nebula_distance_sources": {k: int(v) for k, v in how.items()},
                       "snr": len(sn), "snr_with_distance": sum(e.get("dist_pc") is not None for e in sn),
                       "openngc_snr_merged_into_green": int((o["Type"] == "SNR").sum()) - len(standalone_snr),
                       "openngc_snr_standalone": len(standalone_snr), "openngc_snr_retyped_nebula": snr_retyped, **snr_stats},
            "literature_overrides": {k: {"dist_pc": v[0], "lo": v[1], "hi": v[2], **cite(v[3])} for k, v in LIT.items()},
            "no_distance": [e["name"] for e in entries if e.get("dist_pc") is None][:400],
            "citations": [cite(k) for k in CIT]}
    write_provenance(NAME, prov)
    print(f"{NAME}: {len(entries)} entries ({len(neb)} nebulae, {prov['counts']['nebulae_with_distance']} with distance; "
          f"{len(sn)} SNR, {prov['counts']['snr_with_distance']} with distance); {size} B")
    print(prov["counts"])


if __name__ == "__main__":
    main()
