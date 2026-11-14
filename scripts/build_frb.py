#!/usr/bin/env python
"""Fast radio bursts (kind `frb`): localised hosts in 3D, everything else as sky directions.

SOURCES
  FRB hosts:  FRBs/FRB repository (BSD-3-Clause), frb/data/Galaxies/public_hosts.csv
              (103 rows, 101 with a host redshift; last commit 2026-10-22) and
              frb/data/FRBs/FRBs_base.csv (182 localised FRBs: position, DM, fluence, repeater,
              telescope, references). https://github.com/FRBs/FRB
  CHIME/FRB:  CHIME/FRB Catalog 2 (release 20251231; 5,045 bursts from 3,641 sources, 83 repeaters
              counted here), https://assets.chime-frb.ca/catalogs/catalog2/releases/20251231/data/chimefrbcat2.csv
              No licence stated; cite CHIME/FRB Collaboration 2026, arXiv:2601.09399 (DOI 10.11570/25.0066).

RULES
  - Only an FRB with a host-galaxy redshift gets a 3D position: Planck18 comoving distance of the
    host z (astropy). Peculiar velocities are ignored, which matters only for the two nearest
    (FRB 20200120E in M81's globular cluster, z = 0.0008; FRB 20171020A, z = 0.00867).
  - Every other FRB is a sky DIRECTION only (no distance, not even a DM-based one): localised FRBs
    without a host z, and every CHIME Catalog 2 source not already in the localised list.
    Repeaters are one source; their position is the burst-count mean (CHIME positions agree to the
    quoted errors), DM is the median of the bursts, fluence the median of the bursts with one.

OUTPUT
  data/tiles/catalogs/frb-hosts.json   catalogue entries (kind frb), facts: z, DM, fluence, repeater,
                                       host galaxy, telescope
  data/tiles/catalogs/frb-sky.json     compact columns for the sky markers (src/messengers)
  data/tiles/catalogs/provenance/frb.json

usage: .venv/bin/python -I scripts/build_frb.py [--refresh]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from catio import CACHE, CATS, download, sig, utcnow, write_catalog_json, write_provenance  # noqa: E402
from coords import comoving_pc, xyz_list  # noqa: E402

NAME = "frb"
HOSTS_URL = "https://raw.githubusercontent.com/FRBs/FRB/main/frb/data/Galaxies/public_hosts.csv"
BASE_URL = "https://raw.githubusercontent.com/FRBs/FRB/main/frb/data/FRBs/FRBs_base.csv"
CHIME_URL = "https://assets.chime-frb.ca/catalogs/catalog2/releases/20251231/data/chimefrbcat2.csv"
REF_REPO = "FRBs/FRB repository (Prochaska et al.; BSD-3-Clause), public_hosts.csv + FRBs_base.csv"
REF_CHIME = "CHIME/FRB Collaboration 2026, The Second CHIME/FRB Catalog, arXiv:2601.09399 (release 20251231)"
# hosts with a common name (the repo lists designations only); each from the cited paper
KNOWN_HOSTS = {
    "FRB20200120E": ("M81 (globular cluster)", "Kirsten et al. 2022, Nature 602, 585"),
    "FRB20121102A": ("dwarf galaxy, SDSS J053158.70+330852.5", "Tendulkar et al. 2017, ApJL 834, L7"),
    "FRB20180916B": ("spiral galaxy, SDSS J015800.28+654253.0", "Marcote et al. 2020, Nature 577, 190"),
}


def tns(name: str) -> str:
    """FRB20180916B -> FRB 20180916B (TNS display form)"""
    return name.replace("FRB", "FRB ", 1) if name.startswith("FRB") and not name.startswith("FRB ") else name


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true")
    a = ap.parse_args()
    c = CACHE / NAME
    hosts = pd.read_csv(download(HOSTS_URL, c / "public_hosts.csv", a.refresh))
    base = pd.read_csv(download(BASE_URL, c / "FRBs_base.csv", a.refresh))
    chime = pd.read_csv(download(CHIME_URL, c / "chimefrbcat2.csv", a.refresh))
    hosts["Name"] = "FRB" + hosts["FRB"].astype(str)
    hz = dict(zip(hosts["Name"], hosts["z"]))

    entries, sky = [], []
    for _, r in base.iterrows():
        name = r["Name"]
        z = hz.get(name, np.nan)
        rep = str(r["repeater"]).strip().upper() == "TRUE"
        facts = {}
        if np.isfinite(z):
            facts["z"] = float(z)
        facts["dm_pc_cm3"] = sig(r["DM"], 6)
        if np.isfinite(r["fluence"]):
            facts["fluence_jy_ms"] = [sig(r["fluence"], 4), sig(r["fluence_err"], 3)] if np.isfinite(r.get("fluence_err", np.nan)) else sig(r["fluence"], 4)
        facts["repeater"] = rep
        if np.isfinite(z):
            host, host_ref = KNOWN_HOSTS.get(name, (f"HG{name[3:]}", None))
            facts["host_galaxy"] = host
        facts["telescope"] = str(r["telescope"])
        if not np.isfinite(z):
            sky.append([tns(name), round(float(r["ra"]), 4), round(float(r["dec"]), 4), round(max(float(r["ee_a"]), 0) / 3600, 5) if np.isfinite(r["ee_a"]) else 0,
                        sig(r["DM"], 5), sig(r["fluence"], 3) if np.isfinite(r["fluence"]) else None, int(rep), 1, "L"])
            continue
        d = float(comoving_pc(z))
        e = {"name": tns(name), "alt": [name], "kind": "frb", "ra": round(float(r["ra"]), 6), "dec": round(float(r["dec"]), 6),
             "dist_pc": round(d, -2), "mag": None, "xyz": xyz_list(r["ra"], r["dec"], d),
             "ref": f"{REF_REPO}; refs: {r['refs']}", "facts": facts,
             "facts_ref": {"z": "host-galaxy redshift, public_hosts.csv (refs as listed)", "dist": "Planck18 comoving distance of z (astropy)"}}
        if facts.get("host_galaxy") and name in KNOWN_HOSTS:
            e["facts_ref"]["host_galaxy"] = KNOWN_HOSTS[name][1]
        entries.append(e)

    localised = set(base["Name"])
    chime["src"] = chime["repeater_name"].fillna(chime["tns_name"])
    n_skip_local = 0
    n_no_pos = 0
    for src, g in chime.groupby("src", sort=True):
        if src in localised:
            n_skip_local += 1
            continue
        g = g[np.isfinite(g["ra"]) & np.isfinite(g["dec"])]
        if not len(g):  # sidelobe events: "Localization not available for sidelobe events."
            n_no_pos += 1
            continue
        rep = g["repeater_name"].notna().any()
        ra = float(np.degrees(np.arctan2(np.sin(np.radians(g["ra"])).mean(), np.cos(np.radians(g["ra"])).mean())) % 360)
        dec = float(g["dec"].mean())
        errs = np.array([g["ra_err"].median() * np.cos(np.radians(dec)), g["dec_err"].median()], float)
        err = float(np.max(errs[np.isfinite(errs)])) if np.isfinite(errs).any() else None
        flu = g["fluence"].dropna()
        sky.append([tns(src), round(ra, 4), round(dec, 4), None if err is None else round(err, 4), sig(g["dm_fitb"].median(), 5),
                    sig(flu.median(), 3) if len(flu) else None, int(rep), int(len(g)), "C"])

    n = write_catalog_json(CATS / "frb-hosts.json", entries)
    sky_doc = {
        "columns": ["name", "ra", "dec", "err_deg", "dm_pc_cm3", "fluence_jy_ms", "repeater", "n_bursts", "src"],
        "src": {"L": f"localised, no host redshift ({REF_REPO})", "C": REF_CHIME},
        "note": "Directions only: no distance is implied. err_deg = CHIME 68 % position error (larger axis) or the localisation ellipse semi-major axis.",
        "rows": sky,
    }
    (CATS / "frb-sky.json").write_text(json.dumps(sky_doc, separators=(",", ":"), ensure_ascii=False, allow_nan=False))
    write_provenance(NAME, {
        "built": utcnow(),
        "sources": [{"url": HOSTS_URL, "licence": "BSD-3-Clause"}, {"url": BASE_URL, "licence": "BSD-3-Clause"},
                    {"url": CHIME_URL, "licence": "none stated; cite arXiv:2601.09399 / DOI 10.11570/25.0066"}],
        "counts": {"localised_rows": int(len(base)), "hosts_with_z_3d": len(entries),
                   "localised_without_z_sky": int(sum(1 for s in sky if s[-1] == "L")),
                   "chime_bursts": int(len(chime)), "chime_sources": int(chime["src"].nunique()),
                   "chime_repeaters": int(chime["repeater_name"].nunique()),
                   "chime_sources_already_localised": n_skip_local, "chime_sources_without_position": n_no_pos, "chime_sky": int(sum(1 for s in sky if s[-1] == "C"))},
        "rules": "3D only with a host redshift (Planck18 comoving distance); all others direction-only.",
    })
    print(f"frb-hosts.json: {len(entries)} hosts in 3D ({n} B); frb-sky.json: {len(sky)} directions "
          f"({(CATS / 'frb-sky.json').stat().st_size} B), {n_skip_local} CHIME sources already localised, "
          f"{n_no_pos} without a position (sidelobe)")


if __name__ == "__main__":
    main()
