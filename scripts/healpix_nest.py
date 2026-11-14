"""HEALPix NESTED pixel <-> direction, vectorised numpy (no healpy dependency).

Port of the reference algorithms in healpix_base (Gorski et al. 2005, ApJ 622, 759): `loc2pix` and
`pix2loc` for the NESTED scheme. Checked on 2026-11-14 against healpy 1.20.1 (installed in a
throwaway venv only): every pixel centre for nside 1/4/64/256 within 7e-15, and 0 of 2,000,000
random directions (plus the six axis directions) assigned to a different pixel at nside 1/64/256.
"""
from __future__ import annotations

import numpy as np

JRLL = np.array([2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4], dtype=np.int64)
JPLL = np.array([1, 3, 5, 7, 0, 2, 4, 6, 1, 3, 5, 7], dtype=np.int64)


def _spread(v: np.ndarray) -> np.ndarray:
    """spread the low 16 bits of v to the even bit positions"""
    v = v.astype(np.int64) & 0xFFFF
    v = (v | (v << 8)) & 0x00FF00FF
    v = (v | (v << 4)) & 0x0F0F0F0F
    v = (v | (v << 2)) & 0x33333333
    v = (v | (v << 1)) & 0x55555555
    return v


def _compress(v: np.ndarray) -> np.ndarray:
    """inverse of _spread: even bits -> low 16 bits"""
    v = v.astype(np.int64) & 0x55555555
    v = (v | (v >> 1)) & 0x33333333
    v = (v | (v >> 2)) & 0x0F0F0F0F
    v = (v | (v >> 4)) & 0x00FF00FF
    v = (v | (v >> 8)) & 0x0000FFFF
    return v


def vec2pix_nest(nside: int, x: np.ndarray, y: np.ndarray, z: np.ndarray) -> np.ndarray:
    """NESTED pixel index of (not necessarily normalised) direction vectors"""
    x, y, z = (np.asarray(a, dtype=np.float64) for a in (x, y, z))
    n = np.sqrt(x * x + y * y + z * z)
    n = np.where(n > 0, n, 1.0)
    zn = z / n
    phi = np.arctan2(y, x)
    za = np.abs(zn)
    tt = np.mod(phi, 2 * np.pi) * (2 / np.pi)  # [0, 4)
    tt = np.where(tt >= 4.0, 0.0, tt)
    pix = np.empty(zn.shape, dtype=np.int64)

    eq = za <= 2.0 / 3.0
    if eq.any():
        t1 = nside * (0.5 + tt[eq])
        t2 = nside * zn[eq] * 0.75
        jp = (t1 - t2).astype(np.int64)
        jm = (t1 + t2).astype(np.int64)
        ifp = jp // nside
        ifm = jm // nside
        face = np.where(ifp == ifm, ifp | 4, np.where(ifp < ifm, ifp, ifm + 8))
        ix = jm & (nside - 1)
        iy = nside - (jp & (nside - 1)) - 1
        pix[eq] = face * nside * nside + _spread(ix) + (_spread(iy) << 1)
    po = ~eq
    if po.any():
        ttp = tt[po]
        ntt = np.minimum(3, ttp.astype(np.int64))
        tp = ttp - ntt
        tmp = nside * np.sqrt(3.0 * (1.0 - za[po]))
        jp = np.minimum((tp * tmp).astype(np.int64), nside - 1)
        jm = np.minimum(((1.0 - tp) * tmp).astype(np.int64), nside - 1)
        north = zn[po] >= 0
        face = np.where(north, ntt, ntt + 8)
        ix = np.where(north, nside - jm - 1, jp)
        iy = np.where(north, nside - jp - 1, jm)
        pix[po] = face * nside * nside + _spread(ix) + (_spread(iy) << 1)
    return pix


def pix2vec_nest(nside: int, pix: np.ndarray) -> np.ndarray:
    """unit vectors (N, 3) of NESTED pixel centres"""
    pix = np.asarray(pix, dtype=np.int64)
    npface = nside * nside
    npix = 12 * npface
    face = pix // npface
    ipf = pix & (npface - 1)
    ix = _compress(ipf)
    iy = _compress(ipf >> 1)
    jr = JRLL[face] * nside - ix - iy - 1
    fact2 = 4.0 / npix
    fact1 = (nside << 1) * fact2
    nr = np.where(jr < nside, jr, np.where(jr > 3 * nside, 4 * nside - jr, nside))
    z = np.where(jr < nside, 1.0 - nr * nr * fact2,
                 np.where(jr > 3 * nside, nr * nr * fact2 - 1.0, (2 * nside - jr) * fact1))
    kshift = np.where((jr >= nside) & (jr <= 3 * nside), (jr - nside) & 1, 0)
    jp = (JPLL[face] * nr + ix - iy + 1 + kshift) // 2
    nl4 = 4 * nside
    jp = np.where(jp > nl4, jp - nl4, jp)
    jp = np.where(jp < 1, jp + nl4, jp)
    phi = (jp - (kshift + 1) * 0.5) * ((np.pi / 2) / nr)
    st = np.sqrt(np.maximum(0.0, 1.0 - z * z))
    return np.stack([st * np.cos(phi), st * np.sin(phi), z], axis=-1)
