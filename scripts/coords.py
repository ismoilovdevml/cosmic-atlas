"""Shared coordinate / distance helpers for the fetch scripts (independent of pipeline/).

Frame (docs/data-contract.md section 1): heliocentric Galactic Cartesian, origin = Sun,
+x toward l=0,b=0 (Galactic Centre), +y toward l=90, +z toward the NGP. Unit: parsec.
"""
from __future__ import annotations

import numpy as np
import astropy.units as u
from astropy.coordinates import SkyCoord
from astropy.cosmology import Planck18

PC_PER_MPC = 1.0e6


def galactic_xyz(ra_deg, dec_deg, dist_pc) -> np.ndarray:
    """ICRS (ra, dec in deg) + distance in pc -> (N, 3) heliocentric Galactic Cartesian pc.

    Scalars return shape (3,). NaN distances give NaN rows.
    """
    ra = np.atleast_1d(np.asarray(ra_deg, dtype=float))
    dec = np.atleast_1d(np.asarray(dec_deg, dtype=float))
    d = np.atleast_1d(np.asarray(dist_pc, dtype=float))
    g = SkyCoord(ra=ra * u.deg, dec=dec * u.deg, frame="icrs").galactic
    l = g.l.radian
    b = g.b.radian
    cb = np.cos(b)
    out = np.column_stack([d * cb * np.cos(l), d * cb * np.sin(l), d * np.sin(b)])
    return out[0] if np.ndim(ra_deg) == 0 else out


def xyz_list(ra_deg, dec_deg, dist_pc, ndigits: int = 4) -> list | None:
    """Single object -> [x, y, z] rounded for JSON (None if distance unknown)."""
    if dist_pc is None or not np.isfinite(dist_pc):
        return None
    x = galactic_xyz(float(ra_deg), float(dec_deg), float(dist_pc))
    scale = max(abs(float(dist_pc)), 1.0)
    # keep ~6 significant digits regardless of scale (pc for stars, Mpc-scale for galaxies)
    nd = max(ndigits - int(np.floor(np.log10(scale))) + 2, 0)
    return [round(float(v), nd) for v in x]


# --- Planck18 comoving distance via a dense interpolation table -------------------------
# astropy integrates numerically per element for Planck18 (radiation + massive neutrinos),
# which is slow for ~1e7 redshifts. A 0..8 grid with dz=5e-4 + linear interpolation is
# exact to < 1e-5 relative for z >= 0.003 (checked in self_test()).

_ZGRID = np.linspace(0.0, 8.0, 16001)
_DCGRID = Planck18.comoving_distance(_ZGRID).to_value(u.pc)


def comoving_pc(z) -> np.ndarray:
    """Planck18 line-of-sight comoving distance in pc (NaN for z<0 or z>8)."""
    z = np.asarray(z, dtype=float)
    out = np.interp(z, _ZGRID, _DCGRID, left=np.nan, right=np.nan)
    return out


_DLGRID = (1.0 + _ZGRID) * _DCGRID  # Planck18 luminosity distance, monotonic in z


def z_from_lumdist_pc(dl) -> np.ndarray:
    """Planck18 redshift of a luminosity distance in pc (inverse of d_L(z) = (1+z) d_C(z); NaN past z=8)."""
    return np.interp(np.asarray(dl, dtype=float), _DLGRID, _ZGRID, left=np.nan, right=np.nan)


def lumdist_to_comoving_pc(dl) -> np.ndarray:
    """Planck18 comoving distance for a luminosity distance (both pc): d_C = d_L / (1 + z(d_L))."""
    dl = np.asarray(dl, dtype=float)
    return dl / (1.0 + z_from_lumdist_pc(dl))


def distmod_to_pc(mu):
    """Distance modulus (m-M)_0 -> pc."""
    return 10.0 ** (np.asarray(mu, dtype=float) / 5.0 + 1.0)


C_KMS = 299792.458


def self_test() -> None:
    zs = np.array([0.00312, 0.01077, 0.1, 0.23456, 0.5, 1.0, 1.23457, 2.0, 3.5555, 5.0])
    exact = Planck18.comoving_distance(zs).to_value(u.pc)
    rel = np.max(np.abs(comoving_pc(zs) / exact - 1))
    assert rel < 1e-5, rel
    dl = Planck18.luminosity_distance(zs).to_value(u.pc)
    zrel = np.max(np.abs(z_from_lumdist_pc(dl) / zs - 1))
    crel = np.max(np.abs(lumdist_to_comoving_pc(dl) / exact - 1))
    assert zrel < 1e-4 and crel < 1e-5, (zrel, crel)
    # Galactic Centre direction -> +x ; NGP -> +z
    gc = SkyCoord(l=0 * u.deg, b=0 * u.deg, frame="galactic").icrs
    v = galactic_xyz(gc.ra.deg, gc.dec.deg, 8000.0)
    assert abs(v[0] - 8000) < 1e-3 and abs(v[1]) < 1e-3 and abs(v[2]) < 1e-3, v
    l90 = SkyCoord(l=90 * u.deg, b=0 * u.deg, frame="galactic").icrs
    v = galactic_xyz(l90.ra.deg, l90.dec.deg, 1.0)
    assert abs(v[1] - 1) < 1e-9, v
    ngp = SkyCoord(l=0 * u.deg, b=90 * u.deg, frame="galactic").icrs
    v = galactic_xyz(ngp.ra.deg, ngp.dec.deg, 1.0)
    assert abs(v[2] - 1) < 1e-9, v
    print(f"coords self-test OK (comoving interp max rel err {rel:.2e}); "
          f"D_C(z=0.1)={comoving_pc(0.1)/1e6:.2f} Mpc, D_C(z=1)={comoving_pc(1.0)/1e6:.1f} Mpc")


if __name__ == "__main__":
    self_test()
