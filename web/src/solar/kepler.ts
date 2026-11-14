/**
 * Two-body (Kepler) orbits from osculating elements: the CPU twin of the GPU propagation in
 * smallbodies.ts / satellites.ts. Same parameterisation as the tiles (scripts/build_small_bodies.py):
 *
 *   el = [q, e, i, node, peri, tp]   perihelion distance, eccentricity, inclination, longitude of
 *                                    the ascending node, argument of perihelion (rad), and the time
 *                                    of perihelion passage tp relative to the reference epoch
 *
 * Perihelion distance + time cover ellipses, parabolas and hyperbolas with one record, so comets
 * and interstellar objects (1I, 2I, 3I) go through the same code. Units are the caller's: AU and
 * days with mu = k² for the Sun, km and seconds with GM⊕ for Earth satellites.
 *
 * Kepler's equation is solved with Newton's method from Danby's starter E0 = M + 0.85 e sign(sin M)
 * (elliptic) and F0 = sign(M) ln(2|M|/e + 1.8) (hyperbolic); parabolas use Barker's equation in
 * closed form. `f32` runs every step through Math.fround with the shader's iteration count, which
 * estimates what float32 on the GPU does to the result (the GPU's sin/cos differ in the last bits).
 */

import { ICRS_TO_GAL, type Vec3 } from '../math/frames';

export const K_GAUSS = 0.01720209895;
/** mu of the Sun in AU³/day² (Gaussian constant, massless body) */
export const MU_SUN = K_GAUSS * K_GAUSS;
/** GM of the Earth, km³/s² (WGS-84); only used for the short two-body steps between SGP4 states */
export const MU_EARTH = 398600.4418;
/** obliquity of the ecliptic at J2000.0, IAU 1976 (the value MPC and JPL use for the J2000 ecliptic) */
export const OBLIQUITY_J2000 = (84381.448 / 3600) * (Math.PI / 180);
/** Newton iterations in the shader (elliptic / hyperbolic) */
export const SHADER_ITERS = { asteroid: 6, comet: 12 } as const;

const ce = Math.cos(OBLIQUITY_J2000);
const se = Math.sin(OBLIQUITY_J2000);
/** J2000 ecliptic -> ICRS (equatorial): rotation about x by +epsilon; row-major */
export const ECL_TO_ICRS: readonly number[] = [1, 0, 0, 0, ce, -se, 0, se, ce];

function mul3(a: readonly number[], b: readonly number[]): number[] {
  const o = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return o;
}

/** J2000 ecliptic -> contract Galactic frame, row-major */
export const ECL_TO_GAL: readonly number[] = mul3(ICRS_TO_GAL, ECL_TO_ICRS);

type R = (x: number) => number;
const id: R = (x) => x;

/**
 * Position in the elements' reference plane (ecliptic for MPC elements, TEME for satellites) at
 * `dt` (same unit as tp) after the reference epoch. Writes into `out` and returns it.
 */
export function conicPosition(el: ArrayLike<number>, dt: number, mu: number, out: Vec3 = [0, 0, 0], f32 = false, iters?: number): Vec3 {
  const f: R = f32 ? Math.fround : id;
  const q = f(el[0]);
  const e = f(el[1]);
  const inc = f(el[2]);
  const node = f(el[3]);
  const peri = f(el[4]);
  const tp = f(el[5]);
  const t = f(f(dt) - tp);
  let x: number;
  let y: number;
  if (e < 1) {
    const a = f(q / f(1 - e));
    const n = f(Math.sqrt(f(mu / f(a * f(a * a)))));
    let M = f(n * t);
    M = f(M - f(2 * Math.PI * Math.floor(M / (2 * Math.PI) + 0.5)));
    let E = f(M + f(0.85 * e * Math.sign(Math.sin(M) || 1)));
    const nIt = iters ?? (f32 ? (e > 0.6 ? SHADER_ITERS.comet : SHADER_ITERS.asteroid) : 50);
    for (let k = 0; k < nIt; k++) {
      const s = f(Math.sin(E));
      const c = f(Math.cos(E));
      const dE = f(f(E - f(e * s) - M) / f(1 - f(e * c)));
      E = f(E - dE);
      if (!f32 && Math.abs(dE) < 1e-15) break;
    }
    x = f(a * f(Math.cos(E) - e));
    y = f(a * f(f(Math.sqrt(f(f(1 - e) * f(1 + e)))) * f(Math.sin(E))));
  } else if (e - 1 < 1e-9) {
    // parabola: Barker, s = tan(nu/2): s + s³/3 = sqrt(mu / (2 q³)) t
    const B = f(f(Math.sqrt(f(mu / f(2 * f(q * f(q * q)))))) * t);
    const w = f(1.5 * B);
    const Y = f(Math.cbrt(f(w + f(Math.sqrt(f(1 + f(w * w)))))));
    const s = f(Y - f(1 / Y));
    x = f(q * f(1 - f(s * s)));
    y = f(2 * f(q * s));
  } else {
    const a = f(q / f(e - 1));
    const n = f(Math.sqrt(f(mu / f(a * f(a * a)))));
    const M = f(n * t);
    let F = f(Math.sign(M) * Math.log(f(2 * Math.abs(M) / e + 1.8)));
    const nIt = iters ?? (f32 ? SHADER_ITERS.comet : 60);
    for (let k = 0; k < nIt; k++) {
      const sh = f(Math.sinh(F));
      const ch = f(Math.cosh(F));
      const dF = f(f(f(e * sh) - F - M) / f(f(e * ch) - 1));
      F = f(F - dF);
      if (!f32 && Math.abs(dF) < 1e-15 * Math.max(1, Math.abs(F))) break;
    }
    x = f(a * f(e - f(Math.cosh(F))));
    y = f(a * f(f(Math.sqrt(f(f(e - 1) * f(e + 1)))) * f(Math.sinh(F))));
  }
  const cO = f(Math.cos(node));
  const sO = f(Math.sin(node));
  const cw = f(Math.cos(peri));
  const sw = f(Math.sin(peri));
  const ci = f(Math.cos(inc));
  const si = f(Math.sin(inc));
  const Px = f(cw * cO - f(sw * sO * ci));
  const Py = f(cw * sO + f(sw * cO * ci));
  const Pz = f(sw * si);
  const Qx = f(-sw * cO - f(cw * sO * ci));
  const Qy = f(-sw * sO + f(cw * cO * ci));
  const Qz = f(cw * si);
  out[0] = f(x * Px + y * Qx);
  out[1] = f(x * Py + y * Qy);
  out[2] = f(x * Pz + y * Qz);
  return out;
}

/**
 * The whole orbit as a polyline in the elements' frame (n + 1 points, xyz interleaved): ellipses
 * sampled uniformly in eccentric anomaly (closed), parabolas / hyperbolas out to `rmax`.
 */
export function orbitPolyline(el: ArrayLike<number>, n: number, rmax: number): Float64Array {
  const [q, e, inc, node, peri] = [el[0], el[1], el[2], el[3], el[4]];
  const out = new Float64Array((n + 1) * 3);
  const cO = Math.cos(node), sO = Math.sin(node), cw = Math.cos(peri), sw = Math.sin(peri), ci = Math.cos(inc), si = Math.sin(inc);
  const P = [cw * cO - sw * sO * ci, cw * sO + sw * cO * ci, sw * si];
  const Q = [-sw * cO - cw * sO * ci, -sw * sO + cw * cO * ci, cw * si];
  for (let k = 0; k <= n; k++) {
    const f = k / n;
    let x: number, y: number;
    if (e < 1) {
      const a = q / (1 - e);
      const E = f * 2 * Math.PI;
      x = a * (Math.cos(E) - e);
      y = a * Math.sqrt(1 - e * e) * Math.sin(E);
    } else if (e - 1 < 1e-9) {
      const smax = Math.sqrt(Math.max(rmax / q - 1, 1e-6));
      const s = (2 * f - 1) * smax;
      x = q * (1 - s * s);
      y = 2 * q * s;
    } else {
      const a = q / (e - 1);
      const Fmax = Math.acosh(Math.max(1, (rmax / a + 1) / e));
      const F = (2 * f - 1) * Fmax;
      x = a * (e - Math.cosh(F));
      y = a * Math.sqrt(e * e - 1) * Math.sinh(F);
    }
    for (let c = 0; c < 3; c++) out[k * 3 + c] = x * P[c] + y * Q[c];
  }
  return out;
}

/** heliocentric ecliptic AU -> contract Galactic, in the caller's length unit (pcPerAu = 1 keeps AU) */
export function eclToGal(v: Vec3, scale = 1, out: Vec3 = [0, 0, 0]): Vec3 {
  const m = ECL_TO_GAL;
  const x = v[0];
  const y = v[1];
  const z = v[2];
  out[0] = (m[0] * x + m[1] * y + m[2] * z) * scale;
  out[1] = (m[3] * x + m[4] * y + m[5] * z) * scale;
  out[2] = (m[6] * x + m[7] * y + m[8] * z) * scale;
  return out;
}

/** semi-major axis (AU; negative for hyperbolas, Infinity for parabolas) */
export function semiMajor(q: number, e: number): number {
  return Math.abs(1 - e) < 1e-9 ? Infinity : q / (1 - e);
}

/** orbital period in days for e < 1 (mu in AU³/day²), else Infinity */
export function periodDays(q: number, e: number, mu = MU_SUN): number {
  if (e >= 1) return Infinity;
  const a = q / (1 - e);
  return 2 * Math.PI * Math.sqrt((a * a * a) / mu);
}

/**
 * Osculating elements [q, e, i, node, peri, tp] from a state vector (r, v) in any inertial frame,
 * tp relative to the time of the state (same time unit as mu). Used to hand SGP4 states to the GPU.
 */
export function elementsFromState(r: Vec3, v: Vec3, mu: number, out: number[] = new Array(6)): number[] {
  const [x, y, z] = r;
  const [vx, vy, vz] = v;
  const rr = Math.hypot(x, y, z);
  const hx = y * vz - z * vy;
  const hy = z * vx - x * vz;
  const hz = x * vy - y * vx;
  const h = Math.hypot(hx, hy, hz);
  const rv = x * vx + y * vy + z * vz;
  const v2 = vx * vx + vy * vy + vz * vz;
  // eccentricity vector
  const k = v2 - mu / rr;
  const ex = (k * x - rv * vx) / mu;
  const ey = (k * y - rv * vy) / mu;
  const ez = (k * z - rv * vz) / mu;
  const e = Math.hypot(ex, ey, ez);
  const inc = Math.acos(Math.max(-1, Math.min(1, hz / h)));
  const nx = -hy;
  const ny = hx;
  const nn = Math.hypot(nx, ny);
  const node = nn > 1e-12 * h ? Math.atan2(ny, nx) : 0;
  // argument of perihelion and true anomaly measured from the node (or the x axis if equatorial)
  const ux = nn > 1e-12 * h ? nx / nn : 1;
  const uy = nn > 1e-12 * h ? ny / nn : 0;
  // w = h_hat × u (in-plane, 90° ahead of the node)
  const wx = (hy * 0 - hz * uy) / h;
  const wy = (hz * ux - hx * 0) / h;
  const wz = (hx * uy - hy * ux) / h;
  const angle = (ax: number, ay: number, az: number) => Math.atan2(ax * wx + ay * wy + az * wz, ax * ux + ay * uy);
  let peri: number;
  let nu: number;
  if (e > 1e-10) {
    peri = angle(ex, ey, ez);
    nu = angle(x, y, z) - peri;
  } else {
    peri = 0;
    nu = angle(x, y, z);
  }
  const q = (h * h) / mu / (1 + e);
  let tp: number;
  if (e < 1) {
    const a = q / (1 - e);
    const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
    const M = E - e * Math.sin(E);
    tp = -M / Math.sqrt(mu / (a * a * a));
  } else {
    const a = q / (e - 1);
    const F = 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(nu / 2));
    const M = e * Math.sinh(F) - F;
    tp = -M / Math.sqrt(mu / (a * a * a));
  }
  out[0] = q;
  out[1] = e;
  out[2] = inc;
  out[3] = node;
  out[4] = peri;
  out[5] = tp;
  return out;
}

/** JD (TT) of a UTC time in ms; TT - UTC = 69.184 s (37 leap seconds, valid since 2017) */
export function jdTTFromMs(ms: number): number {
  return ms / 86400000 + 2440587.5 + 69.184 / 86400;
}
