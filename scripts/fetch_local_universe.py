#!/usr/bin/env python
"""Local Universe layers with redshift-independent distances.

  local-group  : McConnachie (2012) "Nearby dwarf galaxies", author-updated version
                 NearbyGalaxies_Jan2021_PUBLIC.fits (latest online, CADC), names/SIMBAD ids from
                 VizieR J/AJ/144/4; M31 (dropped from the update in Oct 2019) re-added from J/AJ/144/4;
                 Milky Way centre added from GRAVITY 2021. kind = lg_galaxy.
  local-volume : Karachentsev+ (2013) Updated Nearby Galaxy Catalog (UNGC), VizieR J/AJ/145/101.
                 kind = galaxy. (The live LV database sao.ru/lv/lvgdb returned HTTP 404 on 2026-11-13.)
  galaxies-cf4 : Cosmicflows-4 (Tully+ 2023) individual-galaxy distance moduli, VizieR J/ApJ/944/94/table2
                 (~56k galaxies, redshift-independent: TF, FP, SNIa, SBF, TRGB, Cepheid, SNII, masers).
                 Also the fallback distance for low-z 2MRS galaxies and for build_named.py.
  galaxies-2mrs: 2MASS Redshift Survey (Huchra+ 2012), VizieR J/ApJS/199/26/table3; Planck18 comoving
                 distance from heliocentric cz; for cz/c < 0.003 the redshift-independent distance of the
                 matching galaxy (UNGC measured/group > McConnachie > CF4, <= 1 arcmin) is used, otherwise
                 the row is dropped.

Outputs: data/raw/<layer>/<layer>.parquet + PROVENANCE.json, data/tiles/catalogs/<layer>.json
Usage: .venv/bin/python scripts/fetch_local_universe.py [--refresh] [--skip-2mrs]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from astropy.coordinates import SkyCoord
import astropy.units as u
from astropy.table import Table

sys.path.insert(0, str(Path(__file__).resolve().parent))
from catio import ROOT, download, fetch_vizier, num, utcnow, write_catalog_json  # noqa: E402
from coords import C_KMS, comoving_pc, distmod_to_pc, galactic_xyz, xyz_list  # noqa: E402

RAW = ROOT / "data" / "raw"
CATS = ROOT / "data" / "tiles" / "catalogs"
MCC_URL = "https://www.cadc-ccda.hia-iha.nrc-cnrc.gc.ca/files/vault/PANDAS/NearbyGals/NearbyGalaxies_Jan2021_PUBLIC.fits"
MCC_LOG = "https://www.cadc-ccda.hia-iha.nrc-cnrc.gc.ca/files/vault/PANDAS/NearbyGals/Update.log"
MCC_PAGE = "https://www.cadc-ccda.hia-iha.nrc-cnrc.gc.ca/en/community/nearby/"
GC_R0_PC = 8275.0  # GRAVITY Collaboration 2021, A&A 647, A59: R0 = 8275 +- 9 (stat) +- 33 (sys) pc
GC_R0_ERR = 34.0

CIT_MCC = {"ref": "McConnachie 2012, AJ 144, 4 (catalogue updated by the author, Jan 2021)",
           "doi": "10.1088/0004-6256/144/1/4"}
CIT_UNGC = {"ref": "Karachentsev, Makarov & Kaisina 2013, AJ 145, 101 (UNGC)", "doi": "10.1088/0004-6256/145/4/101"}
CIT_2MRS = {"ref": "Huchra et al. 2012, ApJS 199, 26 (2MASS Redshift Survey)", "doi": "10.1088/0067-0049/199/2/26"}
CIT_GRAV = {"ref": "GRAVITY Collaboration 2021, A&A 647, A59 (R0 = 8275 pc)", "doi": "10.1051/0004-6361/202040208"}
CIT_P18 = {"ref": "Planck Collaboration 2020, A&A 641, A6 (Planck18 cosmology)", "doi": "10.1051/0004-6361/201833910"}
CIT_CF4 = {"ref": "Tully et al. 2023, ApJ 944, 94 (Cosmicflows-4)", "doi": "10.3847/1538-4357/ac94d8"}
CIT_VIZ = {"ref": "VizieR (Ochsenbein, Bauer & Marcout 2000, A&AS 143, 23), CfA mirror", "doi": "10.1051/aas:2000169"}

UNGC_QUALITY = {  # Karachentsev+2013 Table 6 notes (arXiv:1303.5328)
    **{m: "measured" for m in ["TRGB", "Cep", "SN", "SBF", "TF", "BS", "CMD", "HB", "RR", "PNLF", "FP", "geom"]},
    "mem": "group", "h": "hubble", "h'": "hubble", "txt": "guess",
}


# ----------------------------------------------------------------------------- helpers
ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII",
         "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX"]
KEEP_ARABIC = ("Segue", "Willman", "HIZSS")


def pretty_lg_name(raw: str) -> str:
    """McConnachie compact names -> readable ('AndromedaXXI' -> 'Andromeda XXI', 'Leo1' -> 'Leo I')."""
    n = raw.lstrip("*").strip()
    n = re.sub(r"\((\d+|[A-Z])\)$", r"\1", n)  # Bootes(1) -> Bootes1, HIZSS3(A) -> HIZSS3A
    if re.match(r"^(NGC|IC|UGCA?|DDO|KK[HRs]?|ESO|GR|LGS|UKS|DESJ|HIZSS)", n):
        n = re.sub(r"^(NGC|IC|UGCA|UGC|DDO|KKH|KKR|KKs|KK|GR|LGS|UKS|HIZSS)(\d)", r"\1 \2", n)
        return n.replace("DESJ", "DES J")
    n = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", n)  # CamelCase split
    m = re.match(r"^(.*?[a-z])(\d+)([A-Z]?)$", n)
    if m:
        base, d, suf = m.groups()
        if base.startswith(KEEP_ARABIC) or int(d) >= len(ROMAN):
            n = f"{base} {d}{suf}"
        else:
            n = f"{base} {ROMAN[int(d)]}{suf}"
    return n.replace("dIrr", " dIrr").replace("dSph", " dSph").replace("  ", " ")


def sexa_to_deg(ra_s, dec_s) -> tuple[np.ndarray, np.ndarray]:
    c = SkyCoord([r.strip() for r in ra_s], [d.strip() for d in dec_s], unit=(u.hourangle, u.deg), frame="icrs")
    return c.ra.deg, c.dec.deg


def match_sky(ra1, dec1, ra2, dec2, radius_arcmin: float):
    """Nearest neighbour of each (ra1,dec1) in (ra2,dec2) within radius; returns idx (-1 = none), sep."""
    c1 = SkyCoord(ra1 * u.deg, dec1 * u.deg)
    c2 = SkyCoord(ra2 * u.deg, dec2 * u.deg)
    idx, sep, _ = c1.match_to_catalog_sky(c2)
    sep = sep.arcmin
    idx = np.where(sep <= radius_arcmin, idx, -1)
    return idx, sep


def contract_frame(df: pd.DataFrame) -> pd.DataFrame:
    """Enforce contract section 2 dtypes for the mandatory columns."""
    df = df.copy()
    df["id"] = df["id"].astype("string")
    for c in ["ra", "dec", "dist_pc", "dist_lo_pc", "dist_hi_pc"]:
        df[c] = df[c].astype("float64")
    for c in ["mag", "color"]:
        df[c] = df[c].astype("float32")
    df["kind"] = df["kind"].astype("category")
    return df


def write_layer(layer: str, df: pd.DataFrame, prov: dict) -> dict:
    out = RAW / layer
    out.mkdir(parents=True, exist_ok=True)
    df = contract_frame(df)
    dest = out / f"{layer}.parquet"
    df.to_parquet(dest, index=False, compression="zstd")
    prov = {"layer": layer, **prov, "rows": int(len(df)), "file": str(dest.relative_to(ROOT)),
            "file_bytes": dest.stat().st_size, "finished_utc": utcnow()}
    (out / "PROVENANCE.json").write_text(json.dumps(prov, indent=2, ensure_ascii=False))
    return prov


# ----------------------------------------------------------------------------- Local Group
def build_local_group(refresh: bool) -> tuple[pd.DataFrame, list[dict], dict]:
    out = RAW / "local-group"
    src = out / "source"
    fits_path = download(MCC_URL, src / "NearbyGalaxies_Jan2021_PUBLIC.fits", refresh)
    download(MCC_LOG, src / "Update.log", refresh)
    t = Table.read(fits_path, hdu=1)
    raw_names = [str(n).strip() for n in t["GalaxyName"]]
    ra, dec = sexa_to_deg(t["RA"], t["Dec"])
    dmod = np.asarray(t["dmod"], float)
    dp = np.asarray(t["dmod+"], float)
    dm = np.asarray(t["dmod-"], float)
    vmag = np.asarray(t["Vmag"], float)
    vh = np.asarray(t["vh"], float)
    ebv = np.asarray(t["EB-V"], float)
    for arr in (dmod, dp, dm, vmag, vh, ebv):
        arr[(arr >= 99) | (arr <= -99)] = np.nan  # 99.9 / 999 sentinels
    # 2012 VizieR table: spaced names + SIMBAD ids (and M31, removed from the 2019+ updates)
    v12, v12_url = fetch_vizier("J/AJ/144/4/catalog", src / "J_AJ_144_4_catalog.tsv",
                                ["Name", "OName", "SubG", "RAJ2000", "DEJ2000", "(m-M)", "E_(m-M)", "e_(m-M)",
                                 "Vmag", "HRV", "E(B-V)", "SimbadName"], refresh=refresh)
    v12_ra, v12_dec = num(v12["_RAJ2000"]), num(v12["_DEJ2000"])
    idx, sep = match_sky(ra, dec, v12_ra, v12_dec, 3.0)
    # one-to-one: a 2012 row may name only its closest update row (e.g. HIZSS 3A vs 3B)
    for j in set(idx[idx >= 0].tolist()):
        cand = np.where(idx == j)[0]
        if len(cand) > 1:
            idx[cand[cand != cand[np.argmin(sep[cand])]]] = -1

    rows = []
    for i, rn in enumerate(raw_names):
        j = idx[i]
        name = v12["Name"].iat[j] if j >= 0 else pretty_lg_name(rn)
        alt = [rn] if rn != name else []
        if j >= 0:
            for s in v12["OName"].iat[j].split(",") + [v12["SimbadName"].iat[j]]:
                s = s.strip()
                if s and s not in alt and s != name:
                    alt.append(s)
        pretty = pretty_lg_name(rn)
        if pretty != name and pretty not in alt:
            alt.append(pretty)
        rows.append({
            "id": f"McConnachie2012 {rn.lstrip('*')}", "name": name, "alt": alt,
            "ra": ra[i], "dec": dec[i], "dmod": dmod[i], "dmod_err_hi": dp[i], "dmod_err_lo": dm[i],
            "mag": vmag[i], "vh_kms": vh[i], "ebv": ebv[i], "source_star_flag": rn.startswith("*"),
            "subgroup": v12["SubG"].iat[j] if j >= 0 else "", "source": "McConnachie Jan2021 update",
        })
    added = []
    # galaxies present in 2012 but absent from the update: report all, re-add M31 only
    present = set(idx[idx >= 0].tolist())
    missing12 = [v12["Name"].iat[k] for k in range(len(v12)) if k not in present]
    for k in range(len(v12)):
        nm = v12["Name"].iat[k]
        if nm.strip() in ("Andromeda",) or v12["SimbadName"].iat[k].upper() in ("M 31", "MESSIER031", "M31"):
            mu = float(v12["(m-M)"].iat[k])
            rows.append({
                "id": "McConnachie2012 Andromeda", "name": "Andromeda (M31)",
                "alt": ["M31", "NGC 224", "UGC 454", nm], "ra": v12_ra[k], "dec": v12_dec[k], "dmod": mu,
                "dmod_err_hi": float(v12["E_(m-M)"].iat[k] or "nan"), "dmod_err_lo": float(v12["e_(m-M)"].iat[k] or "nan"),
                "mag": float(v12["Vmag"].iat[k] or "nan"), "vh_kms": float(v12["HRV"].iat[k] or "nan"),
                "ebv": float(v12["E(B-V)"].iat[k] or "nan"), "source_star_flag": False,
                "subgroup": v12["SubG"].iat[k], "source": "VizieR J/AJ/144/4 (2012; removed from the 2019+ updates)",
            })
            added.append(nm)
    df = pd.DataFrame(rows)
    df["dist_pc"] = distmod_to_pc(df["dmod"])
    df["dist_lo_pc"] = distmod_to_pc(df["dmod"] - df["dmod_err_lo"])
    df["dist_hi_pc"] = distmod_to_pc(df["dmod"] + df["dmod_err_hi"])
    # Milky Way: Galactic Centre (Sgr A*) at R0 from GRAVITY 2021
    gc = SkyCoord(l=0 * u.deg, b=0 * u.deg, frame="galactic").icrs
    sgra = SkyCoord("17h45m40.0409s", "-29d00m28.118s", frame="icrs")  # Sgr A* (Reid & Brunthaler 2004)
    mw = {"id": "MilkyWay", "name": "Milky Way (Galactic Centre)", "alt": ["The Galaxy", "Sgr A*", "MW"],
          "ra": sgra.ra.deg, "dec": sgra.dec.deg, "dmod": np.nan, "dmod_err_hi": np.nan, "dmod_err_lo": np.nan,
          "mag": np.nan, "vh_kms": np.nan, "ebv": np.nan, "source_star_flag": False, "subgroup": "MW",
          "source": "GRAVITY 2021 R0", "dist_pc": GC_R0_PC, "dist_lo_pc": GC_R0_PC - GC_R0_ERR,
          "dist_hi_pc": GC_R0_PC + GC_R0_ERR}
    df = pd.concat([pd.DataFrame([mw]), df], ignore_index=True)
    df["color"] = np.nan
    df["kind"] = "lg_galaxy"
    xyz = galactic_xyz(df["ra"].to_numpy(), df["dec"].to_numpy(), df["dist_pc"].to_numpy())
    df["x_pc"], df["y_pc"], df["z_pc"] = xyz[:, 0], xyz[:, 1], xyz[:, 2]

    entries = []
    for r in df.itertuples():
        e = {"name": r.name, "alt": r.alt, "kind": "lg_galaxy", "ra": round(r.ra, 5), "dec": round(r.dec, 5),
             "dist_pc": round(float(r.dist_pc), 1), "mag": None if not np.isfinite(r.mag) else round(float(r.mag), 2),
             "xyz": xyz_list(r.ra, r.dec, r.dist_pc),
             "ref": "GRAVITY 2021" if r.id == "MilkyWay" else
                    ("McConnachie 2012 (VizieR J/AJ/144/4)" if r.source.startswith("VizieR") else "McConnachie 2012, Jan 2021 update"),
             "dist_lo_pc": round(float(r.dist_lo_pc), 1), "dist_hi_pc": round(float(r.dist_hi_pc), 1)}
        if r.source_star_flag:
            e["flag"] = "asterisk in source (galaxy status uncertain)"
        entries.append(e)
    parquet_df = df.drop(columns=["name", "alt"]).assign(
        name=df["name"], alt=df["alt"].map(lambda a: "; ".join(a)))
    prov = {
        "service": [MCC_URL, v12_url],
        "page": MCC_PAGE,
        "started_utc": None,
        "selection": "all 144 rows of NearbyGalaxies_Jan2021_PUBLIC.fits + M31 from J/AJ/144/4 (removed in the "
                     "Oct 2019 update) + Milky Way centre (GRAVITY 2021 R0)",
        "distance": "dist_pc = 10^((m-M)_0/5+1); lo/hi from the asymmetric (m-M) errors; 99.9/999 sentinels -> NaN",
        "names": "2012 VizieR Name (sky match <= 3 arcmin) else de-camel-cased update name",
        "missing_from_update_vs_2012": missing12,
        "re_added": added,
        "mag": "apparent V (Vega), not extinction corrected (E(B-V) in column ebv)",
        "asterisk_flag": "names prefixed '*' in the update; meaning not documented in the file (appears to mark "
                         "systems of uncertain nature, e.g. Canis Major, Bootes III) - unverified",
        "citations": [CIT_MCC, CIT_GRAV, CIT_VIZ],
    }
    return parquet_df, entries, prov


# ----------------------------------------------------------------------------- UNGC
def build_local_volume(refresh: bool) -> tuple[pd.DataFrame, list[dict], dict]:
    src = RAW / "local-volume" / "source"
    v, url = fetch_vizier("J/AJ/145/101/catalog", src / "J_AJ_145_101_catalog.tsv",
                          ["Name", "RAJ2000", "DEJ2000", "Dist", "f_Dist", "Bmag", "Kmag", "HRV", "Vlg", "TT",
                           "BMag", "KLum", "SimbadName", "NEDname"], refresh=refresh)
    v = v[v["Name"] != ""].reset_index(drop=True)
    meth = v["f_Dist"].str.strip()
    quality = meth.map(UNGC_QUALITY).fillna("none")
    dist = num(v["Dist"]) * 1e6
    is_mw = v["Name"].str.strip().eq("Milky Way")
    bmag = num(v["Bmag"])
    kmag = num(v["Kmag"])
    df = pd.DataFrame({
        "id": "UNGC " + v["Name"],
        "ra": num(v["_RAJ2000"]), "dec": num(v["_DEJ2000"]),
        "dist_pc": dist, "dist_lo_pc": np.nan, "dist_hi_pc": np.nan,
        "mag": bmag, "color": bmag - kmag, "kind": "galaxy",
        "name": v["Name"], "simbad_name": v["SimbadName"], "ned_name": v["NEDname"],
        "dist_method": meth, "dist_quality": quality, "hrv_kms": num(v["HRV"]), "vlg_kms": num(v["Vlg"]),
        "morph_tt": num(v["TT"]), "abs_bmag": num(v["BMag"]), "log_lk": num(v["KLum"]),
    })
    df = df[~is_mw.to_numpy()].reset_index(drop=True)
    xyz = galactic_xyz(df["ra"].to_numpy(), df["dec"].to_numpy(), df["dist_pc"].to_numpy())
    df["x_pc"], df["y_pc"], df["z_pc"] = xyz[:, 0], xyz[:, 1], xyz[:, 2]
    entries = []
    for r in df.itertuples():
        alt = [a for a in dict.fromkeys([r.simbad_name, r.ned_name]) if a and a != r.name]
        entries.append({"name": r.name, "alt": alt, "kind": "galaxy", "ra": round(r.ra, 5), "dec": round(r.dec, 5),
                        "dist_pc": float(r.dist_pc), "mag": None if not np.isfinite(r.mag) else round(float(r.mag), 2),
                        "xyz": xyz_list(r.ra, r.dec, r.dist_pc), "ref": "UNGC (Karachentsev+ 2013)",
                        "mag_band": "B", "dist_method": r.dist_method, "dist_quality": r.dist_quality})
    prov = {
        "service": url,
        "note_lvgdb": "Live LV database https://www.sao.ru/lv/lvgdb/ (successor, ~1678 objects) returned HTTP 404 "
                      "from this host and via a second fetcher on 2026-11-13; UNGC 2013 (869 objects) used instead.",
        "selection": "all UNGC rows except the Milky Way itself",
        "distance": "UNGC Dist (Mpc, 0.01 Mpc precision) x 1e6. dist_method from f_Dist; dist_quality: measured "
                    "(TRGB/Cep/SN/SBF/TF/BS/CMD/HB/RR/PNLF/FP/geom), group (mem: group membership), hubble (h/h': "
                    "Hubble flow H0=73, UNGC's own estimate - contract discourages Hubble-flow below z=0.003, kept but "
                    "flagged), guess (txt: texture only), none. No per-object errors in UNGC -> dist_lo/hi NaN.",
        "counts_by_quality": {k: int(n) for k, n in df["dist_quality"].value_counts().items()},
        "mag": "apparent B (UNGC Bmag); color = B - Ks",
        "citations": [CIT_UNGC, CIT_VIZ],
    }
    return df, entries, prov


# ----------------------------------------------------------------------------- CF4
def build_cf4(refresh: bool) -> tuple[pd.DataFrame, dict]:
    src = RAW / "galaxies-cf4" / "source"
    v, url = fetch_vizier("J/ApJ/944/94/table2", src / "J_ApJ_944_94_table2.tsv",
                          ["PGC", "1PGC", "Vcmb", "DM", "e_DM", "DMsnIa", "DMtf", "DMfp", "DMsbf", "DMsnII",
                           "DMtrgb", "DMceph", "DMmas", "RAJ2000", "DEJ2000"], refresh=refresh)
    dm, edm = num(v["DM"]), num(v["e_DM"])
    methods = ["snIa", "tf", "fp", "sbf", "snII", "trgb", "ceph", "mas"]
    has = np.column_stack([np.isfinite(num(v["DM" + m])) for m in methods])
    meth = [",".join(m for m, h in zip(methods, row) if h) for row in has]
    df = pd.DataFrame({
        "id": "PGC " + v["PGC"], "ra": num(v["RAJ2000"]), "dec": num(v["DEJ2000"]),
        "dist_pc": distmod_to_pc(dm), "dist_lo_pc": distmod_to_pc(dm - edm), "dist_hi_pc": distmod_to_pc(dm + edm),
        "mag": np.nan, "color": np.nan, "kind": "galaxy",
        "pgc": pd.to_numeric(v["PGC"], errors="coerce").astype("Int64"),
        "group_pgc": pd.to_numeric(v["1PGC"], errors="coerce").astype("Int64"),
        "dm": dm, "e_dm": edm, "vcmb_kms": num(v["Vcmb"]), "dist_methods": meth,
    })
    df = df[np.isfinite(df["dist_pc"])].reset_index(drop=True)
    xyz = galactic_xyz(df["ra"].to_numpy(), df["dec"].to_numpy(), df["dist_pc"].to_numpy())
    df["x_pc"], df["y_pc"], df["z_pc"] = xyz[:, 0], xyz[:, 1], xyz[:, 2]
    prov = {
        "service": url,
        "selection": "all individual galaxies of CF4 table2 with a finite combined DM",
        "distance": "dist_pc = 10^(DM/5+1) with the CF4 combined distance modulus DM (zero point consistent with "
                    "H0 ~ 75); lo/hi from DM -/+ e_DM. No redshift used.",
        "rows_source": int(len(v)),
        "mag": "not provided (NaN)",
        "citations": [CIT_CF4, CIT_VIZ],
    }
    return df, prov


# ----------------------------------------------------------------------------- 2MRS
def build_2mrs(refresh: bool, ungc: pd.DataFrame, lg: pd.DataFrame, cf4: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    src = RAW / "galaxies-2mrs" / "source"
    v, url = fetch_vizier("J/ApJS/199/26/table3", src / "J_ApJS_199_26_table3.tsv",
                          ["ID", "RAJ2000", "DEJ2000", "Kcmag", "Hcmag", "Jcmag", "E(B-V)", "type", "cz", "e_cz",
                           "SimbadName"], refresh=refresh)
    n_all = len(v)
    cz = num(v["cz"])
    ecz = num(v["e_cz"])
    z = cz / C_KMS
    ra, dec = num(v["_RAJ2000"]), num(v["_DEJ2000"])
    dist = comoving_pc(z)
    lo = comoving_pc(np.clip((cz - ecz) / C_KMS, 0, None))
    hi = comoving_pc((cz + ecz) / C_KMS)
    source = np.where(np.isfinite(dist), "planck18_cz", "")
    no_cz = ~np.isfinite(cz)
    low = np.isfinite(cz) & (z < 0.003)
    li = np.where(low)[0]
    dist[li] = np.nan
    lo[li] = np.nan
    hi[li] = np.nan
    source[li] = ""
    # low-z: borrow a redshift-independent distance, in priority order
    refs = [("ungc", ungc[ungc["dist_quality"].isin(["measured", "group"])]),
            ("mcconnachie", lg[np.isfinite(lg["dist_pc"])]),
            ("cf4", cf4)]
    matched = {}
    for tag, ref in refs:
        todo = li[~np.isfinite(dist[li])]
        if len(todo) == 0:
            break
        idx, _ = match_sky(ra[todo], dec[todo], ref["ra"].to_numpy(), ref["dec"].to_numpy(), 1.0)
        ok = idx >= 0
        dist[todo[ok]] = ref["dist_pc"].to_numpy()[idx[ok]]
        lo[todo[ok]] = ref["dist_lo_pc"].to_numpy()[idx[ok]]
        hi[todo[ok]] = ref["dist_hi_pc"].to_numpy()[idx[ok]]
        source[todo[ok]] = tag
        matched[tag] = int(ok.sum())
    keep = np.isfinite(dist)
    k = num(v["Kcmag"])
    j = num(v["Jcmag"])
    df = pd.DataFrame({
        "id": "2MASX J" + v["ID"], "ra": ra, "dec": dec, "dist_pc": dist, "dist_lo_pc": lo, "dist_hi_pc": hi,
        "mag": k, "color": j - k, "kind": "galaxy", "z": z, "cz_kms": cz, "e_cz_kms": ecz,
        "dist_source": source, "morph_type": v["type"], "ebv": num(v["E(B-V)"]), "simbad_name": v["SimbadName"],
    })[keep].reset_index(drop=True)
    xyz = galactic_xyz(df["ra"].to_numpy(), df["dec"].to_numpy(), df["dist_pc"].to_numpy())
    df["x_pc"], df["y_pc"], df["z_pc"] = xyz[:, 0], xyz[:, 1], xyz[:, 2]
    prov = {
        "service": url,
        "selection": "all rows of table3 (2MRS catalogue, Ks<=11.75, |b|>=5 deg (8 deg near the bulge))",
        "distance": "Planck18 comoving distance of z = cz_helio/c (heliocentric, no flow correction); lo/hi from cz -/+ e_cz. "
                    "cz/c < 0.003: redshift-independent distance of the nearest galaxy within 1 arcmin in UNGC "
                    "(measured/group quality), then McConnachie, then Cosmicflows-4; otherwise dropped.",
        "rows_source": int(n_all),
        "rows_dropped_no_cz": int(no_cz.sum()),
        "rows_lowz": int(low.sum()),
        "rows_lowz_matched": matched,
        "rows_dropped_lowz_unmatched": int((low & ~np.isfinite(dist)).sum()),
        "mag": "Ks isophotal, extinction corrected (Kcmag, 2MASS Vega); color = J - Ks (both corrected)",
        "citations": [CIT_2MRS, CIT_P18, CIT_UNGC, CIT_MCC, CIT_CF4, CIT_VIZ],
    }
    return df, prov


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="re-download sources")
    ap.add_argument("--skip-2mrs", action="store_true")
    a = ap.parse_args()
    started = utcnow()
    report = {}

    lg_df, lg_entries, lg_prov = build_local_group(a.refresh)
    lg_prov["started_utc"] = started
    lg_prov["catalog_json"] = "data/tiles/catalogs/local-group.json"
    lg_prov["catalog_json_bytes"] = write_catalog_json(CATS / "local-group.json", lg_entries)
    report["local-group"] = write_layer("local-group", lg_df, lg_prov)

    lv_df, lv_entries, lv_prov = build_local_volume(a.refresh)
    lv_prov["started_utc"] = started
    lv_prov["catalog_json"] = "data/tiles/catalogs/local-volume.json"
    lv_prov["catalog_json_bytes"] = write_catalog_json(CATS / "local-volume.json", lv_entries)
    report["local-volume"] = write_layer("local-volume", lv_df, lv_prov)

    cf_df, cf_prov = build_cf4(a.refresh)
    cf_prov["started_utc"] = started
    report["galaxies-cf4"] = write_layer("galaxies-cf4", cf_df, cf_prov)

    if not a.skip_2mrs:
        m_df, m_prov = build_2mrs(a.refresh, lv_df, lg_df, cf_df)
        m_prov["started_utc"] = started
        report["galaxies-2mrs"] = write_layer("galaxies-2mrs", m_df, m_prov)

    for k, p in report.items():
        print(f"{k}: {p['rows']} rows -> {p['file']} ({p['file_bytes']} B)")


if __name__ == "__main__":
    main()
