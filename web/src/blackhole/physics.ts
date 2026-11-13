/**
 * Schwarzschild black hole: the numbers the HUD and the shaders use.
 *
 * Units: SI unless a name says otherwise; "x" is a Schwarzschild radial coordinate in units of
 * r_s = 2GM/c^2 (so the horizon is x = 1, the photon sphere x = 1.5, the ISCO x = 3).
 * All observer quantities are for a STATIC (hovering) observer, the one the camera represents.
 * Spin (Kerr) is not modelled.
 */

export const C = 299_792_458; // m/s
/** IAU 2015 Resolution B3 nominal solar mass parameter, m^3 s^-2 */
export const GM_SUN = 1.3271244e20;
export const KM_PER_PC = 3.0856775814913673e13;
export const M_PER_PC = KM_PER_PC * 1e3;
export const G0 = 9.80665; // m/s^2, standard gravity
/** critical impact parameter b_c = (3 sqrt 3 / 2) r_s (Darwin 1959) */
export const B_CRIT = (3 * Math.sqrt(3)) / 2;
/** photon sphere and ISCO, in r_s */
export const X_PHOTON = 1.5;
export const X_ISCO = 3;

/** r_s = 2GM/c^2 in metres */
export function schwarzschildRadiusM(massMsun: number): number {
  return (2 * GM_SUN * massMsun) / (C * C);
}

/** dtau/dt for a static observer at x = r/r_s (gravitational time dilation, sqrt(1 - r_s/r)) */
export function timeDilation(x: number): number {
  return x > 1 ? Math.sqrt(1 - 1 / x) : 0;
}

/** escape speed measured locally by a static observer, as a fraction of c: sqrt(r_s/r) */
export function escapeFraction(x: number): number {
  return Math.min(1, Math.sqrt(1 / x));
}

/**
 * Radial tidal acceleration difference across a body of length L (m): 2GM L / r^3 = c^2 r_s L / r^3.
 * For a static (or radially moving) observer in Schwarzschild this Newtonian-looking expression is
 * exact: it is the R^r_trt Riemann component in the observer's frame (Misner, Thorne & Wheeler 1973, ch. 31).
 */
export function tidalAccel(rsM: number, rM: number, lengthM = 2): number {
  return (C * C * rsM * lengthM) / (rM * rM * rM);
}

/** proper acceleration needed to hover at r: GM / (r^2 sqrt(1 - r_s/r)); infinite at the horizon */
export function hoverAccel(rsM: number, rM: number): number {
  const f = 1 - rsM / rM;
  return f > 0 ? (C * C * rsM) / (2 * rM * rM * Math.sqrt(f)) : Infinity;
}

/**
 * Angular radius of the shadow seen by a static observer at x (Synge 1966, MNRAS 131, 463):
 * sin(alpha) = (sqrt 27 / 2) (r_s / r) sqrt(1 - r_s / r), alpha measured from the direction to the hole.
 * Inside the photon sphere (x < 1.5) the shadow covers more than a hemisphere: alpha = pi - asin(...).
 */
export function shadowAngularRadius(x: number): number {
  const s = Math.min(1, ((Math.sqrt(27) / 2) / x) * Math.sqrt(Math.max(0, 1 - 1 / x)));
  const a = Math.asin(s);
  return x >= X_PHOTON ? a : Math.PI - a;
}

/**
 * Impact parameter b (in r_s) of a ray seen by a static observer at x, at angle psi from the
 * outward radial direction: b = x sin(psi) / sqrt(1 - 1/x). The (1 - 1/x)^-1/2 is the static
 * observer's aberration relative to Schwarzschild coordinates.
 */
export function impactParameter(x: number, psi: number): number {
  return (x * Math.sin(psi)) / Math.sqrt(1 - 1 / x);
}

/**
 * Novikov–Thorne thin-disk flux for a = 0 (Page & Thorne 1974, ApJ 191, 499, with a = 0; the form
 * Luminet 1979, A&A 75, 228 uses for his disk image):
 *   F(r*) ∝ [ sqrt(r*) - sqrt(6) + (sqrt 3 / 2) ln( (sqrt r* + sqrt 3)(sqrt 6 - sqrt 3) / ((sqrt r* - sqrt 3)(sqrt 6 + sqrt 3)) ) ]
 *           / ( (r* - 3) r*^{5/2} ),     r* = r / M = 2 x.
 * Zero at the ISCO (zero-torque inner edge), -> r*^-3 far out (the Newtonian 3GMṀ/8πr^3 shape).
 * Returned unnormalised; divide by NT_PEAK.F for a 0..1 profile.
 */
export function ntFlux(x: number): number {
  const rs = 2 * x;
  if (rs <= 6) return 0;
  const s = Math.sqrt(rs);
  const s3 = Math.sqrt(3);
  const s6 = Math.sqrt(6);
  const lg = Math.log(((s + s3) * (s6 - s3)) / ((s - s3) * (s6 + s3)));
  return (s - s6 + (s3 / 2) * lg) / ((rs - 3) * Math.pow(rs, 2.5));
}

/** location (x, in r_s) and value of the Novikov–Thorne flux maximum (golden-section search) */
export const NT_PEAK = (() => {
  let a = 3.01;
  let b = 20;
  const g = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 200; i++) {
    const c = b - g * (b - a);
    const d = a + g * (b - a);
    if (ntFlux(c) > ntFlux(d)) b = d;
    else a = c;
  }
  const x = (a + b) / 2;
  return { x, F: ntFlux(x) };
})();

/** disk effective temperature profile T(x) / T_peak = (F / F_max)^(1/4) */
export function ntTemperature(x: number, tPeak: number): number {
  return tPeak * Math.pow(Math.max(0, ntFlux(x) / NT_PEAK.F), 0.25);
}

/**
 * Redshift factor g = nu_obs / nu_emit for light from a thin-disk gas element on a circular
 * Keplerian (prograde) orbit at x, received by a static observer at xObs:
 *   g = sqrt(1 - 3M/r) / ( sqrt(1 - r_s/r_obs) (1 - Omega b_z) ),   Omega = sqrt(M / r^3)
 * (Luminet 1979, §4, with the observer at finite radius; James et al. 2015, CQG 32, 065001, appendix A).
 * b_z = L_z / E is the photon's angular momentum about the disk axis per unit energy (in r_s),
 * positive when the photon moves with the disk's rotation (the approaching side, g > 1 possible).
 * In r_s units M = 1/2, so Omega = sqrt(0.5 / x^3) and 3M/r = 1.5 / x.
 */
export function diskRedshift(x: number, bz: number, xObs: number): number {
  const omega = Math.sqrt(0.5 / (x * x * x));
  return Math.sqrt(1 - 1.5 / x) / (Math.sqrt(1 - 1 / xObs) * (1 - omega * bz));
}

/**
 * Einstein radius for sources at infinity, camera at distance D (m) from the lens: sqrt(2 r_s / D).
 * Weak-field estimate used to decide when the lens pass is worth running.
 */
export function einsteinAngle(rsM: number, dM: number): number {
  return Math.sqrt((2 * rsM) / dM);
}
