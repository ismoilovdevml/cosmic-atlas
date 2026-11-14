"""Resumable, parallel Range download of one large Zenodo file, verified against the record's md5.

Zenodo serves ~0.4-0.5 MB/s per connection from this host (measured 2026-11-14), so a 3 GB file
needs many connections. Chunks are written in place into a pre-sized file; a sidecar JSON lists the
finished chunks, so an interrupted run resumes. After the last chunk the whole file is hashed (md5 to
compare with Zenodo's checksum, sha256 for PROVENANCE.json).

Usage (also called from build_dust.py):
  python scripts/zenodo_fetch.py <record_id> <file_key> <dest> [--workers 16]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests

UA = {"User-Agent": "cosmic-atlas-fetch/1.0 (research visualisation; python-requests)"}
CHUNK = 16 * 1024 * 1024


def record_file(record: str, key: str) -> dict:
    r = requests.get(f"https://zenodo.org/api/records/{record}", headers=UA, timeout=60)
    r.raise_for_status()
    rec = r.json()
    for f in rec["files"]:
        if f["key"] == key:
            return {"key": key, "size": int(f["size"]), "checksum": f["checksum"],
                    "url": f"https://zenodo.org/api/records/{record}/files/{key}/content",
                    "doi": rec.get("doi"), "version": rec["metadata"].get("version"),
                    "license": rec["metadata"].get("license", {}).get("id")}
    raise SystemExit(f"{key} not in Zenodo record {record}")


def hash_file(path: Path) -> tuple[str, str]:
    md5, sha = hashlib.md5(), hashlib.sha256()
    with open(path, "rb") as fh:
        while True:
            b = fh.read(64 * 1024 * 1024)
            if not b:
                break
            md5.update(b)
            sha.update(b)
    return md5.hexdigest(), sha.hexdigest()


def fetch(record: str, key: str, dest: Path, workers: int = 16) -> dict:
    info = record_file(record, key)
    size = info["size"]
    dest.parent.mkdir(parents=True, exist_ok=True)
    done_path = dest.with_suffix(dest.suffix + ".chunks.json")
    final_path = dest.with_suffix(dest.suffix + ".verified.json")
    if dest.exists() and final_path.exists():
        v = json.loads(final_path.read_text())
        if v.get("size") == size and v.get("md5") == info["checksum"].removeprefix("md5:"):
            return {**info, **v}
    n = (size + CHUNK - 1) // CHUNK
    done: set[int] = set(json.loads(done_path.read_text())) if done_path.exists() and dest.exists() else set()
    if not dest.exists() or dest.stat().st_size != size:
        with open(dest, "wb") as fh:
            fh.truncate(size)
        done = set()
    todo = [i for i in range(n) if i not in done]
    print(f"{key}: {size:,} B, {n} chunks, {len(todo)} to fetch with {workers} connections", flush=True)
    lock = threading.Lock()
    fd = os.open(dest, os.O_RDWR)
    t0 = time.time()
    got = [0]

    def one(i: int) -> int:
        a, b = i * CHUNK, min(size, (i + 1) * CHUNK) - 1
        for attempt in range(8):
            try:
                r = requests.get(info["url"], headers={**UA, "Range": f"bytes={a}-{b}"}, timeout=600)
                if r.status_code != 206 or len(r.content) != b - a + 1:
                    raise IOError(f"chunk {i}: HTTP {r.status_code}, {len(r.content)} B")
                os.pwrite(fd, r.content, a)
                return i
            except Exception as exc:  # noqa: BLE001
                print(f"  chunk {i} attempt {attempt}: {exc}", flush=True)
                time.sleep(min(60, 5 * 2 ** attempt))
        raise IOError(f"chunk {i} failed")

    try:
        with ThreadPoolExecutor(workers) as ex:
            futs = [ex.submit(one, i) for i in todo]
            for f in as_completed(futs):
                i = f.result()
                with lock:
                    done.add(i)
                    got[0] += 1
                    if got[0] % 8 == 0 or len(done) == n:
                        done_path.write_text(json.dumps(sorted(done)))
                        mb = got[0] * CHUNK / 1e6
                        dt = time.time() - t0
                        print(f"  {len(done)}/{n} chunks, {mb / dt:.1f} MB/s", flush=True)
    finally:
        os.close(fd)
    md5, sha = hash_file(dest)
    want = info["checksum"].removeprefix("md5:")
    if md5 != want:
        raise SystemExit(f"md5 mismatch for {key}: {md5} != {want}")
    v = {"size": size, "md5": md5, "sha256": sha, "verified_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    final_path.write_text(json.dumps(v, indent=2))
    done_path.unlink(missing_ok=True)
    return {**info, **v}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("record")
    ap.add_argument("key")
    ap.add_argument("dest", type=Path)
    ap.add_argument("--workers", type=int, default=16)
    a = ap.parse_args()
    print(json.dumps(fetch(a.record, a.key, a.dest, a.workers), indent=2))
    sys.exit(0)
