"""Small I/O helpers shared by the catalogue fetch scripts: polite HTTP with retries,
VizieR ASU-TSV reader (CfA mirror; cdsarc.cds.unistra.fr times out from this host),
SIMBAD TAP (Harvard mirror) and JSON writing for data/tiles/catalogs/.
"""
from __future__ import annotations

import datetime as dt
import io
import json
import math
import time
from pathlib import Path

import numpy as np
import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[1]
VIZIER = "https://vizier.cfa.harvard.edu/viz-bin/asu-tsv"
SIMBAD_TAP = "https://simbad.harvard.edu/simbad/sim-tap/sync"
GAIA_TAP = "https://gea.esac.esa.int/tap-server/tap/sync"
UA = {"User-Agent": "cosmic-atlas-fetch/1.0 (research visualisation; python-requests)"}


def utcnow() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def http(method: str, url: str, retries: int = 5, timeout: int = 300, **kw) -> requests.Response:
    delay = 5.0
    for attempt in range(1, retries + 1):
        try:
            r = requests.request(method, url, timeout=timeout, headers=UA, **kw)
            if r.status_code >= 500 or r.status_code == 429:
                raise requests.HTTPError(f"HTTP {r.status_code}")
            r.raise_for_status()
            return r
        except (requests.RequestException, requests.HTTPError) as exc:
            if attempt == retries:
                raise
            print(f"  {url[:80]} attempt {attempt}: {exc}; retry in {delay:.0f}s", flush=True)
            time.sleep(delay)
            delay *= 2
    raise RuntimeError("unreachable")


def download(url: str, dest: Path, refresh: bool = False) -> Path:
    """Download once (cached); returns path."""
    if dest.exists() and dest.stat().st_size > 0 and not refresh:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    r = http("GET", url)
    tmp = dest.with_suffix(dest.suffix + ".tmp")
    tmp.write_bytes(r.content)
    tmp.rename(dest)
    return dest


def vizier_params(source: str, columns: list[str] | None = None, extra: dict | None = None) -> list:
    """ASU parameters as a list of pairs (VizieR wants one -out per column, not a comma list)."""
    p = [("-source", source), ("-out.max", "unlimited"), ("-oc.form", "dec"),
         ("-out.add", "_RAJ"), ("-out.add", "_DEJ")]
    if columns:
        p += [("-out", c) for c in columns]
    else:
        p.append(("-out.all", ""))
    if extra:
        p += list(extra.items())
    return p


def vizier_url(params: list) -> str:
    return requests.Request("GET", VIZIER, params=params).prepare().url


def read_vizier_tsv(text: str) -> pd.DataFrame:
    """Parse VizieR ASU-TSV: header line, units line, dashes line, then rows."""
    lines = [ln for ln in text.splitlines() if ln and not ln.startswith("#")]
    if len(lines) < 3:
        return pd.DataFrame()
    header = lines[0].split("\t")
    body = "\n".join(lines[3:])
    df = pd.read_csv(io.StringIO(body), sep="\t", names=header, dtype=str, keep_default_na=False)
    return df.apply(lambda c: c.str.strip())


def fetch_vizier(source: str, cache: Path, columns: list[str] | None = None,
                 extra: dict | None = None, refresh: bool = False) -> tuple[pd.DataFrame, str]:
    params = vizier_params(source, columns, extra)
    url = vizier_url(params)
    if refresh or not cache.exists():
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(http("GET", VIZIER, params=params).text)
    return read_vizier_tsv(cache.read_text()), url


def num(s: pd.Series) -> np.ndarray:
    return pd.to_numeric(s, errors="coerce").to_numpy(dtype=float)


def tap_sync(url: str, adql: str, fmt: str = "csv", timeout: int = 600) -> pd.DataFrame:
    data = {"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": fmt, "QUERY": adql}
    r = http("POST", url, data=data, timeout=timeout)
    txt = r.text
    if txt.lstrip().startswith("<"):
        raise RuntimeError(f"TAP error: {txt[:500]}")
    return pd.read_csv(io.StringIO(txt), dtype={"source_id": "Int64"})


def clean(v):
    """JSON-safe scalar (NaN -> None, numpy -> python)."""
    if v is None:
        return None
    if isinstance(v, (np.floating, float)):
        return None if not math.isfinite(float(v)) else float(v)
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.bool_,)):
        return bool(v)
    return v


def write_catalog_json(path: Path, entries: list[dict], drop_none: bool = False) -> int:
    """Write a top-level JSON array of entries (contract section 4; provenance lives in the
    layer's data/raw/<layer>/PROVENANCE.json). Contract keys first, extras after. Returns bytes.
    drop_none: leave out keys whose value is None (for large catalogues; readers treat a missing
    key like null)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    order = ["name", "alt", "kind", "ra", "dec", "dist_pc", "mag", "xyz", "ref"]
    out = []
    for e in entries:
        d = {k: clean(e.get(k)) if k not in ("alt", "xyz") else e.get(k) for k in order}
        for k, v in e.items():
            if k not in d:
                d[k] = clean(v) if not isinstance(v, (list, dict)) else v
        if drop_none:
            d = {k: v for k, v in d.items() if v is not None}
        out.append(d)
    path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    return path.stat().st_size


# --- object catalogues (black holes, exoplanets, pulsars, nebulae/SNRs, SETI) -------------
# Downloads are cached under data/cache/<name>/ (gitignored); each build writes its provenance
# block next to the catalogue, data/tiles/catalogs/provenance/<name>.json (committed).
CACHE = ROOT / "data" / "cache"
CATS = ROOT / "data" / "tiles" / "catalogs"


def write_provenance(name: str, prov: dict) -> Path:
    path = CATS / "provenance" / f"{name}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(prov, indent=2, ensure_ascii=False, default=clean) + "\n")
    return path


def sig(x, n: int = 4):
    """Round to n significant digits (None for None/NaN)."""
    if x is None:
        return None
    x = float(x)
    if not math.isfinite(x):
        return None
    if x == 0:
        return 0.0
    return float(f"{x:.{n}g}")
