#!/usr/bin/env python3
"""Fetch the `stars-gaia` raw layer: Gaia DR3 stars within 1 kpc of the Sun.

Output follows docs/data-contract.md section 2:
    data/raw/stars-gaia/gaia_chunk_XXXX.parquet   one file per source_id-range chunk
    data/raw/stars-gaia/bright_supplement.parquet Hipparcos stars Gaia misses/handles poorly
    data/raw/stars-gaia/PROVENANCE.json

Stages (each resumable, run in order; `all` runs every stage):
    survey    per-HEALPix-level-6 x 100-pc-shell counts for several candidate cuts
              (one ADQL job per level-3 pixel, 768 jobs; split further on timeout)
    plan      pack consecutive level-6 pixels into source_id ranges with <= CHUNK_MAX rows
              under the chosen cut
    fetch     download every chunk, check the row count equals the planned count, write Parquet
    bright    Hipparcos (van Leeuwen 2007, I/311) supplement for bright stars without a good
              Gaia DR3 counterpart inside the selection
    validate  sanity report (shells, known stars, sizes) -> _work/validate.json
    provenance write PROVENANCE.json

Why chunking: the Gaia archive's anonymous async TAP jobs are capped at 50,000 output rows and
60 s execution time (measured 2026-11-13: capabilities outputLimit=50000, job executionDuration=60).
Gaia source_id encodes the HEALPix level-12 nested index as source_id // 2**35, so a level-k pixel
p is the contiguous source_id range [p, p+1) * 2**35 * 4**(12-k).
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import datetime as dt
import io
import json
import sys
import threading
import time
from pathlib import Path

import numpy as np
import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "raw" / "stars-gaia"
WORK = OUT / "_work"
SURVEY_DIR = WORK / "survey"
PLAN_FILE = WORK / "chunks.json"

# TAP services carrying Gaia DR3 + Bailer-Jones 2021 distances: url, distance table.
SERVICES = {
    "esa": ("https://gea.esac.esa.int/tap-server/tap", "external.gaiaedr3_distance"),
    # ARI Heidelberg: no 60 s anonymous execution cap (14400 s, 10 M rows). Dense Galactic-plane
    # chunks that always abort on ESA complete here. Counts identical to ESA (mirror_test.json).
    "ari": ("https://gaia.ari.uni-heidelberg.de/tap", "gaiaedr3_complements.distances"),
}
TAP, DIST_TABLE = SERVICES["esa"]
VIZIER_SERVER = "vizier.cfa.harvard.edu"  # CfA VizieR mirror; cdsarc.cds.unistra.fr times out from this host
USER_AGENT = "cosmic-atlas-fetch/1.0 (python-requests)"

ROW_LIMIT = 50_000      # anonymous async default MAXREC (survey jobs stay far below it)
MAXREC = 2_000_000      # explicit MAXREC for fetch jobs (ESA returned 105,743 rows with it, 2026-11-13)
CHUNK_MAX = 45_000      # planned rows per chunk, margin below ROW_LIMIT
CONCURRENCY = 2         # 5 parallel jobs drew 145 HTTP 429 responses from ESA in 50 min (2026-11-13)
MAX_DIST_PC = 1000.0
SID_L12 = 2 ** 35       # source_id // SID_L12 = HEALPix level-12 nested index

# Candidate quality cuts measured by `survey`. Name -> ADQL predicate on (poe, ruwe).
CUTS = {
    "all": None,
    "poe3": "poe > 3",
    "poe5": "poe > 5",
    "poe10": "poe > 10",
    "ruwe": "ruwe < 1.4",
    "poe3_ruwe": "poe > 3 AND ruwe < 1.4",
    "poe5_ruwe": "poe > 5 AND ruwe < 1.4",
    "poe10_ruwe": "poe > 10 AND ruwe < 1.4",
}
# The cut used for v1 (chosen from the survey; see PROVENANCE.json "cut_rationale").
CHOSEN_CUT = "poe10_ruwe"
CHOSEN_WHERE = "g.parallax_over_error > 10 AND g.ruwe < 1.4"

# White-dwarf flag: M_G = G + 5 - 5 log10(r_med_geo) (no extinction correction) lies below the line
# M_G = WD_A + WD_B * (BP-RP), restricted to BP-RP < WD_MAX_COLOR. The line runs through the empty
# gap between the main sequence and the WD cooling sequence of the 100 pc sample (checked in validate).
WD_A, WD_B, WD_MAX_COLOR = 10.0, 2.6, 1.6

GAIA_COLUMNS = [
    "source_id", "ra", "dec", "parallax", "parallax_error", "parallax_over_error",
    "r_med_geo", "r_lo_geo", "r_hi_geo", "phot_g_mean_mag", "bp_rp", "ruwe",
    "pmra", "pmdec", "radial_velocity",
]

CITATIONS = [
    {"ref": "Gaia Collaboration, Vallenari et al. 2023, A&A 674, A1 (Gaia DR3 summary)",
     "doi": "10.1051/0004-6361/202243940"},
    {"ref": "Gaia Collaboration, Prusti et al. 2016, A&A 595, A1 (The Gaia mission)",
     "doi": "10.1051/0004-6361/201629272"},
    {"ref": "Bailer-Jones et al. 2021, AJ 161, 147 (EDR3 distances)",
     "doi": "10.3847/1538-3881/abd806"},
    {"ref": "Gaia Collaboration, Smart et al. 2021, A&A 649, A6 (Gaia Catalogue of Nearby Stars)",
     "doi": "10.1051/0004-6361/202039498"},
    {"ref": "van Leeuwen 2007, A&A 474, 653 (Hipparcos new reduction, VizieR I/311)",
     "doi": "10.1051/0004-6361:20078357"},
]

_print_lock = threading.Lock()


def log(*a):
    with _print_lock:
        print(time.strftime("%H:%M:%S"), *a, flush=True)


# --------------------------------------------------------------------------------------------
# TAP helper
# --------------------------------------------------------------------------------------------
class TapTimeout(RuntimeError):
    """Server aborted the job at its execution-time limit."""


def tap_async(query: str, fmt: str = "csv", poll: float = 2.0, session: requests.Session | None = None) -> str:
    """Run one anonymous async ADQL job, return the result body, delete the job afterwards."""
    s = session or requests.Session()
    s.headers["User-Agent"] = USER_AGENT
    r = s.post(f"{TAP}/async", data=dict(REQUEST="doQuery", LANG="ADQL", FORMAT=fmt,
                                         QUERY=query, PHASE="RUN", MAXREC=str(MAXREC)),
               allow_redirects=False, timeout=60)
    loc = r.headers.get("Location")
    if not loc:
        raise RuntimeError(f"job not created: HTTP {r.status_code} {r.text[:300]}")
    try:
        t0 = time.time()
        while True:
            phase = s.get(f"{loc}/phase", timeout=60).text.strip()
            if phase in ("COMPLETED", "ERROR", "ABORTED"):
                break
            if time.time() - t0 > 600:
                raise RuntimeError(f"job {loc} stuck in {phase}")
            time.sleep(poll)
        if phase != "COMPLETED":
            err = s.get(f"{loc}/error", timeout=60).text
            if "Maximum execution time" in err or phase == "ABORTED":
                raise TapTimeout(err[-300:])
            raise RuntimeError(f"{phase}: {err[-600:]}")
        res = s.get(f"{loc}/results/result", timeout=900)
        res.raise_for_status()
        return res.text
    finally:
        try:
            s.post(loc, data={"ACTION": "DELETE"}, allow_redirects=False, timeout=30)
        except requests.RequestException:
            pass


def with_retries(fn, what: str, tries: int = 5):
    k, throttled = 0, 0
    while k < tries:
        try:
            return fn()
        except TapTimeout:
            raise
        except Exception as e:
            msg = str(e)
            # ESA answered 429 (145x) and 401 (5x) on 2026-11-13 when an anonymous client sent too many jobs.
            # Back off hard and do not spend the normal retry budget on it.
            if ("HTTP 429" in msg or "HTTP 401" in msg) and throttled < 30:
                throttled += 1
                wait = min(60 * throttled, 300)
                log(f"  throttled ({'429' if 'HTTP 429' in msg else '401'}) {what}: sleep {wait}s [{throttled}]")
                time.sleep(wait)
                continue
            k += 1
            wait = 10 * 2 ** (k - 1)
            log(f"  retry {k}/{tries} {what}: {type(e).__name__}: {msg[:200]} (sleep {wait}s)")
            time.sleep(wait)
    raise RuntimeError(f"giving up on {what}")


def utcnow() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sid_range(level: int, pix: int) -> tuple[int, int]:
    step = SID_L12 * 4 ** (12 - level)
    return pix * step, (pix + 1) * step


# --------------------------------------------------------------------------------------------
# survey
# --------------------------------------------------------------------------------------------
def survey_query(lo: int, hi: int) -> str:
    sums = []
    for name, pred in CUTS.items():
        if pred is None:
            sums.append(f"COUNT(*) AS n_{name}")
            continue
        # ADQL on this service has no CASE: build 0/1 indicators with SIGN().
        terms = []
        for p in pred.split(" AND "):
            col, op, val = p.split()
            terms.append(f"(SIGN({col} - {val})+1)/2" if op == ">" else f"(1-SIGN({col} - {val}))/2")
        sums.append(f"SUM({' * '.join(terms)}) AS n_{name}")
    return f"""SELECT hpx6, shell, {', '.join(sums)}
FROM (
 SELECT GAIA_HEALPIX_INDEX(6, d.source_id) AS hpx6, FLOOR(d.r_med_geo/100) AS shell,
        g.parallax_over_error AS poe, g.ruwe AS ruwe
 FROM external.gaiaedr3_distance AS d
 JOIN gaiadr3.gaia_source AS g ON g.source_id = d.source_id
 WHERE d.source_id >= {lo} AND d.source_id < {hi} AND g.source_id >= {lo} AND g.source_id < {hi}
   AND d.r_med_geo < {MAX_DIST_PC:.0f}
) AS t
GROUP BY hpx6, shell"""


def survey_unit(level: int, pix: int) -> list[Path]:
    """Count one pixel; on execution-time abort split into its 4 children."""
    out = SURVEY_DIR / f"l{level}_{pix:06d}.csv"
    if out.exists():
        return [out]
    lo, hi = sid_range(level, pix)
    s = requests.Session()
    try:
        text = with_retries(lambda: tap_async(survey_query(lo, hi), session=s), f"survey l{level} p{pix}")
    except TapTimeout:
        if level >= 6:
            raise
        log(f"  timeout l{level} p{pix} -> split")
        return [p for c in range(4) for p in survey_unit(level + 1, 4 * pix + c)]
    tmp = out.with_suffix(".tmp")
    tmp.write_text(text)
    tmp.rename(out)
    return [out]


def survey_done_pixels() -> set[int]:
    """Level-3 pixels fully covered by existing survey files (directly or via children)."""
    done = set()
    by_l3: dict[int, int] = {}
    for f in SURVEY_DIR.glob("l*_*.csv"):
        lvl, pix = int(f.stem[1:].split("_")[0]), int(f.stem.split("_")[1])
        by_l3[pix >> (2 * (lvl - 3))] = by_l3.get(pix >> (2 * (lvl - 3)), 0) + 4 ** (6 - lvl)
    for p3, cover in by_l3.items():
        if cover >= 4 ** 3:
            done.add(p3)
    return done


def cmd_survey(args):
    SURVEY_DIR.mkdir(parents=True, exist_ok=True)
    todo = [p for p in range(12 * 4 ** 3) if p not in survey_done_pixels()]
    log(f"survey: {len(todo)} level-3 pixels to count")
    t0 = time.time()
    with cf.ThreadPoolExecutor(CONCURRENCY) as ex:
        futs = {ex.submit(survey_unit, 3, p): p for p in todo}
        for i, f in enumerate(cf.as_completed(futs), 1):
            f.result()
            if i % 20 == 0 or i == len(todo):
                log(f"survey {i}/{len(todo)} ({time.time() - t0:.0f}s)")
    tab = load_survey()
    tab.to_parquet(WORK / "survey.parquet", index=False)
    print_survey(tab)


def load_survey() -> pd.DataFrame:
    frames = [pd.read_csv(f) for f in sorted(SURVEY_DIR.glob("l*_*.csv"))]
    tab = pd.concat(frames, ignore_index=True)
    tab = tab.fillna(0)
    for c in tab.columns:
        tab[c] = tab[c].astype(np.int64)
    return tab


def print_survey(tab: pd.DataFrame):
    ncols = [f"n_{k}" for k in CUTS]
    per_shell = tab.groupby("shell")[ncols].sum()
    per_shell.loc["total"] = per_shell.sum()
    with pd.option_context("display.width", 200, "display.max_columns", 20):
        print(per_shell)
        frac = per_shell.div(per_shell["n_all"], axis=0).round(3)
        print("\nfraction of all r_med_geo<1000 sources kept, by 100-pc shell:")
        print(frac)


# --------------------------------------------------------------------------------------------
# plan
# --------------------------------------------------------------------------------------------
def cmd_plan(args):
    tab = pd.read_parquet(WORK / "survey.parquet")
    col = f"n_{CHOSEN_CUT}"
    per_pix = tab.groupby("hpx6")[col].sum().reindex(range(12 * 4 ** 6), fill_value=0)
    if per_pix.max() > CHUNK_MAX:
        raise SystemExit(f"a level-6 pixel has {per_pix.max()} rows > {CHUNK_MAX}; plan at a finer level")
    chunks, start, acc = [], 0, 0
    for pix, n in per_pix.items():
        if acc + n > CHUNK_MAX:
            chunks.append((start, pix, acc))
            start, acc = pix, 0
        acc += int(n)
    chunks.append((start, len(per_pix), acc))
    step6 = SID_L12 * 4 ** 6
    plan = [{"chunk": i, "hpx6_lo": a, "hpx6_hi": b, "sid_lo": a * step6, "sid_hi": b * step6,
             "expected_rows": n} for i, (a, b, n) in enumerate(chunks)]
    PLAN_FILE.write_text(json.dumps({"cut": CHOSEN_CUT, "where": CHOSEN_WHERE, "chunk_max": CHUNK_MAX,
                                     "chunks": plan}, indent=1))
    tot = sum(c["expected_rows"] for c in plan)
    log(f"plan: {len(plan)} chunks, {tot:,} rows, max {max(c['expected_rows'] for c in plan):,} per chunk")


# --------------------------------------------------------------------------------------------
# fetch
# --------------------------------------------------------------------------------------------
def fetch_query(lo: int, hi: int) -> str:
    return f"""SELECT g.source_id, g.ra, g.dec, g.parallax, g.parallax_error, g.parallax_over_error,
 d.r_med_geo, d.r_lo_geo, d.r_hi_geo, g.phot_g_mean_mag, g.bp_rp, g.ruwe,
 g.pmra, g.pmdec, g.radial_velocity
FROM {DIST_TABLE} AS d
JOIN gaiadr3.gaia_source AS g ON g.source_id = d.source_id
WHERE d.source_id >= {lo} AND d.source_id < {hi} AND g.source_id >= {lo} AND g.source_id < {hi}
  AND d.r_med_geo < {MAX_DIST_PC:.0f}"""
# The quality cut (CHOSEN_WHERE) is applied CLIENT-side in apply_cut(): with it in the WHERE clause
# the archive's planner abandons the source_id range scan and every dense chunk hits the 60 s cap
# (measured 2026-11-13 on chunk 0: with cut -> aborted at 60 s; without -> 18.2 s, 105,743 rows,
# 44,766 after the local cut = the survey count exactly).


def apply_cut(df: pd.DataFrame) -> pd.DataFrame:
    return df[(df["parallax_over_error"] > 10) & (df["ruwe"] < 1.4)].reset_index(drop=True)


def wd_flag(g_mag, bp_rp, dist_pc) -> np.ndarray:
    m_g = np.asarray(g_mag, dtype=np.float64) + 5.0 - 5.0 * np.log10(np.asarray(dist_pc, dtype=np.float64))
    c = np.asarray(bp_rp, dtype=np.float64)
    return (m_g > WD_A + WD_B * c) & (c < WD_MAX_COLOR)  # NaN colour -> False


def to_contract(raw: pd.DataFrame) -> pd.DataFrame:
    """Gaia rows -> data-contract columns, raw columns kept."""
    df = pd.DataFrame({
        "id": "Gaia DR3 " + raw["source_id"].astype(str),
        "ra": raw["ra"].astype("float64"),
        "dec": raw["dec"].astype("float64"),
        "dist_pc": raw["r_med_geo"].astype("float64"),
        "dist_lo_pc": raw["r_lo_geo"].astype("float64"),
        "dist_hi_pc": raw["r_hi_geo"].astype("float64"),
        "mag": raw["phot_g_mean_mag"].astype("float32"),
        "color": raw["bp_rp"].astype("float32"),
    })
    kind = np.where(wd_flag(raw["phot_g_mean_mag"], raw["bp_rp"], raw["r_med_geo"]), "wd", "star")
    df["kind"] = pd.Categorical(kind, categories=["star", "wd"])
    for c in GAIA_COLUMNS:
        if c in ("ra", "dec"):
            continue
        df[c] = raw[c]
    df["source_id"] = df["source_id"].astype("int64")
    for c in ("parallax", "parallax_error", "parallax_over_error", "r_med_geo", "r_lo_geo",
              "r_hi_geo", "pmra", "pmdec"):
        df[c] = df[c].astype("float64")
    for c in ("phot_g_mean_mag", "bp_rp", "ruwe", "radial_velocity"):
        df[c] = df[c].astype("float32")
    return df


def fetch_chunk(c: dict) -> int:
    out = OUT / f"gaia_chunk_{c['chunk']:04d}.parquet"
    if out.exists():
        return 0
    s = requests.Session()
    t0 = time.time()
    parts: list[pd.DataFrame] = []
    n_jobs = fetch_range(c["sid_lo"], c["sid_hi"], f"chunk {c['chunk']}", s, parts)
    raw = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=GAIA_COLUMNS)
    n = len(raw)
    if raw["source_id"].duplicated().any():
        raise RuntimeError(f"chunk {c['chunk']}: duplicate source_ids after splitting")
    if n != c["expected_rows"]:
        raise RuntimeError(f"chunk {c['chunk']}: got {n} rows, survey expected {c['expected_rows']}")
    df = to_contract(raw)
    tmp = out.with_suffix(".tmp")
    df.to_parquet(tmp, index=False, compression="zstd")
    tmp.rename(out)
    with _print_lock, open(WORK / "chunk_checks.jsonl", "a") as fh:
        fh.write(json.dumps({"chunk": c["chunk"], "service": TAP, "expected_rows_esa_survey": c["expected_rows"],
                             "rows_received": n, "match": n == c["expected_rows"], "tap_jobs": n_jobs,
                             "seconds": round(time.time() - t0, 1), "utc": utcnow()}) + "\n")
    return n


MAX_SPLIT_DEPTH = 12  # 2**12 sub-ranges per chunk at most


def fetch_range(lo: int, hi: int, what: str, s: requests.Session, parts: list, depth: int = 0) -> int:
    """Fetch [lo, hi). If the ESA job hits the 60 s execution limit (dense sky, e.g. the Galactic
    plane), bisect the source_id range and fetch both halves. Returns the number of TAP jobs run."""
    try:
        text = with_retries(lambda: tap_async(fetch_query(lo, hi), session=s), what)
    except TapTimeout:
        if depth >= MAX_SPLIT_DEPTH or hi - lo < 2:
            raise
        mid = lo + (hi - lo) // 2
        if depth < 3:
            log(f"  timeout {what} depth {depth} -> split")
        return (fetch_range(lo, mid, what, s, parts, depth + 1)
                + fetch_range(mid, hi, what, s, parts, depth + 1))
    df = pd.read_csv(io.StringIO(text), dtype={"source_id": "int64"})
    if len(df) >= MAXREC:
        raise RuntimeError(f"{what}: {len(df)} rows hit MAXREC={MAXREC} (truncated)")
    parts.append(apply_cut(df))
    return 1


def cmd_fetch(args):
    plan = json.loads(PLAN_FILE.read_text())
    assert plan["cut"] == CHOSEN_CUT, "plan was made for another cut; rerun `plan`"
    chunks = [c for c in plan["chunks"] if c["expected_rows"] > 0]
    todo = [c for c in chunks if not (OUT / f"gaia_chunk_{c['chunk']:04d}.parquet").exists()]
    if args.only:
        todo = [c for c in todo if c["chunk"] in set(args.only)]
    if args.limit:
        todo = todo[: args.limit]
    log(f"fetch: {len(todo)} of {len(chunks)} chunks to download")
    started = utcnow()
    t0, rows, failed = time.time(), 0, []
    with cf.ThreadPoolExecutor(CONCURRENCY) as ex:
        futs = {ex.submit(fetch_chunk, c): c["chunk"] for c in todo}
        for i, f in enumerate(cf.as_completed(futs), 1):
            try:
                rows += f.result()
            except Exception as e:
                failed.append(futs[f])
                log(f"  FAILED chunk {futs[f]}: {e}")
            if i % 10 == 0 or i == len(todo):
                el = time.time() - t0
                log(f"fetch {i}/{len(todo)} chunks, {rows:,} rows, {el:.0f}s, "
                    f"eta {el / i * (len(todo) - i):.0f}s")
    runs_file = WORK / "fetch_runs.json"
    runs = json.loads(runs_file.read_text()) if runs_file.exists() else []
    runs.append({"started_utc": started, "finished_utc": utcnow(), "chunks_attempted": len(todo),
                 "rows_written": rows, "failed_chunks": sorted(failed)})
    runs_file.write_text(json.dumps(runs, indent=1))
    if failed:
        raise SystemExit(f"{len(failed)} chunks failed: {sorted(failed)[:20]} ... rerun `fetch`")


def cmd_all(args):
    for f in (cmd_survey, cmd_plan, cmd_fetch, cmd_bright, cmd_validate, cmd_provenance):
        f(args)


# --------------------------------------------------------------------------------------------
# bright supplement (Hipparcos new reduction, I/311)
# --------------------------------------------------------------------------------------------
BRIGHT_HP_MAX = 4.0        # Hipparcos Hp magnitude limit for the supplement
GOOD_MATCH_DMAG = 1.0      # |G - Hp| above this means the best neighbour is another star
HIP_COLUMNS = ["HIP", "RArad", "DErad", "Plx", "e_Plx", "pmRA", "pmDE", "Hpmag", "B-V", "V-I"]


def load_hip2() -> pd.DataFrame:
    cache = WORK / "hip2.parquet"
    if cache.exists():
        return pd.read_parquet(cache)
    from astroquery.vizier import Vizier
    v = Vizier(columns=HIP_COLUMNS, row_limit=-1, vizier_server=VIZIER_SERVER)
    t = v.get_catalogs("I/311/hip2")[0]
    df = t.to_pandas()
    WORK.mkdir(parents=True, exist_ok=True)
    df.to_parquet(cache, index=False)
    return df


def gaia_for_hip(hips) -> pd.DataFrame:
    """Gaia DR3 best neighbour (+ EDR3 geometric distance) for a list of HIP numbers."""
    rows = []
    hips = [int(h) for h in hips]
    for i in range(0, len(hips), 2000):
        ids = ",".join(map(str, hips[i:i + 2000]))
        q = f"""SELECT x.original_ext_source_id AS hip, x.source_id, x.angular_distance,
 g.phot_g_mean_mag, g.bp_rp, g.parallax, g.parallax_error, g.parallax_over_error, g.ruwe,
 d.r_med_geo, d.r_lo_geo, d.r_hi_geo
FROM gaiadr3.hipparcos2_best_neighbour AS x
JOIN gaiadr3.gaia_source AS g ON g.source_id = x.source_id
LEFT OUTER JOIN external.gaiaedr3_distance AS d ON d.source_id = x.source_id
WHERE x.original_ext_source_id IN ({ids})"""
        text = with_retries(lambda: tap_async(q), "hip match")
        rows.append(pd.read_csv(io.StringIO(text), dtype={"source_id": "int64"}))
    out = pd.concat(rows, ignore_index=True)
    out["source_id"] = out["source_id"].astype("Int64")  # stays exact through left merges
    return out


def fit_hip_to_gaia(hip: pd.DataFrame) -> dict:
    """Fit G - Hp and BP - RP as cubic polynomials of Hipparcos B-V on well-measured stars.

    Calibration sample: HIP < 40000 (an RA slice keeps the job under the row cap), good one-to-one
    match, 6 < G < 9 (fainter than the bright-star saturation regime), ruwe < 1.4.
    """
    cal_hip = hip[(hip.HIP < 40000) & hip.Hpmag.between(6, 9.3)]
    m = gaia_for_hip(cal_hip.HIP)
    j = cal_hip.merge(m, left_on="HIP", right_on="hip")
    j = j[j.phot_g_mean_mag.between(6, 9) & (j.ruwe < 1.4) & j.bp_rp.notna() & j["B-V"].notna()
          & ((j.phot_g_mean_mag - j.Hpmag).abs() < 0.5)]
    x = j["B-V"].to_numpy(float)
    out = {"n_calibration": int(len(j))}
    for name, y in (("g_minus_hp", (j.phot_g_mean_mag - j.Hpmag).to_numpy(float)),
                    ("bp_rp", j.bp_rp.to_numpy(float))):
        coef = np.polyfit(x, y, 3)
        resid = y - np.polyval(coef, x)
        out[name] = {"coef_high_to_low": coef.tolist(), "rms": float(np.sqrt(np.mean(resid ** 2))),
                     "valid_b_v": [float(np.percentile(x, 0.5)), float(np.percentile(x, 99.5))]}
    return out


def cmd_bright(args):
    hip = load_hip2()
    bright = hip[hip.Hpmag < BRIGHT_HP_MAX].copy()
    m = gaia_for_hip(bright.HIP)
    j = bright.merge(m, left_on="HIP", right_on="hip", how="left")
    plx_hip, e_hip = j.Plx.to_numpy(float), j.e_Plx.to_numpy(float)
    matched = j.source_id.notna().to_numpy()
    same_star = matched & ((j.phot_g_mean_mag - j.Hpmag).abs() < GOOD_MATCH_DMAG).to_numpy()
    in_sel = same_star & (j.r_med_geo < MAX_DIST_PC).to_numpy() & (j.parallax_over_error > 5).to_numpy()
    sig = np.sqrt(e_hip ** 2 + j.parallax_error.to_numpy(float) ** 2)
    consistent = np.abs(j.parallax.to_numpy(float) - plx_hip) < 3 * sig
    good = in_sel & ((j.ruwe < 1.4).to_numpy() | consistent)
    within = plx_hip > 1000.0 / MAX_DIST_PC
    take = ~good & within
    # Gaia rows that a supplement row replaces (bad astrometry for a bright star, Hipparcos used
    # instead). Merging code must drop Gaia rows whose source_id is listed in gaia_source_id_superseded.
    supersede = take & in_sel

    fit = fit_hip_to_gaia(hip)
    s = j[take].copy()
    bv = s["B-V"].to_numpy(float)
    lo, hi = fit["g_minus_hp"]["valid_b_v"]
    bv_c = np.clip(bv, lo, hi)
    g_est = s.Hpmag.to_numpy(float) + np.polyval(fit["g_minus_hp"]["coef_high_to_low"], bv_c)
    g_est = np.where(np.isnan(bv), s.Hpmag.to_numpy(float), g_est)
    lo, hi = fit["bp_rp"]["valid_b_v"]
    bprp_est = np.polyval(fit["bp_rp"]["coef_high_to_low"], np.clip(bv, lo, hi))
    plx, e = s.Plx.to_numpy(float), s.e_Plx.to_numpy(float)
    out = pd.DataFrame({
        "id": "HIP " + s.HIP.astype(int).astype(str),
        "ra": s.RArad.astype("float64").to_numpy(),
        "dec": s.DErad.astype("float64").to_numpy(),
        "dist_pc": 1000.0 / plx,
        "dist_lo_pc": 1000.0 / (plx + e),
        "dist_hi_pc": np.where(plx > e, 1000.0 / np.where(plx > e, plx - e, 1.0), np.nan),
        "mag": g_est.astype("float32"),
        "color": bprp_est.astype("float32"),
        "kind": pd.Categorical(["star"] * len(s), categories=["star", "wd"]),
        "hip": s.HIP.astype("int64").to_numpy(),
        "parallax": plx, "parallax_error": e, "parallax_over_error": plx / e,
        "pmra": s.pmRA.astype("float64").to_numpy(), "pmdec": s.pmDE.astype("float64").to_numpy(),
        "hp_mag": s.Hpmag.astype("float32").to_numpy(), "b_v": s["B-V"].astype("float32").to_numpy(),
        "gaia_source_id_superseded": s.source_id.astype("Int64").where(supersede[take]).to_numpy(),
    })
    out["gaia_source_id_superseded"] = out["gaia_source_id_superseded"].astype("Int64")
    out = out.sort_values("mag").reset_index(drop=True)
    out.to_parquet(OUT / "bright_supplement.parquet", index=False, compression="zstd")
    stats = {
        "hp_max": BRIGHT_HP_MAX, "n_hip_bright": int(len(bright)),
        "n_with_gaia_best_neighbour": int(matched.sum()),
        "n_best_neighbour_same_star": int(same_star.sum()),
        "n_gaia_in_selection": int(in_sel.sum()),
        "n_good_gaia_kept": int(good.sum()),
        "n_hip_beyond_1kpc_skipped": int((~good & ~within).sum()),
        "n_supplement_rows": int(len(out)),
        "n_supplement_superseding_gaia_row": int(supersede.sum()),
        "photometry_fit": fit,
    }
    (WORK / "bright_stats.json").write_text(json.dumps(stats, indent=1))
    log(json.dumps({k: v for k, v in stats.items() if k != "photometry_fit"}))
    log(f"G-Hp fit rms {fit['g_minus_hp']['rms']:.3f}, BP-RP fit rms {fit['bp_rp']['rms']:.3f} "
        f"(n={fit['n_calibration']})")


# --------------------------------------------------------------------------------------------
# validate
# --------------------------------------------------------------------------------------------
REFERENCE_STARS = ["Proxima Cen", "Barnard star", "Sirius", "Vega", "Betelgeuse", "Polaris",
                   "Aldebaran", "61 Cyg A"]
SIMBAD_SERVER = "simbad.harvard.edu"  # CfA SIMBAD mirror (astroquery-recognised name)


def galactic_xyz(ra, dec, dist_pc) -> np.ndarray:
    from astropy.coordinates import SkyCoord
    import astropy.units as u
    c = SkyCoord(ra=np.atleast_1d(ra) * u.deg, dec=np.atleast_1d(dec) * u.deg,
                 distance=np.atleast_1d(dist_pc) * u.pc, frame="icrs").galactic
    return np.stack([c.cartesian.x.to_value(u.pc), c.cartesian.y.to_value(u.pc),
                     c.cartesian.z.to_value(u.pc)], axis=-1)


def simbad_reference() -> pd.DataFrame:
    import re
    from astroquery.simbad import Simbad
    s = Simbad()
    s.server = SIMBAD_SERVER
    s.add_votable_fields("parallax", "ids")
    t = s.query_objects(REFERENCE_STARS)
    rows = []
    for r in t:
        g = re.search(r"Gaia DR3 (\d+)", str(r["ids"]))
        h = re.search(r"HIP (\d+)", str(r["ids"]))
        rows.append({"name": str(r["user_specified_id"]).strip(), "main_id": str(r["main_id"]),
                     "ra": float(r["ra"]), "dec": float(r["dec"]), "plx": float(r["plx_value"]),
                     "plx_err": float(r["plx_err"]),
                     "gaia_dr3": int(g.group(1)) if g else None, "hip": int(h.group(1)) if h else None})
    ids = {c: pd.array([r.pop(c) for r in rows], dtype="Int64") for c in ("gaia_dr3", "hip")}
    out = pd.DataFrame(rows)
    for c, v in ids.items():  # exact int64 ids (Gaia ids exceed float64 precision)
        out[c] = v
    return out


def gaia_files() -> list[Path]:
    return sorted(OUT.glob("gaia_chunk_*.parquet"))


def cmd_validate(args):
    import pyarrow.parquet as pq
    files = gaia_files()
    cols = ["source_id", "ra", "dec", "dist_pc", "dist_lo_pc", "dist_hi_pc", "mag", "color", "kind",
            "ruwe", "parallax_over_error", "radial_velocity"]
    df = pd.concat([pd.read_parquet(f, columns=cols) for f in files], ignore_index=True)
    plan = json.loads(PLAN_FILE.read_text())
    expected = sum(c["expected_rows"] for c in plan["chunks"])
    n_chunks_expected = sum(1 for c in plan["chunks"] if c["expected_rows"] > 0)
    rep: dict = {"validated_utc": utcnow()}
    rep["gaia_chunks_on_disk"] = len(files)
    rep["gaia_chunks_planned"] = n_chunks_expected
    rep["gaia_rows"] = int(len(df))
    rep["gaia_rows_planned"] = int(expected)
    rep["source_id_unique"] = bool(df.source_id.is_unique)
    rep["dist_pc_max"] = float(df.dist_pc.max())
    rep["dist_pc_min"] = float(df.dist_pc.min())
    rep["poe_min"] = float(df.parallax_over_error.min())
    rep["dist_lo_le_med_le_hi"] = bool(((df.dist_lo_pc <= df.dist_pc) & (df.dist_pc <= df.dist_hi_pc)).all())
    rep["frac_ruwe_gt_1p4"] = float((df.ruwe > 1.4).mean())
    rep["frac_color_nan"] = float(df.color.isna().mean())
    rep["frac_mag_nan"] = float(df.mag.isna().mean())
    rep["n_with_radial_velocity"] = int(df.radial_velocity.notna().sum())
    rep["kind_counts"] = {k: int(v) for k, v in df.kind.value_counts().items()}
    rep["wd_within_100pc"] = int(((df.kind == "wd") & (df.dist_pc < 100)).sum())
    shells = (df.dist_pc // 100).astype(int)
    rep["rows_per_100pc_shell"] = {f"{100 * k}-{100 * k + 100}": int(v)
                                   for k, v in shells.value_counts().sort_index().items()}
    mag_bins = pd.cut(df.mag, [-5, 3, 6, 9, 12, 15, 18, 19, 20, 21, 25])
    rep["rows_per_G_bin"] = {str(k): int(v) for k, v in mag_bins.value_counts().sort_index().items()}

    bright = pd.read_parquet(OUT / "bright_supplement.parquet")
    superseded = set(bright.gaia_source_id_superseded.dropna().astype("int64"))
    rep["bright_rows"] = int(len(bright))
    rep["bright_superseded_gaia_rows_present"] = int(df.source_id.isin(superseded).sum())

    # Known stars, looked up by the identifiers SIMBAD gives for each name.
    ref = simbad_reference()
    by_sid = df.set_index("source_id")
    known = []
    for r in ref.to_dict("records"):
        r["gaia_dr3"] = int(r["gaia_dr3"]) if pd.notna(r["gaia_dr3"]) else None
        r["hip"] = int(r["hip"]) if pd.notna(r["hip"]) else None
        row = {"name": r["name"], "simbad_main_id": r["main_id"],
               "simbad_dist_pc": 1000.0 / r["plx"] if r["plx"] > 0 else None}
        hit = None
        if r["gaia_dr3"] and r["gaia_dr3"] in by_sid.index and r["gaia_dr3"] not in superseded:
            g = by_sid.loc[r["gaia_dr3"]]
            hit = {"id": f"Gaia DR3 {r['gaia_dr3']}", "ra": g.ra, "dec": g.dec, "dist_pc": g.dist_pc,
                   "mag_G": g.mag, "color": g.color, "ruwe": g.ruwe, "source": "gaia"}
        elif r["hip"] and (bright.hip == r["hip"]).any():
            b = bright[bright.hip == r["hip"]].iloc[0]
            hit = {"id": b.id, "ra": b.ra, "dec": b.dec, "dist_pc": b.dist_pc, "mag_G": b.mag,
                   "color": b.color, "ruwe": None, "source": "hipparcos_supplement"}
        if hit:
            xyz = galactic_xyz(hit["ra"], hit["dec"], hit["dist_pc"])[0]
            xyz_s = galactic_xyz(r["ra"], r["dec"], 1000.0 / r["plx"])[0]
            hit.update({"xyz_pc": xyz.round(4).tolist(), "simbad_xyz_pc": xyz_s.round(4).tolist(),
                        "xyz_diff_pc": float(np.linalg.norm(xyz - xyz_s)),
                        "xyz_diff_frac": float(np.linalg.norm(xyz - xyz_s) / np.linalg.norm(xyz_s))})
            hit = {k: (float(v) if isinstance(v, (np.floating, np.integer)) else v) for k, v in hit.items()}
            row.update(hit)
        else:
            row["id"] = None
            row["missing_reason"] = (f"gaia_dr3={r['gaia_dr3']} hip={r['hip']} not in either table")
        known.append(row)
    rep["known_stars"] = known

    sizes = {f.name: f.stat().st_size for f in OUT.glob("*.parquet")}
    rep["bytes_gaia_parquet"] = int(sum(v for k, v in sizes.items() if k.startswith("gaia_chunk_")))
    rep["bytes_bright_parquet"] = int(sizes.get("bright_supplement.parquet", 0))
    rep["bytes_work_dir"] = int(sum(f.stat().st_size for f in WORK.rglob("*") if f.is_file()))
    (WORK / "validate.json").write_text(json.dumps(rep, indent=1, default=str))

    print(json.dumps({k: v for k, v in rep.items() if k != "known_stars"}, indent=1, default=str))
    kdf = pd.DataFrame(known)
    with pd.option_context("display.width", 250, "display.max_columns", 30):
        print(kdf[[c for c in ["name", "id", "source", "dist_pc", "simbad_dist_pc", "mag_G", "color",
                               "ruwe", "xyz_diff_pc", "xyz_diff_frac", "missing_reason"] if c in kdf]])
    problems = []
    if rep["gaia_rows"] != expected:
        problems.append("row count differs from plan")
    if not rep["source_id_unique"]:
        problems.append("duplicate source_id")
    if rep["dist_pc_max"] >= MAX_DIST_PC:
        problems.append("dist_pc >= 1000")
    if any(k.get("id") is None for k in known):
        problems.append("reference star missing")
    print("PROBLEMS:", problems or "none")


# --------------------------------------------------------------------------------------------
# provenance
# --------------------------------------------------------------------------------------------
CUT_RATIONALE = (
    "Budget target was ~30 M rows (soft). Survey (all 768 level-3 pixels) shows every candidate cut "
    "except poe>10 & ruwe<1.4 is far above it (see survey_counts_total). ruwe<1.4 is kept because the "
    "inner shells are polluted by spurious astrometric solutions: within 100 pc only ~63% of BJ21 "
    "sources have ruwe<1.4 and the uncut 100 pc count (~480 k full sky) far exceeds the ~331 k real "
    "stars of the Gaia Catalogue of Nearby Stars (Gaia Collaboration, Smart et al. 2021, "
    "doi:10.1051/0004-6361/202039498); the nearest shells are the most visible part of a 3D map. "
    "poe>10 makes r_med_geo likelihood-dominated (prior-independent) so 3D positions are good to "
    "~10%; it drops mainly faint stars at 500-1000 pc. Approved by the coordinator 2026-11-13 "
    "(~37 M rows estimated before the survey finished).")


def summarize_chunk_checks() -> dict:
    f = WORK / "chunk_checks.jsonl"
    rows = [json.loads(x) for x in f.read_text().splitlines()] if f.exists() else []
    return {"file": "_work/chunk_checks.jsonl", "n_chunks_checked": len(rows),
            "n_match": sum(r["match"] for r in rows),
            "rule": "each chunk's received row count must equal the ESA survey count for its source_id range, "
                    "else the chunk is rejected and refetched"}


def cmd_provenance(args):
    plan = json.loads(PLAN_FILE.read_text())
    tab = pd.read_parquet(WORK / "survey.parquet")
    ncols = [f"n_{k}" for k in CUTS]
    tot = tab[ncols].sum()
    per_shell = tab.groupby("shell")[ncols].sum()
    val = json.loads((WORK / "validate.json").read_text())
    bright = json.loads((WORK / "bright_stats.json").read_text())
    runs = json.loads((WORK / "fetch_runs.json").read_text())
    kept, allr = int(tot[f"n_{CHOSEN_CUT}"]), int(tot["n_all"])
    prov = {
        "layer": "stars-gaia",
        "title": "Gaia DR3 stars within 1 kpc (+ Hipparcos bright-star supplement)",
        "script": "scripts/fetch_gaia.py",
        "files": {
            "gaia_chunk_*.parquet": f"{val['gaia_chunks_on_disk']} files, {val['gaia_rows']} rows "
                                    f"(source_id ranges listed in _work/chunks.json)",
            "bright_supplement.parquet": f"{val['bright_rows']} rows",
        },
        "services": {
            "gaia_tap": TAP,
            "vizier": f"https://{VIZIER_SERVER} (astroquery.vizier, catalogue I/311/hip2)",
            "simbad_validation": f"https://{SIMBAD_SERVER} (astroquery.simbad)",
        },
        "service_limits_measured": {
            "anonymous_async_row_limit": ROW_LIMIT, "anonymous_async_execution_s": 60,
            "measured_utc": "2026-11-13",
        },
        "query_survey_template": survey_query(0, 1).replace("source_id >= 0", "source_id >= {sid_lo}")
                                                   .replace("source_id < 1", "source_id < {sid_hi}"),
        "query_fetch_template": fetch_query(0, 1).replace("source_id >= 0", "source_id >= {sid_lo}")
                                                 .replace("source_id < 1", "source_id < {sid_hi}"),
        "partitioning": ("source_id ranges = runs of consecutive HEALPix level-6 nested pixels "
                         "(source_id // 2**35 // 4**6), packed to <= "
                         f"{CHUNK_MAX} rows; each chunk's row count checked against the survey count"),
        "fetch_runs_utc": runs,
        "cuts": {
            "distance": "Bailer-Jones et al. 2021 geometric r_med_geo < 1000 pc",
            "quality": CHOSEN_WHERE,
            "not_applied": "no photometric cut",
        },
        "cut_rationale": args.rationale if getattr(args, "rationale", None) else CUT_RATIONALE,
        "survey_counts_total": {k: int(v) for k, v in tot.items()},
        "survey_counts_per_100pc_shell": {str(int(s)): {k: int(v) for k, v in r.items()}
                                          for s, r in per_shell.iterrows()},
        "fraction_dropped_by_quality_cut": 1 - kept / allr,
        "fraction_kept_per_cut_per_100pc_shell": {
            str(int(sh)): {k: round(int(v) / int(r["n_all"]), 4) for k, v in r.items()}
            for sh, r in per_shell.iterrows()},
        "ruwe_argument_100pc": {
            "n_all_lt_100pc": int(per_shell.loc[0, "n_all"]),
            "n_ruwe_lt_1p4_lt_100pc": int(per_shell.loc[0, "n_ruwe"]),
            "n_chosen_lt_100pc": int(per_shell.loc[0, f"n_{CHOSEN_CUT}"]),
            "gcns_reference_real_stars_lt_100pc": 331312,
            "gcns_doi": "10.1051/0004-6361/202039498"},
        "mirror_test": json.loads((WORK / "mirror_test.json").read_text()),
        "per_chunk_count_check": summarize_chunk_checks(),
        "columns": {
            "contract": ["id", "ra", "dec", "dist_pc", "dist_lo_pc", "dist_hi_pc", "mag", "color", "kind"],
            "mapping": {"id": "'Gaia DR3 ' + source_id", "ra/dec": "gaia_source ICRS, epoch J2016.0",
                        "dist_pc": "r_med_geo", "dist_lo_pc": "r_lo_geo (16th pct)",
                        "dist_hi_pc": "r_hi_geo (84th pct)", "mag": "phot_g_mean_mag",
                        "color": "bp_rp"},
            "extra": [c for c in GAIA_COLUMNS if c not in ("ra", "dec")],
        },
        "white_dwarf_flag": (f"kind='wd' if M_G > {WD_A} + {WD_B}*bp_rp and bp_rp < {WD_MAX_COLOR}, "
                             "M_G = G + 5 - 5*log10(r_med_geo); no extinction correction"),
        "bright_supplement": {
            "catalogue": "Hipparcos new reduction, van Leeuwen 2007 (VizieR I/311/hip2)",
            "selection": (f"Hpmag < {BRIGHT_HP_MAX} and Plx > 1 mas, without a good Gaia DR3 counterpart in "
                          "the Gaia selection. Good = gaiadr3.hipparcos2_best_neighbour exists, "
                          f"|G - Hp| < {GOOD_MATCH_DMAG}, in the selection (r_med_geo<1000, poe>5), and "
                          "(ruwe < 1.4 or Gaia/Hipparcos parallaxes agree within 3 sigma)"),
            "ra_dec_epoch": "J1991.25 (Hipparcos catalogue epoch), ICRS",
            "dist": "dist_pc = 1000/Plx, dist_lo_pc = 1000/(Plx+e_Plx), dist_hi_pc = 1000/(Plx-e_Plx)",
            "mag_color": ("mag = Hp + f(B-V), color = g(B-V): cubic fits to Gaia DR3 G-Hp and BP-RP of "
                          "6<G<9, ruwe<1.4 Hipparcos stars (B-V clipped to the fit range)"),
            "dedupe_rule": ("rows with non-null gaia_source_id_superseded replace that Gaia DR3 row "
                            "(bright star with poor Gaia astrometry); drop that source_id from the Gaia "
                            "chunks when merging"),
            "stats": bright,
        },
        "validation": val,
        "citations": CITATIONS,
        "acknowledgement": ("This work has made use of data from the European Space Agency (ESA) mission "
                            "Gaia (https://www.cosmos.esa.int/gaia), processed by the Gaia Data Processing "
                            "and Analysis Consortium (DPAC)."),
        "written_utc": utcnow(),
    }
    (OUT / "PROVENANCE.json").write_text(json.dumps(prov, indent=1, default=str))
    log(f"wrote {OUT / 'PROVENANCE.json'}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("stage", choices=["survey", "plan", "fetch", "bright", "validate", "provenance", "all"])
    ap.add_argument("--limit", type=int, default=0, help="fetch: only this many chunks (testing)")
    ap.add_argument("--rationale", default=None, help="provenance: override the cut rationale text")
    ap.add_argument("--service", choices=sorted(SERVICES), default="esa",
                    help="TAP service for `fetch` (survey/plan counts always come from ESA)")
    ap.add_argument("--only", type=int, nargs="*", default=None, help="fetch: only these chunk numbers")
    args = ap.parse_args()
    global TAP, DIST_TABLE
    TAP, DIST_TABLE = SERVICES[args.service]
    {"survey": cmd_survey, "plan": cmd_plan, "fetch": cmd_fetch, "bright": cmd_bright,
     "validate": cmd_validate, "provenance": cmd_provenance, "all": cmd_all}[args.stage](args)


if __name__ == "__main__":
    main()
