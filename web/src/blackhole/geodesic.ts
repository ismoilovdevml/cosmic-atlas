/**
 * Null geodesics in the Schwarzschild metric: the CPU twin of the lens shader (lens.ts).
 *
 * A light ray stays in one plane through the hole. In that plane, with u = 1/r and r in units of
 * r_s, the orbit equation is (Binet form; e.g. Chandrasekhar 1983, §20; Luminet 1979 eq. 1)
 *
 *     d²u/dφ² = −u + (3/2) u²            (r_s = 1)
 *
 * with first integral (du/dφ)² = 1/b² − u² + u³, b the impact parameter. We trace BACKWARD from the
 * camera, a static observer at r0: a pixel's direction makes an angle ψ with the outward radial
 * direction e1; e2 is the in-plane unit vector perpendicular to e1 toward the ray. Then
 *     u(0) = 1/r0,   u'(0) = −u0 sqrt(1 − u0) cot ψ,   b = r0 sin ψ / sqrt(1 − u0)
 * (the sqrt(1 − u0) is the static observer's aberration). The ray ends:
 *   - ESCAPED when u returns to 0 at φ∞: it arrives from the sky direction cos φ∞ e1 + sin φ∞ e2;
 *   - CAPTURED when it crosses the horizon u = 1, or moves inward inside the photon sphere
 *     (u > 2/3 with u' > 0: such rays always fall in), or is still orbiting after maxSteps;
 *   - DISK when it crosses the disk plane (n·x = 0) at r_in ≤ r ≤ r_out (optically thick).
 *
 * Integration: classical RK4 in φ with a fixed step h. Two analytic shortcuts keep it cheap and
 * accurate where the field is weak:
 *   - EXIT TAIL: once the ray moves outward (u' < 0) beyond r = 1/U_EXIT and u < EXIT_Q / b, the
 *     remaining sweep to u = 0 is ∫ du / sqrt(w² − u² + u³), w = 1/b, expanded in ε = u³/(w² − u²):
 *       Θ − (w/2)(1 − cos Θ)²/cos Θ + (3/8) w² [ −2 tan Θ + tan³Θ/3 + 5Θ/2 − sin 2Θ / 4 ],
 *     Θ = asin(u/w): the flat-space angle plus the first- and second-order terms (substitute
 *     u = w sin Θ; the integrands become sin³Θ/cos²Θ and sin⁶Θ/cos⁴Θ). Error O(ε³) Θ.
 *   - FAR RAY: camera beyond 1/U_FAR and periapsis beyond ≈ 1/W_FAR: the first-order orbit
 *     u = w sin φ + (w²/2)(1 + cos² φ), w = 1/b (e.g. Weinberg 1972, §8.5) gives φ∞ = π + w − φc
 *     where φc solves u(φc) = u0 on the incoming branch. Error O(w²) ≈ 1e-4 rad at the threshold.
 * The two crossings (u = 0 and n·x = 0) inside a step are located on the cubic Hermite
 * interpolant of (u, u') at the step ends, which is O(h⁴) accurate like the step itself.
 */

export const U_EXIT = 0.1; // r > 10 r_s; tail error <= 1.4e-5 rad over r0 = 1.6..150 r_s (test/blackhole.test.ts)
/** ... and well past periapsis (u < EXIT_Q / b), where the first-order tail is accurate */
export const EXIT_Q = 0.7;
export const U_FAR = 0.005; // camera beyond 200 r_s
export const W_FAR = 0.005; // b > 200 r_s

export type RayStatus = 'escaped' | 'captured' | 'disk';

export interface TraceOptions {
  /** RK4 steps per 2π of φ */
  stepsPerTurn?: number;
  /** maximum number of steps (rays still orbiting are counted as captured) */
  maxSteps?: number;
  /** disable the far-ray shortcut (tests) */
  noFarShortcut?: boolean;
  /** exit-tail threshold override (tests; default U_EXIT) */
  uExit?: number;
  /** disk plane: A = n·e1, B = n·e2, radii in r_s */
  disk?: { A: number; B: number; rIn: number; rOut: number } | null;
}

export interface TraceResult {
  status: RayStatus;
  /** escaped: final azimuth in the orbit plane (sky direction cos φ∞ e1 + sin φ∞ e2) */
  phiInf: number;
  /** disk: radius of the hit (r_s) and its azimuth */
  rHit: number;
  phiHit: number;
  steps: number;
}

/** remaining sweep of an outgoing ray at u to infinity, to second order in u³/(w² − u²) (see header) */
export function exitTail(u: number, w: number): number {
  const q = Math.min(u / w, 1);
  const c = Math.sqrt(Math.max(1 - q * q, 1e-6));
  const th = Math.asin(q);
  const t = q / c;
  const i2 = -2 * t + (t * t * t) / 3 + 2.5 * th - Math.sin(2 * th) / 4;
  return th - (0.5 * w * ((1 - c) * (1 - c))) / c + 0.375 * w * w * i2;
}

/** φ∞ of an incoming far ray (camera at u0, w = 1/b), first-order orbit (see header) */
export function farRayPhi(u0: number, w: number): number {
  const s0 = u0 / w;
  const s1 = (u0 - 0.5 * w * w * (2 - s0 * s0)) / w;
  return Math.PI + w - Math.asin(Math.max(-1, Math.min(1, s1)));
}

const acc = (u: number) => -u + 1.5 * u * u;

/** one RK4 step of (u, v = du/dφ) */
export function rk4(u: number, v: number, h: number): [number, number] {
  const k1u = v;
  const k1v = acc(u);
  const k2u = v + 0.5 * h * k1v;
  const k2v = acc(u + 0.5 * h * k1u);
  const k3u = v + 0.5 * h * k2v;
  const k3v = acc(u + 0.5 * h * k2u);
  const k4u = v + h * k3v;
  const k4v = acc(u + h * k3u);
  return [u + (h / 6) * (k1u + 2 * k2u + 2 * k3u + k4u), v + (h / 6) * (k1v + 2 * k2v + 2 * k3v + k4v)];
}

/** cubic Hermite interpolant of u on a step of length h, t in [0, 1] (value and d/dt) */
export function hermite(u0: number, v0: number, u1: number, v1: number, h: number, t: number): [number, number] {
  const t2 = t * t;
  const t3 = t2 * t;
  const val = (2 * t3 - 3 * t2 + 1) * u0 + (t3 - 2 * t2 + t) * h * v0 + (-2 * t3 + 3 * t2) * u1 + (t3 - t2) * h * v1;
  const der = (6 * t2 - 6 * t) * u0 + (3 * t2 - 4 * t + 1) * h * v0 + (-6 * t2 + 6 * t) * u1 + (3 * t2 - 2 * t) * h * v1;
  return [val, der];
}

/** root of the Hermite interpolant in [0, 1] (u0 > 0 >= u1): linear guess + 3 Newton steps */
export function hermiteRoot(u0: number, v0: number, u1: number, v1: number, h: number): number {
  let t = u0 / (u0 - u1);
  for (let i = 0; i < 3; i++) {
    const [f, df] = hermite(u0, v0, u1, v1, h, t);
    if (Math.abs(df) < 1e-12) break;
    t = Math.max(0, Math.min(1, t - f / df));
  }
  return t;
}

/**
 * Trace one ray from a static camera at r0 (r_s) whose direction makes angle ψ with the outward
 * radial direction (given as cos ψ, sin ψ >= 0).
 */
export function traceRay(r0: number, cosPsi: number, sinPsi: number, opts: TraceOptions = {}): TraceResult {
  const stepsPerTurn = opts.stepsPerTurn ?? 96;
  const h = (2 * Math.PI) / stepsPerTurn;
  const maxSteps = opts.maxSteps ?? Math.round(2.5 * stepsPerTurn);
  // an outgoing ray past r_out never returns to the disk, so the tail may start only beyond it
  const uExit = Math.min(opts.uExit ?? U_EXIT, opts.disk ? 1 / opts.disk.rOut : Infinity);
  const u0 = 1 / r0;
  const sf = Math.sqrt(1 - u0);
  const sp = Math.max(sinPsi, 1e-9);
  const w = sf / (r0 * sp); // 1/b
  let u = u0;
  let v = (-u0 * sf * cosPsi) / sp;
  const res: TraceResult = { status: 'captured', phiInf: 0, rHit: 0, phiHit: 0, steps: 0 };

  if (!opts.noFarShortcut && u0 < U_FAR && w < W_FAR) {
    res.status = 'escaped';
    res.phiInf = v <= 0 ? exitTail(u0, w) : farRayPhi(u0, w);
    return res;
  }
  const d = opts.disk;
  const ch = Math.cos(h);
  const sh = Math.sin(h);
  let cs = 1; // cos φ
  let sn = 0; // sin φ
  let phi = 0;
  for (let i = 0; i < maxSteps; i++) {
    res.steps = i + 1;
    if (v < 0 && u < uExit && u < EXIT_Q * w) {
      res.status = 'escaped';
      res.phiInf = phi + exitTail(u, w);
      return res;
    }
    if (u > 1 || (u > 2 / 3 && v > 0)) {
      res.status = 'captured';
      return res;
    }
    const [u1, v1] = rk4(u, v, h);
    const cs1 = cs * ch - sn * sh;
    const sn1 = sn * ch + cs * sh;
    if (d) {
      const s0 = d.A * cs + d.B * sn;
      const s1 = d.A * cs1 + d.B * sn1;
      if (s0 !== 0 && s0 * s1 <= 0) {
        // zero of A cos φ + B sin φ inside (φ, φ + h]: φz = atan2(B, A) + π/2 + kπ
        const base = Math.atan2(d.B, d.A) + Math.PI / 2;
        const phiZ = base + Math.PI * Math.ceil((phi - base) / Math.PI);
        const t = Math.max(0, Math.min(1, (phiZ - phi) / h));
        const [uc] = hermite(u, v, u1, v1, h, t);
        if (uc > 0) {
          const rc = 1 / uc;
          if (rc >= d.rIn && rc <= d.rOut) {
            res.status = 'disk';
            res.rHit = rc;
            res.phiHit = phiZ;
            return res;
          }
        }
      }
    }
    if (u1 <= 0) {
      res.status = 'escaped';
      res.phiInf = phi + h * hermiteRoot(u, v, u1, v1, h);
      return res;
    }
    phi += h;
    u = u1;
    v = v1;
    cs = cs1;
    sn = sn1;
  }
  res.status = 'captured';
  return res;
}

/**
 * Total deflection of a ray coming from infinity with impact parameter b (r_s), i.e. φ∞ − π for a
 * ray that starts at u = 0 moving inward (u' = 1/b). NaN when captured. For tests.
 */
export function deflectionFromInfinity(b: number, opts: TraceOptions = {}): number {
  const stepsPerTurn = opts.stepsPerTurn ?? 96;
  const h = (2 * Math.PI) / stepsPerTurn;
  const maxSteps = opts.maxSteps ?? Math.round(2.5 * stepsPerTurn);
  const w = 1 / b;
  let u = 0;
  let v = w;
  let phi = 0;
  for (let i = 0; i < maxSteps; i++) {
    if (v < 0 && u < U_EXIT && u < EXIT_Q * w) return phi + exitTail(u, w) - Math.PI;
    if (u > 1 || (u > 2 / 3 && v > 0)) return NaN;
    const [u1, v1] = rk4(u, v, h);
    if (u1 <= 0 && i > 0) return phi + h * hermiteRoot(u, v, u1, v1, h) - Math.PI;
    phi += h;
    u = u1;
    v = v1;
  }
  return NaN;
}

/**
 * Photon angular momentum about the disk axis per unit energy, b_z = L_z / E (r_s), for a pixel
 * ray: the traced direction d is opposite to the photon's motion, so L/E = −b (e1 × e2) and
 * b_z = −b n·(e1 × e2). Positive = photon co-rotating with a prograde disk about +n.
 */
export function photonBz(b: number, nDotE1xE2: number): number {
  return -b * nDotE1xE2;
}
