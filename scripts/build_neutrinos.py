#!/usr/bin/env python
"""High-energy neutrinos (kind `neutrino`): IceCat-1 alert tracks as sky regions, the two identified
sources in 3D, and KM3-230213A.

SOURCES
  IceCat-1 (IceCube Event Catalog of Alert Tracks), Harvard Dataverse doi:10.7910/DVN/SCRUCD,
      dataset version 4.0 (2023-11-09), licence CC0 1.0; file IceCube_Gold_Bronze_Tracks.tab
      (datafile 7502710, 348 tracks IC110514A-IC231014A). Columns per the dataset README: RA/DEC
      J2000 best fit with ASYMMETRIC 90 % CL error-rectangle bounds (deg), ENERGY = most probable
      neutrino energy (TeV, E^-2.19 spectrum assumed), SIGNAL = signalness (probability of
      astrophysical origin), FAR = background rate (per year), CR_VETO = IceTop coincidence.
      Abbasi et al. 2023, ApJS 269, 25 (doi:10.3847/1538-4365/acfa95).
  TXS 0506+056: position SIMBAD (Harvard mirror; main id PMN J0509+0541, BL Lac) 77.358185,
      +5.693148, cross-checked with NED (77.358185, +5.693148; z = 0.3365 +- 0.0001). Redshift
      Paiano et al. 2018, ApJL 854, L32. Distance = Planck18 comoving distance of z (astropy).
      Significance: IceCube et al. 2018, Science 361, eaat1378 (IC170922A with the Fermi-LAT flare:
      chance coincidence rejected at the 3 sigma level) and IceCube 2018, Science 361, 147
      (2014-15 neutrino flare, 13 +- 5 events, 3.5 sigma).
  NGC 1068 (M77): position SIMBAD (Harvard mirror) 40.669622, -0.013294 = NED (40.6696, -0.0132865).
      Distance 14.4 Mpc, the value IceCube used (IceCube 2022, Science 378, 538; their ref. to
      Tully 1988, Nearby Galaxies Catalog). Significance 4.2 sigma (global), 79 +22/-20 signal events.
  KM3-230213A: KM3NeT Collaboration 2025, Nature 638, 376: RA 94.3, Dec -7.8 (J2000), 90 %
      containment radius 2.2 deg (as quoted by VERITAS, arXiv:2509.25422, citing the Nature paper);
      energy 220 (+570, -110) PeV (KM3NeT 2025, arXiv:2502.08173, citing the same paper). Not in
      IceCat-1. Drawn as a circle.

OUTPUT
  data/tiles/catalogs/neutrino-sources.json  catalogue entries (kind neutrino): TXS 0506+056 and NGC 1068 in 3D
  data/tiles/catalogs/neutrino-sky.json      compact columns for the sky regions (src/messengers)
  data/tiles/catalogs/provenance/neutrino.json

usage: .venv/bin/python -I scripts/build_neutrinos.py [--refresh]
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

NAME = "neutrino"
ICECAT_URL = "https://dataverse.harvard.edu/api/access/datafile/7502710"
REF_ICECAT = "IceCube Collaboration 2023, ApJS 269, 25 (IceCat-1, CC0, doi:10.7910/DVN/SCRUCD v4.0)"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true")
    a = ap.parse_args()
    t = pd.read_csv(download(ICECAT_URL, CACHE / NAME / "icecat1.dat", a.refresh), sep="\t")
    t.columns = [c.strip('"') for c in t.columns]
    for c in ("NAME", "I3TYPE", "CR_VETO"):
        t[c] = t[c].astype(str).str.strip('"')

    rows = []
    for _, r in t.iterrows():
        rows.append([r["NAME"], float(r["RA"]), float(r["DEC"]), float(r["RA_ERR_PLUS"]), float(r["RA_ERR_MINUS"]),
                     float(r["DEC_ERR_PLUS"]), float(r["DEC_ERR_MINUS"]), None, sig(r["ENERGY"], 4), sig(r["SIGNAL"], 3),
                     sig(r["FAR"], 3), r["I3TYPE"], str(r["START"])[:10], int(r["CR_VETO"].upper() == "TRUE"), "IC"])
    # KM3NeT: a 90 % circle, not a rectangle (ra/dec errors left null, radius in r90_deg)
    rows.append(["KM3-230213A", 94.3, -7.8, None, None, None, None, 2.2, 220000, None, None, "km3net-arca", "2023-02-13", 0, "KM3"])

    sky = {
        "columns": ["name", "ra", "dec", "ra_plus", "ra_minus", "dec_plus", "dec_minus", "r90_deg", "energy_tev",
                    "signalness", "far_per_yr", "type", "date", "cr_veto", "src"],
        "src": {"IC": REF_ICECAT, "KM3": "KM3NeT Collaboration 2025, Nature 638, 376 (KM3-230213A)"},
        "note": "IceCat-1 regions are asymmetric 90 % CL rectangles in RA/Dec (deg of the coordinate); KM3-230213A is a 90 % circle. Directions only.",
        "rows": rows,
    }
    (CATS / "neutrino-sky.json").write_text(json.dumps(sky, separators=(",", ":"), ensure_ascii=False))

    d_txs = float(comoving_pc(0.3365))
    sources = [
        {"name": "TXS 0506+056", "alt": ["PMN J0509+0541", "IC170922A source"], "kind": "neutrino",
         "ra": 77.358185, "dec": 5.693148, "dist_pc": round(d_txs, -3), "mag": None,
         "xyz": xyz_list(77.358185, 5.693148, d_txs), "docs": "neutrino",
         "ref": "IceCube Collaboration et al. 2018, Science 361, eaat1378", "doi": "10.1126/science.aat1378",
         "facts": {"type": "blazar (BL Lac)", "z": 0.3365, "significance": "3σ (IC170922A + γ-ray flare, 2017)",
                   "significance_flare": "3.5σ (2014–15 neutrino flare)", "neutrino_events_flare": [13, 5],
                   "energy_ic170922a_tev": 290},
         "facts_ref": {"z": "Paiano et al. 2018, ApJL 854, L32",
                       "significance_flare": "IceCube Collaboration 2018, Science 361, 147",
                       "neutrino_events_flare": "IceCube Collaboration 2018, Science 361, 147",
                       "dist": "Planck18 comoving distance of z (astropy)"}},
        {"name": "NGC 1068 (IceCube source)", "alt": ["M77 neutrino source"], "kind": "neutrino",
         "ra": 40.669622, "dec": -0.013294, "dist_pc": 14.4e6, "mag": None,
         "xyz": xyz_list(40.669622, -0.013294, 14.4e6), "docs": "neutrino",
         "ref": "IceCube Collaboration 2022, Science 378, 538", "doi": "10.1126/science.abg3395",
         "facts": {"type": "Seyfert 2 galaxy (M77)", "significance": "4.2σ (2011–2020)", "neutrino_events": [79, 20, 22],
                   "energy_range_tev": "1.5–15"},
         "facts_ref": {"dist": "14.4 Mpc as used by IceCube 2022 (Tully 1988, Nearby Galaxies Catalog)"}},
    ]
    n = write_catalog_json(CATS / "neutrino-sources.json", sources)
    write_provenance(NAME, {
        "built": utcnow(),
        "sources": [{"url": ICECAT_URL, "licence": "CC0 1.0", "dataset": "doi:10.7910/DVN/SCRUCD v4.0"},
                    {"what": "TXS 0506+056 / NGC 1068 positions", "simbad": "https://simbad.harvard.edu/simbad/sim-tap/sync",
                     "ned": "https://ned.ipac.caltech.edu/srs/ObjectLookup"},
                    {"what": "KM3-230213A", "ref": "KM3NeT Collaboration 2025, Nature 638, 376; arXiv:2502.08173; arXiv:2509.25422"}],
        "counts": {"icecat_tracks": int(len(t)), "sky_rows": len(rows), "sources_3d": len(sources),
                   "gold": int((t["I3TYPE"].str.contains("gold")).sum()), "cr_veto": int((t["CR_VETO"].str.upper() == "TRUE").sum())},
        "txs_comoving_mpc": round(d_txs / 1e6, 2),
    })
    print(f"neutrino-sky.json {len(rows)} rows ({(CATS / 'neutrino-sky.json').stat().st_size} B); "
          f"neutrino-sources.json {n} B; TXS D_C = {d_txs / 1e6:.2f} Mpc")


if __name__ == "__main__":
    main()
