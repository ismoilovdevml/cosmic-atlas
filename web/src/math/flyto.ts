/**
 * Smooth zoom-and-pan path of van Wijk & Nuij (2003, "Smooth and efficient zooming and
 * panning", IEEE InfoVis), with the camera-to-focus distance playing the role of the view
 * width w. The path interpolates log(w): a pure zoom is exactly linear in log-distance, and a
 * long pan first rises to a distance where start and end are both in view, then descends.
 * This is what makes Earth -> M31 -> z=0.5 read as one continuous motion over 15 decades.
 *
 * All closed forms are written in log space so nothing overflows across ~20 decades.
 */

export interface ZoomPath {
  /** Path length in the paper's units; animation duration should scale with it. */
  S: number;
  /** For t in [0,1]: pan fraction (0..1 of the start->end separation) and distance. */
  at(t: number): { pan: number; dist: number };
}

const LN2 = Math.LN2;

function logcosh(x: number): number {
  const a = Math.abs(x);
  return a + Math.log1p(Math.exp(-2 * a)) - LN2;
}

function logsinh(x: number): number {
  // x > 0
  if (x < 1e-3) return Math.log(x * (1 + (x * x) / 6));
  return x + Math.log1p(-Math.exp(-2 * x)) - LN2;
}

/**
 * @param w0 start distance (pc, > 0)
 * @param w1 end distance (pc, > 0)
 * @param u1 separation between start and end focus points (pc, >= 0)
 * @param rho trade-off between zooming and panning (paper's optimum ~1.4)
 */
export function makeZoomPath(w0: number, w1: number, u1: number, rho = 1.4): ZoomPath {
  const lw0 = Math.log(w0);
  const lw1 = Math.log(w1);
  const rho2 = rho * rho;
  // pan negligible relative to the views: pure log-linear zoom
  if (u1 < 1e-9 * Math.max(w0, w1)) {
    const S = Math.abs(lw1 - lw0) / rho;
    return {
      S,
      at(t) {
        return { pan: t, dist: Math.exp(lw0 + (lw1 - lw0) * t) };
      },
    };
  }
  const b0 = (w1 * w1 - w0 * w0 + rho2 * rho2 * u1 * u1) / (2 * w0 * rho2 * u1);
  const b1 = (w1 * w1 - w0 * w0 - rho2 * rho2 * u1 * u1) / (2 * w1 * rho2 * u1);
  const r0 = -Math.asinh(b0); // = ln(-b0 + sqrt(b0^2+1)), stable form
  const r1 = -Math.asinh(b1);
  const S = (r1 - r0) / rho;
  const lc0 = logcosh(r0);
  return {
    S,
    at(t) {
      if (t <= 0) return { pan: 0, dist: w0 };
      if (t >= 1) return { pan: 1, dist: w1 };
      const s = t * S;
      const x = rho * s;
      const lw = lw0 + lc0 - logcosh(x + r0);
      // u(s) = (w0/rho^2) sinh(rho s) / cosh(rho s + r0)   (tanh-difference identity)
      const u = Math.exp(lw0 - Math.log(rho2) + logsinh(x) - logcosh(x + r0));
      return { pan: Math.min(1, u / u1), dist: Math.exp(lw) };
    },
  };
}

/** Animation duration (s) for a path; reduced-motion users get a short cut. */
export function pathDuration(S: number, reducedMotion = false): number {
  if (reducedMotion) return 0.35;
  return Math.min(9, Math.max(1.2, 0.55 * S));
}

/** Ease in-out (cubic) for the time parameter. */
export function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
