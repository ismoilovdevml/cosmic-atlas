/**
 * Flat LCDM with astropy `Planck18` parameters (Planck 2018 VI, TT,TE,EE+lowE+lensing+BAO).
 * H0 = 67.66, Om0 = 0.30966, Tcmb = 2.7255 K, Neff = 3.046, m_nu = [0, 0, 0.06] eV.
 *
 * Simplifications vs astropy: the massive neutrino is treated as pure matter and the two
 * massless species as pure radiation. Against astropy (numpy-integrated inv_efunc) this agrees
 * to < 1e-4 relative for z <= 3 (see test/cosmology.test.ts).
 */

const C_KMS = 299792.458;
export const H0 = 67.66;
const OGAMMA0 = 5.402015137139353e-5;
const ONU_TOTAL0 = 0.0014396743040845244; // astropy Planck18.Onu0
const ONU_MASSLESS0 = OGAMMA0 * 0.22710731766 * (3.046 / 3) * 2; // two massless species
const OM0 = 0.30966 + (ONU_TOTAL0 - ONU_MASSLESS0);
const OR0 = OGAMMA0 + ONU_MASSLESS0;
const ODE0 = 0.6888463055445441;

/** Hubble distance c/H0 in pc. */
export const DH_PC = (C_KMS / H0) * 1e6;
/** Hubble time 1/H0 in Gyr (977.792 Gyr km/s/Mpc). */
export const TH_GYR = 977.7922216807891 / H0;

export function efunc(z: number): number {
  const a = 1 + z;
  return Math.sqrt(OM0 * a * a * a + OR0 * a * a * a * a + ODE0);
}

function simpson(f: (z: number) => number, z: number, n = 512): number {
  if (z <= 0) return 0;
  const h = z / n;
  let s = f(0) + f(z);
  for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * f(i * h);
  return (s * h) / 3;
}

/** Line-of-sight comoving distance in pc. */
export function comovingDistancePc(z: number): number {
  return DH_PC * simpson((x) => 1 / efunc(x), z);
}

/** Lookback time in Gyr. */
export function lookbackTimeGyr(z: number): number {
  return TH_GYR * simpson((x) => 1 / ((1 + x) * efunc(x)), z);
}

/** Inverse of comovingDistancePc by bisection (monotonic). */
export function redshiftFromComoving(dPc: number): number {
  if (dPc <= 0) return 0;
  let lo = 0;
  let hi = 20;
  if (comovingDistancePc(hi) < dPc) return hi;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (comovingDistancePc(mid) < dPc) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
