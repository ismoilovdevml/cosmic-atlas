#!/usr/bin/env python
"""Fetch the DESI DR1 redshift catalogue (galaxies + QSOs) -> data/raw/galaxies-desi/.

Access path: NOIRLab Astro Data Lab TAP (desi_dr1.zpix LEFT JOIN desi_dr1.photometry), which
does the ZCAT_PRIMARY / ZWARN selection server side. The NERSC FITS files
(zcatalog/v1/zall-pix-iron.fits) are 22 GB and carry every coadd, so TAP is far cheaper.

Stage 0: per-pixel row counts (GROUP BY zpix.healpix, NSIDE=64 NESTED), cached in
healpix_counts.parquet. Non-empty pixels are grouped into contiguous pixel ranges of
~--rows-per-job rows each, so each block has a known expected row count.
Stage 1 (resumable): one async TAP job per block, at most 3 concurrent jobs. Each block lands in
parts/hp_<lo>_<hi>.parquet only if its row count equals the expected count; existing parts are
skipped on re-run. Server-side cut: ZCAT_PRIMARY & ZWARN==0 & SPECTYPE!=STAR
(the DR1 paper's "confident, unique redshift" criterion, arXiv:2503.14745 sec. 7).

Stage 2: local quality cuts (DELTACHI2>25, i.e. best fit 5 sigma better than the next one,
DR1 paper sec. 6; sky fibres removed; z>=0.003), derived columns, single parquet + provenance.

Usage: .venv/bin/python scripts/fetch_desi.py [--rows-per-job 150000] [--workers 3] [--only-combine]
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import datetime as dt
import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import pyvo

sys.path.insert(0, str(Path(__file__).resolve().parent))
from coords import comoving_pc  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "raw" / "galaxies-desi"
PARTS = OUT / "parts"
TAP_URL = "https://datalab.noirlab.edu/tap"
DELTACHI2_MIN = 25.0
Z_MIN = 0.003  # contract: no Hubble-flow distances below z=0.003
SKY_BITS = (1 << 32) | (1 << 33) | (1 << 34)  # SKY, BAD_SKY, SUPP_SKY in (sv1/2/3_)desi_target

QUERY = """SELECT z.targetid, z.mean_fiber_ra, z.mean_fiber_dec, p.ra AS target_ra, p.dec AS target_dec,
 z.z, z.zerr, z.zwarn, z.deltachi2, z.spectype, z.subtype, z.survey, z.program, z.healpix,
 z.desi_target, z.sv1_desi_target, z.sv2_desi_target, z.sv3_desi_target,
 p.flux_g, p.flux_r, p.flux_z, p.mw_transmission_g, p.mw_transmission_r, p.ebv
FROM desi_dr1.zpix AS z LEFT JOIN desi_dr1.photometry AS p ON p.targetid = z.targetid
WHERE z.healpix BETWEEN {lo} AND {hi} AND z.zcat_primary = 't' AND z.zwarn = 0 AND z.spectype <> 'STAR'"""

PIXCOUNT_QUERY = ("SELECT healpix, COUNT(*) AS n FROM desi_dr1.zpix "
                  "WHERE zcat_primary = 't' AND zwarn = 0 AND spectype <> 'STAR' GROUP BY healpix")

COUNT_QUERY = ("SELECT spectype, COUNT(*) AS n FROM desi_dr1.zpix "
               "WHERE zcat_primary = 't' AND zwarn = 0 AND spectype <> 'STAR' GROUP BY spectype")

CITATIONS = [
    {"what": "DESI Data Release 1", "ref": "DESI Collaboration, Abdul Karim et al. 2025, arXiv:2503.14745",
     "doi": "10.48550/arXiv.2503.14745"},
    {"what": "Redrock redshift fitter", "ref": "Bailey et al. 2025 (in prep., DR1 ref.); Anand et al. 2024, AJ 168, 124",
     "doi": "10.3847/1538-3881/ad60c2"},
    {"what": "DESI Legacy Imaging Surveys DR9 photometry", "ref": "Dey et al. 2019, AJ 157, 168",
     "doi": "10.3847/1538-3881/ab089d"},
    {"what": "Astro Data Lab", "ref": "Fitzpatrick et al. 2014, SPIE 9149; Nikutta et al. 2020, A&C 33, 100411",
     "doi": "10.1016/j.ascom.2020.100411"},
    {"what": "Planck 2018 cosmology (distances)", "ref": "Planck Collaboration 2020, A&A 641, A6",
     "doi": "10.1051/0004-6361/201833910"},
]


def utcnow() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def part_path(lo: int, hi: int) -> Path:
    return PARTS / f"hp_{lo:05d}_{hi:05d}.parquet"


def run_async(svc: pyvo.dal.TAPService, q: str, maxrec: int = 20_000_000):
    job = svc.submit_job(q, maxrec=maxrec)
    try:
        job.run()
        job.wait(phases=["COMPLETED", "ERROR", "ABORTED"], timeout=3600)
        if job.phase != "COMPLETED":
            job.raise_if_error()
            raise RuntimeError(f"job phase {job.phase}")
        res = job.fetch_result()
        if getattr(res, "query_status", "OK") == "OVERFLOW":
            raise RuntimeError("result OVERFLOW (maxrec hit)")
        return res.to_table()
    finally:
        try:
            job.delete()
        except Exception:
            pass


def pixel_counts(svc: pyvo.dal.TAPService) -> pd.DataFrame:
    cache = PARTS / "healpix_counts.parquet"  # kept out of the layer glob data/raw/<layer>/*.parquet
    if cache.exists():
        return pd.read_parquet(cache)
    tab = run_async(svc, PIXCOUNT_QUERY, maxrec=100_000)
    df = pd.DataFrame({"healpix": np.asarray(tab["healpix"], dtype=np.int32),
                       "n": np.asarray(tab["n"], dtype=np.int64)}).sort_values("healpix")
    df.to_parquet(cache, index=False)
    return df


def make_blocks(counts: pd.DataFrame, rows_per_job: int) -> list[tuple[int, int, int]]:
    """Contiguous pixel ranges [lo, hi] over non-empty pixels with ~rows_per_job rows each."""
    blocks, lo, acc, prev = [], None, 0, None
    for pix, n in zip(counts["healpix"].to_numpy(), counts["n"].to_numpy()):
        if lo is None:
            lo = int(pix)
        acc += int(n)
        prev = int(pix)
        if acc >= rows_per_job:
            blocks.append((lo, prev, acc))
            lo, acc = None, 0
    if lo is not None:
        blocks.append((lo, prev, acc))
    return blocks


def fetch_block(svc: pyvo.dal.TAPService, lo: int, hi: int, expected: int,
                retries: int = 5) -> tuple[int, int, int, float]:
    dest = part_path(lo, hi)
    if dest.exists():
        return lo, hi, pq.read_metadata(dest).num_rows, 0.0
    q = QUERY.format(lo=lo, hi=hi)
    delay = 30.0
    for attempt in range(1, retries + 1):
        t0 = time.time()
        try:
            df = run_async(svc, q).to_pandas()
            if len(df) != expected:
                raise RuntimeError(f"row count {len(df)} != expected {expected}")
            for c in df.columns:  # pyvo may hand back masked ints -> keep as float/nullable
                if df[c].dtype == object and c in ("spectype", "subtype", "survey", "program"):
                    df[c] = df[c].astype(str).str.strip()
            tmp = dest.with_suffix(".tmp")
            df.to_parquet(tmp, index=False)
            tmp.rename(dest)
            return lo, hi, len(df), time.time() - t0
        except Exception as exc:  # network / server hiccups: back off and retry
            print(f"  block {lo}-{hi} attempt {attempt} failed: {exc}", flush=True)
            if attempt == retries:
                raise
            time.sleep(delay)
            delay *= 2
    raise RuntimeError("unreachable")


def stage1(rows_per_job: int, workers: int) -> dict:
    PARTS.mkdir(parents=True, exist_ok=True)
    svc = pyvo.dal.TAPService(TAP_URL)
    counts = pixel_counts(svc)
    blocks = make_blocks(counts, rows_per_job)
    # parts from an older blocking scheme would double count -> refuse to mix
    names = {part_path(lo, hi).name for lo, hi, _ in blocks}
    stray = [f for f in PARTS.glob("hp_*.parquet") if f.name not in names]
    if stray:
        raise SystemExit(f"{len(stray)} parts do not match the current blocking; delete {PARTS} or keep --rows-per-job")
    todo = [b for b in blocks if not part_path(b[0], b[1]).exists()]
    print(f"stage 1: {int(counts['n'].sum())} rows in {len(counts)} pixels -> {len(blocks)} blocks, "
          f"{len(todo)} to fetch", flush=True)
    done = 0
    with cf.ThreadPoolExecutor(max_workers=min(workers, 3)) as ex:
        futs = {ex.submit(fetch_block, svc, lo, hi, n): (lo, hi) for lo, hi, n in todo}
        for f in cf.as_completed(futs):
            lo, hi, n, secs = f.result()
            done += 1
            print(f"  [{done}/{len(todo)}] hp {lo}-{hi}: {n} rows in {secs:.0f}s", flush=True)
    return {"blocks": len(blocks), "rows_per_job_target": rows_per_job,
            "nonempty_pixels": int(len(counts)), "pixel_count_query": PIXCOUNT_QUERY}


def server_count() -> dict:
    tab = run_async(pyvo.dal.TAPService(TAP_URL), COUNT_QUERY)
    return {str(r["spectype"]).strip(): int(r["n"]) for r in tab}


def mag_from_flux(flux, transmission):
    flux = np.asarray(flux, dtype=float)
    tr = np.asarray(transmission, dtype=float)
    with np.errstate(divide="ignore", invalid="ignore"):
        m = 22.5 - 2.5 * np.log10(flux / tr)
    m[~np.isfinite(m) | (flux <= 0)] = np.nan
    return m


def stage2(server_counts: dict | None) -> dict:
    files = sorted(PARTS.glob("hp_*.parquet"))
    df = pd.concat([pd.read_parquet(f) for f in files], ignore_index=True)
    n_fetched = len(df)
    by_type_fetched = df["spectype"].value_counts().to_dict()
    dup = int(df["targetid"].duplicated().sum())
    df = df.drop_duplicates("targetid")

    cuts = {}
    tgt_cols = ["desi_target", "sv1_desi_target", "sv2_desi_target", "sv3_desi_target"]
    sky = np.zeros(len(df), bool)
    for c in tgt_cols:
        v = pd.to_numeric(df[c], errors="coerce").fillna(0).astype(np.int64).to_numpy()
        sky |= (v & SKY_BITS) != 0
    cuts["sky_fibres_removed"] = int(sky.sum())
    df = df[~sky]
    low_dchi = df["deltachi2"].to_numpy() <= DELTACHI2_MIN
    cuts["deltachi2_le_25_removed"] = {k: int(v) for k, v in
                                       df.loc[low_dchi, "spectype"].value_counts().items()}
    df = df[~low_dchi]
    lowz = df["z"].to_numpy() < Z_MIN
    cuts["z_lt_0.003_removed"] = {k: int(v) for k, v in df.loc[lowz, "spectype"].value_counts().items()}
    df = df[~lowz].reset_index(drop=True)

    ra = df["target_ra"].to_numpy(dtype=float, copy=True)
    dec = df["target_dec"].to_numpy(dtype=float, copy=True)
    nofib = ~np.isfinite(ra) | ~np.isfinite(dec)
    ra[nofib] = df["mean_fiber_ra"].to_numpy(dtype=float)[nofib]
    dec[nofib] = df["mean_fiber_dec"].to_numpy(dtype=float)[nofib]
    cuts["position_from_mean_fiber_radec"] = int(nofib.sum())

    z = df["z"].to_numpy(dtype=float)
    zerr = df["zerr"].to_numpy(dtype=float)
    r = mag_from_flux(df["flux_r"], df["mw_transmission_r"])
    g = mag_from_flux(df["flux_g"], df["mw_transmission_g"])
    targetid = df["targetid"].to_numpy(dtype=np.int64)
    spectype = df["spectype"].astype(str).to_numpy()
    kind = np.where(spectype == "QSO", "qso", "galaxy")

    out = pd.DataFrame({
        "id": pd.Series(["DESI " + str(t) for t in targetid], dtype="string"),
        "targetid": targetid,
        "ra": ra,
        "dec": dec,
        "dist_pc": comoving_pc(z),
        "dist_lo_pc": comoving_pc(np.clip(z - zerr, 0, None)),
        "dist_hi_pc": comoving_pc(z + zerr),
        "mag": r.astype(np.float32),
        "color": (g - r).astype(np.float32),
        "kind": pd.Categorical(kind, categories=["galaxy", "qso"]),
        "z": z,
        "zerr": zerr.astype(np.float32),
        "spectype": pd.Categorical(spectype),
        "subtype": pd.Categorical(df["subtype"].astype(str)),
        "deltachi2": df["deltachi2"].to_numpy(dtype=np.float32),
        "survey": pd.Categorical(df["survey"].astype(str)),
        "program": pd.Categorical(df["program"].astype(str)),
        "ebv": pd.to_numeric(df["ebv"], errors="coerce").to_numpy(dtype=np.float32),
        "healpix64": df["healpix"].to_numpy(dtype=np.int32),
    })
    # Sort by importance for the tile builder convenience (contract: inverse redshift).
    out = out.sort_values("z", kind="stable").reset_index(drop=True)
    table = pa.Table.from_pandas(out, preserve_index=False)
    dest = OUT / "galaxies-desi.parquet"
    pq.write_table(table, dest, compression="zstd", row_group_size=1_000_000)

    hist_edges = np.round(np.arange(0, 7.01, 0.1), 1)
    h, _ = np.histogram(out["z"], bins=hist_edges)
    mt = sorted(f.stat().st_mtime for f in files)
    iso = lambda t: dt.datetime.fromtimestamp(t, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    stats = {
        "parts": len(files),
        "parts_written_utc": [iso(mt[0]), iso(mt[-1])],
        "rows_fetched": n_fetched,
        "rows_fetched_by_spectype": {k: int(v) for k, v in by_type_fetched.items()},
        "duplicate_targetids_dropped": dup,
        "rows_final": len(out),
        "rows_final_by_kind": {k: int(v) for k, v in out["kind"].value_counts().items()},
        "mag_r_available": int(np.isfinite(out["mag"]).sum()),
        "z_hist_0.1": {f"{hist_edges[i]:.1f}-{hist_edges[i+1]:.1f}": int(h[i]) for i in range(len(h)) if h[i]},
        "cuts": cuts,
        "server_counts_primary_zwarn0": server_counts,
        "file": str(dest.relative_to(ROOT)),
        "file_bytes": dest.stat().st_size,
    }
    return stats


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rows-per-job", type=int, default=150_000, help="target rows per TAP job")
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--only-combine", action="store_true")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    started = utcnow()
    if args.only_combine:
        counts = pd.read_parquet(PARTS / "healpix_counts.parquet")
        part_info = {"blocks": len(list(PARTS.glob("hp_*.parquet"))), "rows_per_job_target": args.rows_per_job,
                     "nonempty_pixels": int(len(counts)), "pixel_count_query": PIXCOUNT_QUERY}
    else:
        part_info = stage1(args.rows_per_job, args.workers)
    try:
        counts = server_count()
    except Exception as exc:
        print("server count failed:", exc)
        counts = None
    stats = stage2(counts)
    if counts:
        expected = sum(counts.values())
        stats["completeness_check"] = {"server_rows": expected, "fetched_rows": stats["rows_fetched"],
                                       "ok": expected == stats["rows_fetched"]}
    prov = {
        "layer": "galaxies-desi",
        "service": TAP_URL,
        "tables": ["desi_dr1.zpix", "desi_dr1.photometry"],
        "query_template": QUERY,
        "partitioning": {"column": "zpix.healpix (NSIDE=64 NESTED)", **part_info},
        "count_query": COUNT_QUERY,
        "started_utc": started,
        "finished_utc": utcnow(),
        "selection": {
            "server": "ZCAT_PRIMARY & ZWARN==0 & SPECTYPE!='STAR' (DR1 paper sec. 7 confident unique redshifts)",
            "local": [f"DELTACHI2 > {DELTACHI2_MIN} (5 sigma best fit vs next, DR1 paper sec. 6)",
                      "drop SKY/BAD_SKY/SUPP_SKY fibres (bits 32-34 of desi_target, sv1/2/3_desi_target)",
                      f"drop z < {Z_MIN} (contract: no Hubble-flow distance below 0.003)",
                      "drop duplicate targetid (none expected)"],
            "cap": "no cap applied: final count < 25 M",
        },
        "columns": {
            "ra/dec": "LS DR9 target position (photometry.ra/dec); mean fibre position if no photometry row",
            "dist_pc": "Planck18 comoving distance of z (scripts/coords.py interpolation, <1e-5 rel)",
            "dist_lo_pc/dist_hi_pc": "comoving distance of z -/+ zerr",
            "mag": "LS DR9 r (AB), corrected for Milky Way extinction (flux_r / mw_transmission_r); NaN if flux<=0 or no photometry",
            "color": "g - r, both extinction corrected (AB)",
            "kind": "galaxy (SPECTYPE GALAXY) or qso (SPECTYPE QSO)",
        },
        "stats": stats,
        "citations": CITATIONS,
        "acknowledgement": "This research used data obtained with the Dark Energy Spectroscopic Instrument (DESI), "
                           "accessed through the Astro Data Lab at NSF NOIRLab.",
    }
    (OUT / "PROVENANCE.json").write_text(json.dumps(prov, indent=2))
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()
