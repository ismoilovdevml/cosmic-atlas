#!/usr/bin/env python3
"""Archive a tile set on Zenodo and get a DOI for it.

Usage:
  scripts/zenodo_deposit.py --file pages-tiles-v2.tar.gz --meta deploy/zenodo-tiles-v2.json [--publish]
  scripts/zenodo_deposit.py --resume <deposition id> --publish

The personal access token (scopes: deposit:write, deposit:actions) is read from
~/.config/cosmic-atlas/zenodo.env as ZENODO_TOKEN=... and is never printed.
Without --publish the deposit stays a private draft you can review at zenodo.org/uploads.
Publishing is permanent: a published DOI cannot be deleted, only superseded by a new version.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

import requests

ENV = Path.home() / ".config/cosmic-atlas/zenodo.env"


def token() -> str:
    tok = os.environ.get("ZENODO_TOKEN")
    if not tok and ENV.exists():
        for line in ENV.read_text().splitlines():
            if line.strip().startswith("ZENODO_TOKEN="):
                tok = line.split("=", 1)[1].strip().strip("'\"")
    if not tok:
        sys.exit(f"no ZENODO_TOKEN in the environment or {ENV}")
    return tok


def md5(path: Path) -> str:
    h = hashlib.md5()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def check(r: requests.Response, what: str) -> dict:
    if r.status_code >= 300:
        sys.exit(f"{what}: HTTP {r.status_code} {r.text[:500]}")
    return r.json() if r.content else {}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", type=Path)
    ap.add_argument("--meta", type=Path, help="JSON with a 'metadata' object (legacy deposit API)")
    ap.add_argument("--resume", help="existing draft deposition id")
    ap.add_argument("--publish", action="store_true")
    ap.add_argument("--sandbox", action="store_true", help="use sandbox.zenodo.org")
    a = ap.parse_args()

    api = "https://sandbox.zenodo.org/api" if a.sandbox else "https://zenodo.org/api"
    s = requests.Session()
    s.headers["Authorization"] = f"Bearer {token()}"

    if a.resume:
        dep = check(s.get(f"{api}/deposit/depositions/{a.resume}"), "get draft")
    else:
        if not (a.file and a.meta):
            sys.exit("--file and --meta are needed for a new deposit")
        meta = json.loads(a.meta.read_text())
        dep = check(s.post(f"{api}/deposit/depositions", json=meta), "create draft")
        print(f"draft {dep['id']} created")
        size = a.file.stat().st_size
        print(f"uploading {a.file.name} ({size / 1e6:.0f} MB)…", flush=True)
        with a.file.open("rb") as f:
            up = check(s.put(f"{dep['links']['bucket']}/{a.file.name}", data=f,
                             headers={"Content-Type": "application/octet-stream"}), "upload")
        local = md5(a.file)
        remote = up.get("checksum", "").removeprefix("md5:")
        if remote != local:
            sys.exit(f"checksum mismatch: local md5 {local}, Zenodo {remote}; draft {dep['id']} kept")
        print(f"uploaded, md5 {local} matches")

    doi = dep.get("metadata", {}).get("prereserve_doi", {}).get("doi")
    print(f"draft: {dep['links'].get('html')}  reserved DOI: {doi}")
    if a.publish:
        pub = check(s.post(f"{api}/deposit/depositions/{dep['id']}/actions/publish"), "publish")
        print(f"published: DOI {pub.get('doi')}  record {pub['links'].get('record_html') or pub['links'].get('html')}")
        print(f"concept DOI (all versions): {pub.get('conceptdoi')}")


if __name__ == "__main__":
    main()
