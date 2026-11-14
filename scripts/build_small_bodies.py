#!/usr/bin/env python3
"""Build data/tiles/small-bodies/: asteroid and comet orbits for the GPU Kepler layer.

Sources (Minor Planet Center, downloaded once into data/cache/mpc/):
  MPCORB.DAT.gz    https://minorplanetcenter.net/iau/MPCORB/MPCORB.DAT.gz  (all numbered and
                   unnumbered minor planets; osculating heliocentric elements, J2000 ecliptic)
  AllCometEls.txt  https://minorplanetcenter.net/iau/MPCORB/AllCometEls.txt (all comets and A/ objects)
  Distant.txt      only used to cross-check that the TNO/Centaur subset of MPCORB is complete

Terms: the MPCORB header says "Software programs may include this datafile amongst their
datasets, as long as this header is included (it is acceptable if it is contained in a file
separate from the actual data) and that proper attribution to the Minor Planet Center is given
[...] Information on how to obtain updated copies of the datafile must also be included."
So the header is written verbatim to small-bodies/MPCORB_HEADER.txt next to the binaries, and
meta.json carries the attribution and the download URLs.

Record layout (little-endian), one file per orbit class, records sorted by H (brightest first,
so drawing the first K records is a magnitude cut):
  float32 x 7 per object, interleaved:  q [AU], e, i, node, peri [rad], tp [days], H [mag]
      tp = time of perihelion passage minus the reference epoch (TT). For e < 1 it is the
      passage nearest the reference epoch (|tp| <= P/2), found by two-body propagation of the
      MPC mean anomaly from the object's own epoch in float64. Perihelion distance + perihelion
      time (instead of a, M) describe ellipses, parabolas and hyperbolas alike (comets, 1I, 3I).
  uint8 x 1 per object, after the float block: low nibble = sub-class (see SUBCLASSES),
      high nibble = MPC uncertainty parameter U (0-9; 10 = 'E' assumed e; 11 = 'D'/'F'; 15 = blank).

Classes (from a, e, q, i only, no resonance test; JPL SBDB-style limits):
  neo      q < 1.3 AU                                   (Atira / Aten / Apollo / Amor)
  trojan   4.6 < a < 5.5 AU, e < 0.3                    (Jupiter trojans; L4 / L5 from lambda - lambda_J)
  centaur  5.5 <= a < 30.1 AU                           (and the 4.6-5.5 AU objects with e >= 0.3)
  tno      a >= 30.1 AU
  main     everything else                              (Hungaria, Mars-crossers, inner/middle/outer belt, Hildas)
  comet    AllCometEls.txt
Pluto (134340) is left out: the Solar System layer already draws it from astronomy-engine.

usage: build_small_bodies.py [--cache data/cache/mpc] [--out data/tiles/small-bodies]
"""
from __future__ import annotations

import argparse
import gzip
import json
import math
import re
import sys
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
K_GAUSS = 0.01720209895  # rad/day, Gaussian gravitational constant (heliocentric two-body, massless)
DEG = math.pi / 180
MPC = "https://minorplanetcenter.net/iau/MPCORB/"
CLASSES = ["neo", "main", "trojan", "centaur", "tno", "comet"]
SUBCLASSES = {
    "neo": ["Atira", "Aten", "Apollo", "Amor"],
    "main": ["Hungaria", "Mars-crosser", "inner main belt", "middle main belt", "outer main belt", "Hilda", "other"],
    "trojan": ["L4", "L5"],
    "centaur": ["Centaur", "Jupiter-region, e >= 0.3"],
    "tno": ["3:2 resonant (plutino-like a)", "classical belt", "scattered disc", "detached", "other"],
    "comet": ["periodic", "long-period", "parabolic / hyperbolic", "interstellar", "asteroidal (A/)"],
}
DWARF = {1: "Ceres", 136199: "Eris", 136108: "Haumea", 136472: "Makemake"}
SKIP_NUMBERS = {134340}  # Pluto: drawn by the Solar System layer


# ------------------------------------------------------------------ dates

def jd_from_ymd(y: int, m: int, d: float) -> float:
    """Julian date of a proleptic Gregorian calendar date (Meeus ch. 7); valid for y > -4712."""
    if m <= 2:
        y -= 1
        m += 12
    a = math.floor(y / 100)
    b = 2 - a + math.floor(a / 4)
    if y < 1583:  # MPC uses the Julian calendar before 1582-10-15
        b = 0
    return math.floor(365.25 * (y + 4716)) + math.floor(30.6001 * (m + 1)) + d + b - 1524.5


def unpack_epoch(s: str) -> float:
    """MPC packed epoch 'K2669' -> JD TT (0h)."""
    cent = {"I": 18, "J": 19, "K": 20}[s[0]]
    y = cent * 100 + int(s[1:3])
    dig = lambda c: int(c) if c.isdigit() else ord(c) - 55  # A=10
    return jd_from_ymd(y, dig(s[3]), dig(s[4]))


# ------------------------------------------------------------------ classification

def jupiter_mean_longitude(jd: float) -> float:
    """Jupiter's mean longitude, J2000 ecliptic (rad); Standish (1992) approximate elements 1800-2050."""
    T = (jd - 2451545.0) / 36525.0
    return math.radians((34.39644051 + 3034.74612775 * T) % 360.0)


def classify(a, e, q, inc_deg, lam, lam_j):
    """vectorised class index (CLASSES) and sub-class"""
    n = len(a)
    cls = np.full(n, 1, np.uint8)
    sub = np.zeros(n, np.uint8)
    Q = a * (1 + e)
    neo = q < 1.3
    troj = (~neo) & (a > 4.6) & (a < 5.5) & (e < 0.3)
    cen = (~neo) & (~troj) & (((a >= 5.5) & (a < 30.1)) | ((a > 4.6) & (a < 5.5)))
    tno = (~neo) & (a >= 30.1)
    cls[neo], cls[troj], cls[cen], cls[tno] = 0, 2, 3, 4
    # NEO groups
    s = np.where(Q < 0.983, 0, np.where(a < 1.0, 1, np.where(q < 1.017, 2, 3)))
    sub[neo] = s[neo]
    # main belt and friends
    mb = cls == 1
    m = np.full(n, 6, np.uint8)
    m[(a >= 2.82) & (a < 3.7)] = 4
    m[(a >= 2.5) & (a < 2.82)] = 3
    m[a < 2.5] = 2
    m[(a > 3.7) & (a < 4.2)] = 5
    m[(q >= 1.3) & (q < 1.666)] = 1
    m[(a > 1.78) & (a < 2.0) & (e < 0.18) & (inc_deg > 16) & (inc_deg < 34)] = 0
    sub[mb] = m[mb]
    # trojans: leading (L4) when ahead of Jupiter
    d = (lam - lam_j + math.pi) % (2 * math.pi) - math.pi
    sub[troj] = np.where(d[troj] > 0, 0, 1)
    sub[cen] = np.where(a[cen] < 5.5, 1, 0)
    t = np.full(n, 4, np.uint8)
    t[(a > 47) & (q < 38)] = 2
    t[(a > 50) & (q >= 38)] = 3
    t[(a >= 40.5) & (a <= 47) & (e < 0.24)] = 1
    t[(a >= 39.0) & (a <= 39.8)] = 0
    sub[tno] = t[tno]
    return cls, sub


# ------------------------------------------------------------------ MPCORB

def read_mpcorb(path: Path):
    with gzip.open(path, "rt", encoding="ascii", errors="replace") as f:
        text = f.read()
    head, _, body = text.partition("\n----------")
    lines = [l for l in body.splitlines() if len(l) > 150 and l[0] != "-"]
    return head.rstrip() + "\n", lines


def parse_mpcorb(lines):
    n = len(lines)
    f = lambda a, b: np.array([l[a:b] for l in lines])
    H = np.array([float(x) if x.strip() else np.nan for x in f(8, 13)], np.float64)
    ep = f(20, 25)
    M = f(26, 35).astype(np.float64)
    peri = f(37, 46).astype(np.float64)
    node = f(48, 57).astype(np.float64)
    inc = f(59, 68).astype(np.float64)
    e = f(70, 79).astype(np.float64)
    a = f(92, 103).astype(np.float64)
    U = f(105, 106)
    name = [l[166:194].strip() for l in lines]
    return dict(n=n, H=H, ep=ep, M=M, peri=peri, node=node, inc=inc, e=e, a=a, U=U, name=name,
                desig=[l[0:7].strip() for l in lines], arc=[l[127:136].strip() for l in lines],
                nopp=f(123, 126))


def u_code(u: str) -> int:
    u = u.strip()
    if u.isdigit():
        return int(u)
    return {"E": 10, "D": 11, "F": 11}.get(u, 15)


# ------------------------------------------------------------------ comets

def parse_comets(path: Path, ref_jd: float):
    rows = []
    for l in path.read_text(encoding="latin-1").splitlines():
        if len(l) < 103:
            continue
        try:
            y, mo, d = int(l[14:18]), int(l[19:21]), float(l[22:29])
            q, e = float(l[30:39]), float(l[41:49])
            peri, node, inc = float(l[51:59]), float(l[61:69]), float(l[71:79])
        except ValueError:
            continue
        ep = l[81:89].strip()
        H = float(l[91:95]) if l[91:95].strip() else np.nan
        name = l[102:158].strip()
        tp = jd_from_ymd(y, mo, d) - ref_jd
        rows.append(dict(q=q, e=e, peri=peri, node=node, inc=inc, tp=tp, H=H, name=name, desig=l[0:12].strip(),
                         epoch=jd_from_ymd(int(ep[:4]), int(ep[4:6]), int(ep[6:8])) if len(ep) == 8 else None))
    return rows


def comet_sub(name: str, e: float) -> int:
    if re.match(r"^\d+I/", name):
        return 3
    if name.startswith("A/"):
        return 4
    if e >= 1.0:
        return 2
    if re.match(r"^\d+[PD]/|^[PD]/", name):
        return 0
    return 1


# ------------------------------------------------------------------ main

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--cache", default=str(ROOT / "data/cache/mpc"))
    ap.add_argument("--out", default=str(ROOT / "data/tiles/small-bodies"))
    ap.add_argument("--hmax", type=float, default=None, help="optional faint cut for the main belt (H > hmax dropped)")
    a_ = ap.parse_args(argv)
    cache, out = Path(a_.cache), Path(a_.out)
    out.mkdir(parents=True, exist_ok=True)
    src = {k: cache / k for k in ("MPCORB.DAT.gz", "AllCometEls.txt", "Distant.txt")}
    for k, p in src.items():
        if not p.exists():
            print(f"missing {p}: download {MPC}{k} first (curl -R -o {p} {MPC}{k})", file=sys.stderr)
            return 1
    mtime = {k: datetime.fromtimestamp(p.stat().st_mtime, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") for k, p in src.items()}

    header, lines = read_mpcorb(src["MPCORB.DAT.gz"])
    (out / "MPCORB_HEADER.txt").write_text(
        header + f"\n[cosmic-atlas] Elements re-packed from MPCORB.DAT (file time {mtime['MPCORB.DAT.gz']}) by "
        "scripts/build_small_bodies.py. Updated copies: https://minorplanetcenter.net/iau/MPCORB/MPCORB.DAT.gz\n")
    d = parse_mpcorb(lines)
    n = d["n"]
    print(f"MPCORB: {n} records")
    # reference epoch = the MPC standard epoch (the most common one)
    vals, counts = np.unique(d["ep"], return_counts=True)
    ref_packed = vals[np.argmax(counts)]
    ref_jd = unpack_epoch(ref_packed)
    epoch_jd = np.array([unpack_epoch(s) for s in d["ep"]])
    at_ref = int(np.sum(epoch_jd == ref_jd))
    print(f"reference epoch {ref_packed} = JD {ref_jd} TT ({at_ref} of {n} records at it)")

    numbers = np.array([int(m.group(1)) if (m := re.match(r"\((\d+)\)", nm)) else 0 for nm in d["name"]])
    keep = ~np.isin(numbers, list(SKIP_NUMBERS)) & (d["e"] < 1.0) & (d["a"] > 0)
    e, a = d["e"], d["a"]
    q = a * (1 - e)
    nrad = K_GAUSS / a ** 1.5
    # mean anomaly at the reference epoch (two-body, float64), wrapped to [-pi, pi)
    Mref = np.radians(d["M"]) + nrad * (ref_jd - epoch_jd)
    Mref = (Mref + math.pi) % (2 * math.pi) - math.pi
    tp = -Mref / nrad
    h_unknown = np.isnan(d["H"]) | (d["H"] >= 99)  # blank or the 99.99 placeholder
    H = np.where(h_unknown, 20.0, d["H"])
    lam = np.radians(d["node"] + d["peri"]) + Mref
    cls, sub = classify(a, e, q, d["inc"], lam, jupiter_mean_longitude(ref_jd))
    ucode = np.array([u_code(u) for u in d["U"]], np.uint8)
    flags = (sub & 0x0F) | (ucode << 4)

    rec_all = np.stack([q, e, np.radians(d["inc"]), np.radians(d["node"]), np.radians(d["peri"]), tp, H], axis=1)
    meta_classes = []
    index_of = {}  # MPCORB row -> (class, position in its file)
    cut_note = None
    for ci, cname in enumerate(CLASSES[:-1]):
        sel = np.where(keep & (cls == ci))[0]
        if cname == "main" and a_.hmax is not None:
            before = len(sel)
            sel = sel[H[sel] <= a_.hmax]
            cut_note = f"main belt: H <= {a_.hmax} kept ({len(sel)} of {before})"
        sel = sel[np.argsort(H[sel], kind="stable")]
        for j, r in enumerate(sel):
            index_of[int(r)] = (cname, j)
        meta_classes.append(write_class(out, cname, rec_all[sel], flags[sel], H[sel], epoch_jd[sel] - ref_jd,
                                        [d["desig"][int(r)] for r in sel]))

    # comets
    com = parse_comets(src["AllCometEls.txt"], ref_jd)
    for c in com:
        if c["e"] < 1.0:  # nearest perihelion passage to the reference epoch (two-body period)
            P = 2 * math.pi / (K_GAUSS / (c["q"] / (1 - c["e"])) ** 1.5)
            if P < 1e6:
                c["tp"] -= P * round(c["tp"] / P)
    com.sort(key=lambda c: (np.nan_to_num(c["H"], nan=99.0)))
    crec = np.array([[c["q"], c["e"], c["inc"] * DEG, c["node"] * DEG, c["peri"] * DEG, c["tp"], 15.0 if np.isnan(c["H"]) else c["H"]] for c in com])
    cflags = np.array([comet_sub(c["name"], c["e"]) | (15 << 4) for c in com], np.uint8)
    meta_classes.append(write_class(out, "comet", crec, cflags, crec[:, 6],
                                    np.array([(c["epoch"] - ref_jd) if c["epoch"] else np.nan for c in com]),
                                    [c["name"] or c["desig"] for c in com]))

    # cross-check: Distant.txt (TNOs, Centaurs, SDOs) should be inside MPCORB's centaur + tno classes
    dist_lines = [l for l in src["Distant.txt"].read_text(encoding="latin-1").splitlines() if len(l) > 150]
    dist_des = {l[0:7].strip() for l in dist_lines}
    mp_des = {d["desig"][i]: i for i in range(n)}
    missing = [x for x in dist_des if x not in mp_des]
    in_cls = sum(1 for x in dist_des if x in mp_des and cls[mp_des[x]] in (3, 4))
    print(f"Distant.txt: {len(dist_des)} objects, {len(missing)} not in MPCORB, {in_cls} classed centaur/tno here")

    names = build_names(d, numbers, index_of, rec_all, epoch_jd, ref_jd, ucode, cls, sub, com, crec)
    names["mpcorb_file_time"] = mtime["MPCORB.DAT.gz"]
    (out / "names.json").write_text(json.dumps(names, separators=(",", ":"), ensure_ascii=False) + "\n")

    total = sum(c["bytes"] for c in meta_classes)
    desig_total = sum(c["desig"]["bytes"] for c in meta_classes)
    meta = {
        "version": 1,
        "title": "Asteroids and comets (MPC osculating elements, two-body)",
        "ref_epoch_jd_tt": ref_jd,
        "ref_epoch_packed": ref_packed,
        "k_gauss": K_GAUSS,
        "frame": "heliocentric, ecliptic and equinox J2000.0 (MPC); viewer rotates to ICRS (obliquity 84381.448 arcsec) then Galactic",
        "record": {"floats": ["q_au", "e", "i_rad", "node_rad", "peri_rad", "tp_days_from_ref", "H"], "float_bytes": 28,
                   "flags": "uint8 after the float block: low nibble sub-class, high nibble U (10=E, 11=D/F, 15=blank)",
                   "order": "H ascending within each file"},
        "subclasses": SUBCLASSES,
        "classes": meta_classes,
        "total_bytes": total,
        "desig_bytes": desig_total,
        "all_files_bytes": None,
        "names": {"file": "names.json", "count": len(names["entries"]), "bytes": (out / "names.json").stat().st_size},
        "counts": {"mpcorb_records": n, "at_reference_epoch": at_ref, "h_unknown_set_to_20": int(np.sum(h_unknown)), "left_out": {"pluto_134340": int(np.sum(np.isin(numbers, list(SKIP_NUMBERS))))},
                   "comet_records": len(com), "distant_txt": len(dist_des), "distant_not_in_mpcorb": len(missing),
                   "distant_classed_centaur_tno": in_cls},
        "cut": cut_note or "none: every MPCORB record except Pluto is kept",
        "credit": "Orbits: IAU Minor Planet Center (MPCORB, AllCometEls), osculating elements; two-body propagation by the viewer",
        "terms": "MPCORB header (MPCORB_HEADER.txt): software may include the data file if the header is included and the MPC is credited; updated copies at https://minorplanetcenter.net/iau/MPCORB/",
        "sources": {k: {"url": MPC + k, "file_time_utc": mtime[k]} for k in src},
        "built_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    meta["all_files_bytes"] = sum(f.stat().st_size for f in out.rglob("*") if f.is_file() and f.name != "meta.json")
    (out / "meta.json").write_text(json.dumps(meta, indent=1) + "\n")
    for c in meta_classes:
        print(f"  {c['id']:8s} {c['count']:>9,d} objects  {c['bytes'] / 1e6:6.2f} MB  H {c['h_min']:.1f}..{c['h_max']:.1f}")
    print(f"designation chunks {desig_total / 1e6:.2f} MB; every file {meta['all_files_bytes'] / 1e6:.2f} MB")
    print(f"total {total / 1e6:.2f} MB in {len(meta_classes)} files; names.json {len(names['entries'])} entries "
          f"{(out / 'names.json').stat().st_size / 1e3:.0f} kB")
    return 0


DESIG_CHUNK = 65536


def write_class(out: Path, cname: str, rec: np.ndarray, flags: np.ndarray, H: np.ndarray, epoch_off: np.ndarray,
                desig: list[str]) -> dict:
    f32 = rec.astype("<f4")
    blob = f32.tobytes() + flags.astype(np.uint8).tobytes()
    (out / f"{cname}.bin").write_bytes(blob)
    # designations (MPC packed form; comets: their names) in chunks of DESIG_CHUNK records, one per
    # line in file order, fetched by the viewer only when someone clicks an object of that chunk
    dd = out / "desig"
    dd.mkdir(exist_ok=True)
    nchunk = 0
    dbytes = 0
    for k in range(0, len(desig), DESIG_CHUNK):
        f = dd / f"{cname}-{k // DESIG_CHUNK}.txt"
        f.write_text("\n".join(desig[k:k + DESIG_CHUNK]) + "\n", encoding="utf-8")
        dbytes += f.stat().st_size
        nchunk += 1
    sub_counts = {}
    for s in range(16):
        k = int(np.sum((flags & 0x0F) == s))
        if k:
            sub_counts[SUBCLASSES[cname][s] if s < len(SUBCLASSES[cname]) else str(s)] = k
    ep = np.abs(epoch_off[np.isfinite(epoch_off)])
    return {"id": cname, "file": f"{cname}.bin", "count": int(len(rec)), "bytes": len(blob),
            "desig": {"chunk": DESIG_CHUNK, "files": nchunk, "bytes": dbytes},
            "h_min": float(np.min(H)) if len(H) else 0, "h_max": float(np.max(H)) if len(H) else 0,
            "h_quantiles": {str(p): round(float(np.percentile(H, p)), 2) for p in (10, 50, 90)} if len(H) else {},
            "subclasses": sub_counts,
            "epoch_offset_days": {"median_abs": round(float(np.median(ep)), 1) if len(ep) else None,
                                  "over_365": int(np.sum(ep > 365)), "over_3650": int(np.sum(ep > 3650))}}


def r7(x: float) -> float:
    return float(f"{x:.8g}")


def build_names(d, numbers, index_of, rec_all, epoch_jd, ref_jd, ucode, cls, sub, com, crec):
    """search entries: named numbered asteroids with H < 12, every named NEO / trojan / Centaur / TNO,
    and every comet with a name or a periodic number; elements included so search works before the
    class binaries are in"""
    entries = []
    for r, (cname, j) in index_of.items():
        nm = d["name"][r]
        m = re.match(r"\((\d+)\) (.*)", nm)
        if not m:
            continue
        num, rest = int(m.group(1)), m.group(2).strip()
        proper = not re.match(r"^\d{4} [A-Z]{2}\d*$|^\d{4} [PT]-L$|^\d+ [PT]-L$|^[PT]-L|^\d{4} ", rest)
        H = rec_all[r, 6]
        if not proper:
            continue
        if not (H < 12 or cname in ("neo", "trojan", "centaur", "tno")):
            continue
        dwarf = num in DWARF
        label = dwarf or H < 6.0 or num in (433, 951, 243, 21, 4179, 25143, 101955, 162173, 99942, 486958, 90377, 50000, 90482, 225088, 65803, 3200, 52246)
        entries.append({"n": rest, "num": num, "c": cname, "i": j, "el": [r7(x) for x in rec_all[r]],
                        "ep": round(float(epoch_jd[r] - ref_jd), 1), "u": int(ucode[r]), "opp": d["nopp"][r].strip(),
                        "arc": d["arc"][r], **({"dp": 1} if dwarf else {}), **({"lbl": 1} if label else {})})
    seen = set()
    # famous comets get a map label (and their bare name, e.g. "NEOWISE", as a search alias)
    famous = re.compile(r"^(1P/|2P/|9P/|12P/|17P/|19P/|21P/|29P/|46P/|55P/|67P/|81P/|103P/|109P/|153P/|1I/|2I/|3I/)"
                        r"|^C/1995 O1 |^C/2020 F3 |^C/1996 B2 |^C/2023 A3 |^C/2006 P1 |^C/2011 L4 ")
    for j, c in enumerate(com):
        nm = c["name"]
        if nm in seen:
            continue
        if not (re.match(r"^\d+[PDI]/", nm) or "(" in nm):
            continue
        seen.add(nm)
        entries.append({"n": nm, "c": "comet", "i": j, "el": [r7(x) for x in crec[j]],
                        "ep": round(c["epoch"] - ref_jd, 1) if c["epoch"] else None, **({"lbl": 1} if famous.search(nm) else {})})
    return {"ref_epoch_jd_tt": ref_jd, "fields": {"n": "name", "num": "MPC number", "c": "class file", "i": "record index in it",
            "el": "q,e,i,node,peri,tp,H as in the binary", "ep": "own element epoch minus reference (days)", "u": "U code",
            "opp": "oppositions", "arc": "observed arc", "dp": "dwarf planet", "lbl": "drawn with a map label"},
            "entries": entries}


if __name__ == "__main__":
    sys.exit(main())
