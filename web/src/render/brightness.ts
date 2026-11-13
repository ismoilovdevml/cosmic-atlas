/**
 * Photometry shared by every point-like thing we draw (stars, galaxies, subtree blobs).
 * CPU twin of the TSL in pointMaterial.ts; keep the two in sync (unit-tested here).
 *
 * The approach follows skymap (github.com/rulkens/skymap, MIT, Copyright (c) 2026 Alexander
 * Rulkens; src/services/gpu/shaders/lib/starPhotometry.wesl and starKnee.wesl), re-implemented
 * here, not copied:
 *
 *   M      absolute (pseudo-)magnitude decoded from the lum byte (contract section 3)
 *   m      = M + 5 log10(r / 10 pc), r = distance from the camera
 *   flux   = 10^(-0.4 (m - mRef)), mRef = auto-exposure + user exposure
 *
 * Light per unit SOLID ANGLE, not per device pixel: the sprite's radius is converted to a
 * reference resolution of REF_PX_PER_RAD (1080 px over a 60° field) before the peak is computed,
 * so the same scene reads equally bright on any canvas size, pixel ratio or field of view.
 * The sprite is a rim-zeroed Gaussian g(u) = (e^{-4u²} - e^{-4}) / (1 - e^{-4}), u = r / radius,
 * whose disc integral is K_GAUSS·radius², so peak = flux / (K_GAUSS · rRef²) deposits exactly
 * `flux` (in reference-pixel units) and has no hard edge. The peak is computed from the radius
 * BEFORE the pixel ceiling, so a very near star freezes its surface brightness instead of
 * blowing out. Each sprite then goes through a hue-preserving knee K(1 - e^{-I/K}) before the
 * colour tint, linear below K, so LOD swaps stay invisible and bright cores whiten by
 * accumulation rather than per-channel clipping.
 */

export const REF_PX_PER_RAD = 1080 / 2 / Math.tan(Math.PI / 6); // 935.3: 1080 px at 60° fov
export const E4 = Math.exp(-4);
/** ∫ over the unit disc of the rim-zeroed Gaussian, 2π[(1-e⁻⁴)/8 - e⁻⁴/2]/(1-e⁻⁴) */
export const K_GAUSS = (2 * Math.PI * ((1 - E4) / 8 - E4 / 2)) / (1 - E4);
export const KNEE = 8;

/** sprite DIAMETER of a flux-1 point, CSS px */
export const BASE_PX = 1.8;
export const STAR_MAX_PX = 16;
export const GAL_MAX_PX = 220;

export type PointKind = 'star' | 'galaxy';

export function absMagFromLum(lum: number, kind: PointKind): number {
  return kind === 'star' ? 20 - lum / 10 : -14 - lum / 20;
}

/** physical radius used for galaxies (10 kpc at M = -21, ∝ L^0.3) */
export function galaxyRadiusPc(M: number): number {
  return 1e4 * Math.pow(10, -0.12 * (M + 21));
}

/** rim-zeroed Gaussian profile, u in [0, 1] (radius-normalised) */
export function profile(u: number): number {
  return u >= 1 ? 0 : (Math.exp(-4 * u * u) - E4) / (1 - E4);
}

export function knee(I: number, K = KNEE): number {
  return K * (1 - Math.exp(-I / K));
}

export interface Appearance {
  /** drawn sprite diameter, device px (after the ceiling) */
  sizePx: number;
  /** diameter before the ceiling, device px */
  trueSizePx: number;
  /** peak intensity (linear, before knee) */
  peak: number;
  flux: number;
  /** fade for resolved galaxies we are inside of */
  fade: number;
}

/**
 * @param physRadiusPc physical radius for extended sources (galaxies, blobs) or 0 for a PSF
 * @param pxPerRad device px per radian of the canvas
 */
export function appearance(
  M: number, rPc: number, mRef: number, pxPerRad: number, dpr: number, physRadiusPc: number, maxCssPx: number,
): Appearance {
  const r = Math.max(rPc, 1e-7);
  const m = M + 5 * Math.log10(r / 10);
  const flux = Math.pow(10, -0.4 * (m - mRef));
  const base = BASE_PX * dpr;
  // the glow grows freely with flux; only the DRAWN size is capped below
  const phys = ((2 * physRadiusPc) / r) * pxPerRad;
  const psf = base * Math.max(Math.pow(flux, 0.25), 1);
  const trueSize = Math.max(psf, phys);
  const rRef = 0.5 * trueSize * (REF_PX_PER_RAD / pxPerRad);
  const peak = flux / (K_GAUSS * rRef * rRef);
  const maxPx = maxCssPx * dpr;
  const fade = physRadiusPc > 0 ? 1 - smooth(maxPx, 4 * maxPx, trueSize) : 1;
  return { sizePx: Math.min(trueSize, maxPx), trueSizePx: trueSize, peak, flux, fade };
}

/**
 * Light deposited by one sprite, in reference-pixel units: ∫ peak·g over the drawn disc,
 * converted from device px² to reference px². Equals `flux` whenever the ceiling is not hit.
 */
export function depositedLight(a: Appearance, pxPerRad: number): number {
  const rDrawRef = 0.5 * a.sizePx * (REF_PX_PER_RAD / pxPerRad);
  return a.peak * K_GAUSS * rDrawRef * rDrawRef;
}

function smooth(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** sRGB transfer functions (IEC 61966-2-1) */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
export function linearToSrgb(x: number): number {
  return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}
