/**
 * Point appearance model, shared by the GLSL point shader and the CPU picker so that what
 * you click is what you see. Keep `POINT_GLSL` and `appearance()` in sync.
 *
 *   M      absolute magnitude decoded from the lum byte (contract section 3)
 *   m      = M + 5 log10(r / 10 pc), r = distance from the camera
 *   flux   = 10^(-0.4 (m - mRef)), mRef = reference magnitude set by the exposure control
 *
 * A point of flux 1 is drawn as a PSF of BASE_PX with peak 1 (before the asinh stretch).
 * Brighter points grow as flux^0.25 and their peak is divided by the area increase, so the
 * integrated light stays proportional to flux (the HDR buffer then carries the true sum of
 * many faint points). Galaxies additionally have a physical radius (R ~ 10 kpc at M=-21,
 * R ∝ L^0.3) so nearby ones resolve into extended, constant-surface-brightness smudges.
 */

export const BASE_PX = 1.7;
export const STAR_MAX_PX = 16;
export const GAL_MAX_PX = 220;

export type PointKind = 'star' | 'galaxy';

export function absMagFromLum(lum: number, kind: PointKind): number {
  return kind === 'star' ? 20 - lum / 10 : -14 - lum / 20;
}

export function galaxyRadiusPc(M: number): number {
  return 1e4 * Math.pow(10, -0.12 * (M + 21));
}

export interface Appearance {
  sizePx: number;
  intensity: number;
}

/** CPU twin of the shader. `dpr` scales pixel sizes for device pixels. */
export function appearance(M: number, rPc: number, kind: PointKind, mRef: number, pxPerRad: number, dpr = 1): Appearance {
  const r = Math.max(rPc, 1e-7);
  const m = M + 5 * Math.log10(r / 10);
  const flux = Math.pow(10, -0.4 * (m - mRef));
  const base = BASE_PX * dpr;
  const grow = Math.min(Math.max(Math.pow(flux, 0.25), 1), (STAR_MAX_PX * dpr) / base);
  let size = base * grow;
  if (kind === 'galaxy') {
    const phys = (galaxyRadiusPc(M) / r) * pxPerRad * 2;
    size = Math.max(size, phys);
  }
  const intensity = Math.min(flux * (base / size) * (base / size), 4000);
  const maxPx = (kind === 'galaxy' ? GAL_MAX_PX : STAR_MAX_PX) * dpr;
  return { sizePx: Math.min(size, maxPx), intensity };
}

export const POINT_GLSL = /* glsl */ `
uniform float uMRef;
uniform float uPxPerRad;
uniform float uDpr;
uniform float uOpacity;
uniform float uKind; // 0 star, 1 galaxy

const float BASE_PX = ${BASE_PX.toFixed(4)};
const float STAR_MAX_PX = ${STAR_MAX_PX.toFixed(4)};
const float GAL_MAX_PX = ${GAL_MAX_PX.toFixed(4)};

// returns vec3(sizePx, intensity, fade)
vec3 appearance(float M, float r) {
  r = max(r, 1e-7);
  float m = M + 5.0 * log(r / 10.0) / log(10.0);
  float flux = pow(10.0, -0.4 * (m - uMRef));
  float base = BASE_PX * uDpr;
  float grow = min(max(pow(flux, 0.25), 1.0), STAR_MAX_PX * uDpr / base);
  float size = base * grow;
  float fade = 1.0;
  if (uKind > 0.5) {
    float phys = 1e4 * pow(10.0, -0.12 * (M + 21.0)) / r * uPxPerRad * 2.0;
    size = max(size, phys);
    // inside / right next to a galaxy: fade it out instead of filling the screen
    fade = 1.0 - smoothstep(GAL_MAX_PX * uDpr, 4.0 * GAL_MAX_PX * uDpr, size);
  }
  float intensity = min(flux * (base / size) * (base / size), 4000.0);
  float maxPx = (uKind > 0.5 ? GAL_MAX_PX : STAR_MAX_PX) * uDpr;
  return vec3(min(size, maxPx), intensity, fade);
}
`;
