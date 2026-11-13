/**
 * Pure geometry and LOD maths for resolved galaxies (render/galaxyShapes.ts draws them).
 * No three.js here, so everything is unit-tested in test/galaxyGeom.test.ts.
 *
 * Frame: heliocentric Galactic Cartesian (contract section 1). A galaxy at (ra, dec) has, in that
 * frame, a line of sight ŝ (Sun → galaxy) and local sky axes ê_N (toward the north celestial
 * pole) and ê_E (toward increasing RA). Position angles are measured North through East.
 *
 *   major axis on the sky  â = cos PA ê_N + sin PA ê_E
 *   minor axis on the sky  b̂ = −sin PA ê_N + cos PA ê_E
 *   disk normal            n̂ = cos i ŝ + sin i b̂      (which side is near is not known; we pick +)
 *   second in-plane axis   m̂ = −sin i ŝ + cos i b̂     (projects onto the sky as cos i · b̂)
 *
 * A point of the disk plane at (u, v) (units of the D25 radius R) is C + R(u â + v m̂). Seen from
 * the Sun it lands at sky offset u â + v cos i b̂, so a photograph taken from Earth can be painted
 * onto the plane with texture coordinates from that offset: exact from the Sun, approximate from
 * anywhere else (the image cannot show the galaxy from another side).
 */

import { ICRS_TO_GAL, mulMat3, type Vec3 } from '../math/frames';

const DEG = Math.PI / 180;
export const ARCMIN = Math.PI / 10800;

/** LOD ladder, projected major-axis diameter in CSS px (after skymap's galaxyLodBands, re-derived) */
export const DISK_FADE: [number, number] = [8, 14];
export const THUMB_FADE: [number, number] = [24, 40];
/** request a thumbnail a little before it can fade in */
export const THUMB_REQUEST_PX = 20;
/** surface-brightness display ramp: photometric at the dot crossfade, display exposure beyond */
export const DISPLAY_RAMP: [number, number] = [14, 80];

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export interface LodWeights {
  dot: number;
  disk: number;
  thumb: number;
}

/**
 * Crossfade weights for one galaxy. `thumbReady` (0..1) is the thumbnail's own fade-in once its
 * image has arrived (0 while missing or failed). By construction dot + disk + thumb = 1.
 */
export function lodWeights(px: number, thumbReady: number): LodWeights {
  const s1 = smoothstep(DISK_FADE[0], DISK_FADE[1], px);
  const s2 = smoothstep(THUMB_FADE[0], THUMB_FADE[1], px) * Math.min(1, Math.max(0, thumbReady));
  const thumb = s2;
  const disk = s1 * (1 - s2);
  return { dot: 1 - disk - thumb, disk, thumb };
}

export interface SkyFrame {
  los: Vec3;
  north: Vec3;
  east: Vec3;
}

/** line of sight and local North/East unit vectors at (ra, dec), in the Galactic frame */
export function skyFrame(raDeg: number, decDeg: number): SkyFrame {
  const a = raDeg * DEG;
  const d = decDeg * DEG;
  const los: Vec3 = [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
  const east: Vec3 = [-Math.sin(a), Math.cos(a), 0];
  const north: Vec3 = [-Math.sin(d) * Math.cos(a), -Math.sin(d) * Math.sin(a), Math.cos(d)];
  return { los: mulMat3(ICRS_TO_GAL, los), north: mulMat3(ICRS_TO_GAL, north), east: mulMat3(ICRS_TO_GAL, east) };
}

export interface DiskAxes extends SkyFrame {
  /** major axis on the sky (in the disk plane) */
  major: Vec3;
  /** minor axis direction on the sky (not in the plane unless face-on) */
  minorSky: Vec3;
  /** second in-plane axis, perpendicular to major */
  inPlane: Vec3;
  normal: Vec3;
}

export function diskAxes(raDeg: number, decDeg: number, paDeg: number, cosI: number): DiskAxes {
  const f = skyFrame(raDeg, decDeg);
  const p = paDeg * DEG;
  const c = Math.min(1, Math.max(0, cosI));
  const s = Math.sqrt(1 - c * c);
  const lin = (a: Vec3, ka: number, b: Vec3, kb: number): Vec3 => [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb];
  const major = lin(f.north, Math.cos(p), f.east, Math.sin(p));
  const minorSky = lin(f.north, -Math.sin(p), f.east, Math.cos(p));
  return { ...f, major, minorSky, inPlane: lin(f.los, -s, minorSky, c), normal: lin(f.los, c, minorSky, s) };
}

/**
 * Cosine of the tilt used for the drawn plane. The catalogue inclination already includes the
 * intrinsic-thickness correction, so an edge-on disk can have cos i ≈ 0 while its isophote still
 * has b/a ≈ 0.15. The plane is a thin sheet, so it is never tilted beyond cos = 0.85 b/a: the
 * Earth-view strip of the sheet then still contains the whole D25 ellipse (and the thumbnail's
 * galaxy). Without a catalogue inclination the thin-disk value cos i = b/a is used.
 */
export function planeCos(inclDeg: number | null | undefined, q: number): number {
  const qq = Math.min(1, Math.max(0.02, q));
  if (inclDeg === null || inclDeg === undefined || !Number.isFinite(inclDeg)) return qq;
  return Math.min(1, Math.max(Math.cos(inclDeg * DEG), 0.85 * qq));
}

/**
 * Sky offset (east, north) in units of R of the plane point (u, v), seen from the Sun.
 * `c` is cos(plane tilt) for disks, b/a for spheroids (whose v axis is the sky minor axis).
 */
export function skyOffset(u: number, v: number, c: number, paDeg: number): { east: number; north: number } {
  const p = paDeg * DEG;
  return { east: u * Math.sin(p) + v * c * Math.cos(p), north: u * Math.cos(p) - v * c * Math.sin(p) };
}

/** thumbnail texture coordinates for a sky offset in units of R. The cutout is north-up,
 *  east-left, spans ±fovR (half its field in units of R) and is uploaded as a DataTexture in
 *  decoded row order (flipY off), so v = 0 is the top (north) row. */
export function thumbUV(east: number, north: number, fovR: number): [number, number] {
  return [0.5 - east / (2 * fovR), 0.5 - north / (2 * fovR)];
}

export function physicalDiameterPc(majorArcmin: number, distPc: number): number {
  return majorArcmin * ARCMIN * distPc;
}

// ---------------------------------------------------------------- procedural profiles
/** exponential disk scale length in units of R25 (D25 ≈ 3.2 scale lengths for a typical spiral) */
export const DISK_H = 0.3;
/** the plane quad spans ±QUAD_R in units of R (the thumbnail covers 1.5 × D25) */
export const QUAD_R = 1.5;
/** bulge billboard half-size and Sérsic n = 2 effective radius, units of R */
export const BULGE_QUAD = 0.4;
export const BULGE_RE = 0.08;
/** spheroid (E/dE/dSph) Sérsic n = 2 effective radius, units of R */
export const SPHEROID_RE = 0.35;

export const taper = (rho: number): number => 1 - smoothstep(1.0, QUAD_R, rho);
export const diskProfile = (rho: number): number => Math.exp(-rho / DISK_H) * taper(rho);
export const sersic2 = (rho: number, re: number): number => Math.exp(-3.67 * Math.sqrt(rho / re));
export const bulgeProfile = (rho: number): number => sersic2(rho, BULGE_RE) * (1 - smoothstep(0.6 * BULGE_QUAD, BULGE_QUAD, rho));
export const spheroidProfile = (rho: number): number => sersic2(rho, SPHEROID_RE) * taper(rho);

/** ∫ p(ρ) 2πρ dρ from 0 to `rMax` (midpoint rule, smooth profiles) */
export function radialIntegral(p: (rho: number) => number, rMax: number, n = 4000): number {
  let s = 0;
  const h = rMax / n;
  for (let i = 0; i < n; i++) {
    const r = (i + 0.5) * h;
    s += p(r) * 2 * Math.PI * r * h;
  }
  return s;
}

export const K_DISK_IN = radialIntegral(diskProfile, 1);
export const K_SPH_IN = radialIntegral(spheroidProfile, 1);
export const K_BULGE = radialIntegral(bulgeProfile, BULGE_QUAD);

/** bulge fraction of the light by de Vaucouleurs type T (rough, Simien & de Vaucouleurs 1986 trend) */
export function bulgeFraction(t: number | null | undefined): number {
  if (t === null || t === undefined || !Number.isFinite(t)) return 0.15;
  if (t <= 0) return 0.5;
  if (t >= 9) return 0;
  return 0.5 * Math.pow(1 - t / 9, 1.6);
}

/**
 * Peak intensities that make the mean intensity over the projected D25 ellipse equal `target`.
 *   disk part:  I_d · p_d(ρ),        ∫_{ρ<1} p_d = K_DISK_IN
 *   bulge part: I_b · p_b(ρ_screen), drawn camera-facing; its light is f_b of the D25 total
 * `cosView` = |n̂ · line of sight| of the plane as seen by the camera (projected area factor),
 * floored at 0.15 (real disks are not infinitely thin).
 */
export function peakIntensities(target: number, fb: number, cosView: number, spheroid: boolean): { disk: number; bulge: number } {
  if (spheroid) return { disk: (target * Math.PI) / K_SPH_IN, bulge: 0 };
  const cv = Math.max(0.15, Math.abs(cosView));
  return { disk: ((1 - fb) * target * Math.PI) / K_DISK_IN, bulge: (fb * target * Math.PI * cv) / K_BULGE };
}

/** mean surface brightness (mag/arcsec²) inside the isophotal ellipse */
export function meanSurfaceBrightness(mag: number, majorArcmin: number, minorArcmin: number): number {
  const a = majorArcmin * 30; // semi-axes in arcsec
  const b = minorArcmin * 30;
  return mag + 2.5 * Math.log10(Math.PI * a * b);
}

/**
 * Display intensity (linear, mean over D25) of a resolved galaxy. A real resolved galaxy is far
 * too faint for the point auto-exposure, so resolved disks get their own surface-brightness
 * exposure: 0.12 at μ = 22 mag/arcsec², scaled by 10^(−0.4 Δμ) and by the Exposure slider.
 */
export function displayIntensity(mu: number, exposureMag: number): number {
  const v = 0.12 * Math.pow(10, -0.4 * (mu - 22)) * Math.pow(10, 0.4 * exposureMag);
  return Math.min(0.6, Math.max(0.03, v));
}
