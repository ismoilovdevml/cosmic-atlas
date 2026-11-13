/**
 * Coordinate frames (docs/data-contract.md section 1).
 *
 * World frame = heliocentric Galactic Cartesian as defined by astropy `Galactic`:
 * +x toward l=0,b=0 (Galactic Centre), +y toward l=90, +z toward the NGP. Unit: parsec.
 */

export type Vec3 = [number, number, number];

const DEG = Math.PI / 180;

/**
 * ICRS -> Galactic rotation matrix, row-major. Derived from astropy 8.0.2 by transforming
 * the ICRS unit vectors into `Galactic` (columns = images of x, y, z), so the viewer uses
 * exactly the frame the tile builder uses. Orthonormal to 2e-15.
 */
export const ICRS_TO_GAL: readonly number[] = [
  -0.05487565771259165, -0.8734370519556157, -0.48383507361671546,
  0.49410943719272676, -0.4448297212232951, 0.7469821839866675,
  -0.8676661375596576, -0.19807633727300059, 0.4559838136873016,
];

export function mulMat3(m: readonly number[], v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

export function mulMat3T(m: readonly number[], v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
    m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
    m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
  ];
}

export function radecToIcrsUnit(raDeg: number, decDeg: number): Vec3 {
  const a = raDeg * DEG;
  const d = decDeg * DEG;
  return [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
}

/** RA/Dec (ICRS, degrees) + distance (pc) -> heliocentric Galactic xyz (pc). */
export function radecDistToGal(raDeg: number, decDeg: number, distPc: number): Vec3 {
  const g = mulMat3(ICRS_TO_GAL, radecToIcrsUnit(raDeg, decDeg));
  return [g[0] * distPc, g[1] * distPc, g[2] * distPc];
}

export function norm(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

/** Galactic xyz -> (l, b) in degrees, l in [0, 360). */
export function galToLB(v: Vec3): { l: number; b: number; dist: number } {
  const r = norm(v);
  if (r === 0) return { l: 0, b: 0, dist: 0 };
  let l = Math.atan2(v[1], v[0]) / DEG;
  if (l < 0) l += 360;
  return { l, b: Math.asin(Math.max(-1, Math.min(1, v[2] / r))) / DEG, dist: r };
}

/** Galactic xyz -> ICRS RA/Dec in degrees, RA in [0, 360). */
export function galToRadec(v: Vec3): { ra: number; dec: number; dist: number } {
  const r = norm(v);
  if (r === 0) return { ra: 0, dec: 0, dist: 0 };
  const e = mulMat3T(ICRS_TO_GAL, v);
  let ra = Math.atan2(e[1], e[0]) / DEG;
  if (ra < 0) ra += 360;
  return { ra, dec: Math.asin(Math.max(-1, Math.min(1, e[2] / r))) / DEG, dist: r };
}

/**
 * Hammer-Aitoff forward projection used by the Gaia all-sky image
 * (l = 0 at centre, l increasing to the LEFT, b = +90 at top).
 * Returns texture uv with v = 0 at the bottom row (three.js flipY convention), using the
 * image's pixel-centre convention x = linspace(+2sqrt2, -2sqrt2, W), y = linspace(+sqrt2, -sqrt2, H).
 */
export function hammerUV(lDeg: number, bDeg: number, width: number, height: number): [number, number] {
  let l = lDeg * DEG;
  if (l > Math.PI) l -= 2 * Math.PI;
  const b = bDeg * DEG;
  const d = Math.sqrt(1 + Math.cos(b) * Math.cos(l / 2));
  const x = (2 * Math.SQRT2 * Math.cos(b) * Math.sin(l / 2)) / d;
  const y = (Math.SQRT2 * Math.sin(b)) / d;
  const col = ((2 * Math.SQRT2 - x) / (4 * Math.SQRT2)) * (width - 1);
  const row = ((Math.SQRT2 - y) / (2 * Math.SQRT2)) * (height - 1);
  return [(col + 0.5) / width, 1 - (row + 0.5) / height];
}
