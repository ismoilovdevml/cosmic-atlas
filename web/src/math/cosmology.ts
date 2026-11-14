/**
 * Flat LCDM with astropy `Planck18` parameters (Planck 2018 VI, TT,TE,EE+lowE+lensing+BAO).
 * H0 = 67.66, Om0 = 0.30966, Tcmb = 2.7255 K, Neff = 3.046, m_nu = [0, 0, 0.06] eV.
 *
 * Neutrinos follow astropy exactly: rho_nu = 0.22710731766 (Neff/3) [2 + f(y)] rho_gamma with the
 * Komatsu et al. 2011 (ApJS 192, 18) fit f(y) = (1 + (0.3173 y)^1.83)^(1/1.83), y = m_nu a / T_nu0
 * (y0 = 357.912 for 0.06 eV, astropy's nu_y). So the massive species is radiation-like at the CMB
 * (z = 1090) and matter-like today. Om0 excludes neutrinos, as in astropy.
 *
 * Integrals run in x = ln(1 + z) (Simpson), which stays accurate out to the last scattering
 * surface: against astropy, < 1e-5 relative for z <= 3 and at z = 1090 (test/cosmology.test.ts).
 */

const C_KMS = 299792.458;
export const H0 = 67.66;
const OM0 = 0.30966;
const OGAMMA0 = 5.402015137139353e-5;
const ODE0 = 0.6888463055445441;
const NU_PREFAC = 0.22710731766 * (3.046 / 3);
const NU_Y0 = 357.9121209673803;
const KOMATSU_K = 0.3173;
const KOMATSU_P = 1.83;

/** Hubble distance c/H0 in pc. */
export const DH_PC = (C_KMS / H0) * 1e6;
/** Hubble time 1/H0 in Gyr (977.792 Gyr km/s/Mpc). */
export const TH_GYR = 977.7922216807891 / H0;

/** neutrino energy density relative to photons at redshift z (astropy nu_relative_density) */
function nuRelative(z: number): number {
  const y = NU_Y0 / (1 + z);
  return NU_PREFAC * (2 + Math.pow(1 + Math.pow(KOMATSU_K * y, KOMATSU_P), 1 / KOMATSU_P));
}

export function efunc(z: number): number {
  const a = 1 + z;
  return Math.sqrt(OM0 * a * a * a + OGAMMA0 * (1 + nuRelative(z)) * a * a * a * a + ODE0);
}

/** Simpson's rule of f(x) on [0, X] */
function simpson(f: (x: number) => number, X: number, n: number): number {
  if (X <= 0) return 0;
  const h = X / n;
  let s = f(0) + f(X);
  for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * f(i * h);
  return (s * h) / 3;
}

const steps = (z: number) => (z > 10 ? 4096 : 512);

/** Line-of-sight comoving distance in pc: DH ∫ dz / E = DH ∫ (1+z) / E dx, x = ln(1+z). */
export function comovingDistancePc(z: number): number {
  return DH_PC * simpson((x) => Math.exp(x) / efunc(Math.expm1(x)), Math.log1p(Math.max(z, 0)), steps(z));
}

/** Lookback time in Gyr: tH ∫ dz / ((1+z) E) = tH ∫ dx / E. */
export function lookbackTimeGyr(z: number): number {
  return TH_GYR * simpson((x) => 1 / efunc(Math.expm1(x)), Math.log1p(Math.max(z, 0)), steps(z));
}

/**
 * Redshift of the last scattering surface drawn as the CMB shell: Planck 2018 VI (Table 2,
 * TT,TE,EE+lowE+lensing) gives z* = 1089.92 ± 0.25; the atlas uses the rounded 1090.
 */
export const Z_CMB = 1090;

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
