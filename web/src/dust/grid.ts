/**
 * The 3D dust grid (data/tiles/dust/, written by scripts/build_dust.py): layout, decoding, and the
 * CPU twin of the GPU ray march. Pure, so it is unit-tested (test/dust.test.ts) and used for picks.
 *
 * Frame: heliocentric Galactic Cartesian, pc (data contract §1). Both textures are x-fastest, then
 * y, then z. Voxel (i, j, k) covers origin + [i, i+1) × voxelPc along x, and so on; its value is the
 * average over that cell, so it sits at the cell centre. Sampling follows the GPU's linear filter
 * with clamp-to-edge: normalised coordinate u = (x − origin) / (dims × voxel), texel coordinate
 * u × dims − 0.5.
 */

import type { Vec3 } from '../math/frames';

export interface GridDesc {
  file: string;
  dims: [number, number, number];
  voxelPc: number;
  origin: [number, number, number];
  format: 'r8' | 'rgba8';
  bytes: number;
}

export interface DustMeta {
  layer: 'dust';
  title: string;
  quantity: string;
  eToAv: number;
  /** [inner, outer] radius of the data, pc (outside the outer one the field is 0) */
  dataRadiusPc: [number, number];
  innerAssumption: string;
  fine: GridDesc;
  aux: GridDesc;
  mean: { lo: number; hi: number };
  std: { lo: number; hi: number; aggregation: string };
  sunAv: { max: number };
  percentiles: Record<string, Record<string, number>>;
  rgbExtinctionRatio: { lambdaNm: number[]; ratioToAV: [number, number, number]; law: string };
  landmarks: { name: string; lb: [number, number]; d_lit_pc: number; xyz: Vec3; ref: string }[];
  citation: string;
  doi: string;
  license: string;
}

/** half-thickness of the grid's z extent, pc */
export function zHalf(m: DustMeta): number {
  return (m.fine.dims[2] * m.fine.voxelPc) / 2;
}

/** voxel index (i, j, k) containing xyz, or null outside the grid */
export function voxelOf(g: GridDesc, p: Vec3): [number, number, number] | null {
  const out: number[] = [];
  for (let a = 0; a < 3; a++) {
    const i = Math.floor((p[a] - g.origin[a]) / g.voxelPc);
    if (i < 0 || i >= g.dims[a]) return null;
    out.push(i);
  }
  return out as [number, number, number];
}

/** centre of voxel (i, j, k), pc */
export function voxelCentre(g: GridDesc, ijk: [number, number, number]): Vec3 {
  return [0, 1, 2].map((a) => g.origin[a] + (ijk[a] + 0.5) * g.voxelPc) as Vec3;
}

/** byte offset of voxel (i, j, k) for `channels` bytes per voxel */
export function voxelOffset(g: GridDesc, ijk: [number, number, number], channels = 1): number {
  return ((ijk[2] * g.dims[1] + ijk[1]) * g.dims[0] + ijk[0]) * channels;
}

/** normalised texture coordinate of xyz (what the shader computes) */
export function texCoord(g: GridDesc, p: Vec3): Vec3 {
  return [0, 1, 2].map((a) => (p[a] - g.origin[a]) / (g.dims[a] * g.voxelPc)) as Vec3;
}

/** log code (0..255, may be fractional after filtering) -> value; build_dust.py log_decode */
export function decodeLog(c: number, lo: number, hi: number): number {
  return c >= 1 ? Math.pow(10, lo + ((c - 1) / 254) * (hi - lo)) : c * Math.pow(10, lo);
}

/**
 * Trilinear sample (clamp to edge) of one byte channel: of the codes themselves (0..255), or of
 * lut[code] when a table is given (the decoded value, interpolated linearly as on the GPU)
 */
export function sampleCode(g: GridDesc, data: Uint8Array, p: Vec3, channels = 1, channel = 0, lut?: Float64Array): number {
  const [nx, ny] = g.dims;
  // GPU linear filter, clamp to edge: texel coordinate f, neighbours floor(f) and floor(f) + 1, clamped
  const f = [0, 1, 2].map((a) => (p[a] - g.origin[a]) / g.voxelPc - 0.5);
  const fl = f.map(Math.floor);
  const w = f.map((v, a) => v - fl[a]);
  const i0 = fl.map((v, a) => Math.min(Math.max(v, 0), g.dims[a] - 1));
  const i1 = fl.map((v, a) => Math.min(Math.max(v + 1, 0), g.dims[a] - 1));
  const at = (x: number, y: number, z: number) => {
    const c = data[((z * ny + y) * nx + x) * channels + channel];
    return lut ? lut[c] : c;
  };
  let s = 0;
  for (let dz = 0; dz < 2; dz++)
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++) {
        const wt = (dx ? w[0] : 1 - w[0]) * (dy ? w[1] : 1 - w[1]) * (dz ? w[2] : 1 - w[2]);
        if (wt) s += wt * at(dx ? i1[0] : i0[0], dy ? i1[1] : i0[1], dz ? i1[2] : i0[2]);
      }
  return s;
}

/** code -> value table of a log encoding */
export function decodeTable(lo: number, hi: number): Float64Array {
  const t = new Float64Array(256);
  for (let c = 0; c < 256; c++) t[c] = decodeLog(c, lo, hi);
  return t;
}

export class DustGrid {
  private readonly meanLut: Float64Array;
  private readonly stdLut: Float64Array;

  constructor(readonly meta: DustMeta, readonly fine: Uint8Array, readonly aux: Uint8Array) {
    this.meanLut = decodeTable(meta.mean.lo, meta.mean.hi);
    this.stdLut = decodeTable(meta.std.lo, meta.std.hi);
    if (fine.length !== meta.fine.bytes) throw new Error(`dust fine grid: ${fine.length} B, meta says ${meta.fine.bytes}`);
    if (aux.length !== meta.aux.bytes) throw new Error(`dust aux grid: ${aux.length} B, meta says ${meta.aux.bytes}`);
  }

  /** posterior mean A_V per kpc at p, 6 pc grid (decoded values interpolated, as on the GPU) */
  density(p: Vec3): number {
    return sampleCode(this.meta.fine, this.fine, p, 1, 0, this.meanLut);
  }

  /** 12 pc mean and std of A_V per kpc at p */
  coarse(p: Vec3): { mean: number; std: number } {
    const m = this.meta;
    return {
      mean: sampleCode(m.aux, this.aux, p, 4, 0, this.meanLut),
      std: sampleCode(m.aux, this.aux, p, 4, 1, this.stdLut),
    };
  }

  /** A_V (mag) from the Sun to p; beyond the data, to where the Sun→p ray leaves it */
  sunAv(p: Vec3): number {
    const q = clampToData(this.meta, p);
    const hi = sampleCode(this.meta.aux, this.aux, q, 4, 2);
    const lo = sampleCode(this.meta.aux, this.aux, q, 4, 3);
    return ((hi * 256 + lo) / 65535) * this.meta.sunAv.max;
  }

  /**
   * CPU twin of the shader's march: A_V (mag) along the ray from c in unit direction d, over the part
   * of the ray inside the data (sphere ∩ slab), up to tMax. Midpoint rule with `steps` samples.
   */
  rayAv(c: Vec3, d: Vec3, steps = 512, tMax = Infinity): number {
    const iv = rayInterval(this.meta, c, d);
    if (!iv) return 0;
    const t1 = Math.min(iv[1], tMax);
    if (t1 <= iv[0]) return 0;
    const dt = (t1 - iv[0]) / steps;
    let a = 0;
    for (let i = 0; i < steps; i++) {
      const s = iv[0] + (i + 0.5) * dt;
      a += this.density([c[0] + d[0] * s, c[1] + d[1] * s, c[2] + d[2] * s]);
    }
    return (a * dt) / 1e3;
  }

  /**
   * The cloud a click lands on: along the ray, the point that contributes most to what you see
   * (max of density × transmittance), if its density exceeds `minDensity` mag/kpc.
   */
  pick(c: Vec3, d: Vec3, minDensity = 0.5, steps = 1024): DustPick | null {
    const iv = rayInterval(this.meta, c, d);
    if (!iv) return null;
    const dt = (iv[1] - iv[0]) / steps;
    let a = 0;
    let best = -1;
    let bestS = 0;
    let bestRho = 0;
    let aBefore = 0;
    for (let i = 0; i < steps; i++) {
      const s = iv[0] + (i + 0.5) * dt;
      const rho = this.density([c[0] + d[0] * s, c[1] + d[1] * s, c[2] + d[2] * s]);
      const score = rho * Math.pow(10, -0.4 * a);
      if (score > best) {
        best = score;
        bestS = s;
        bestRho = rho;
        aBefore = a;
      }
      a += (rho * dt) / 1e3;
    }
    if (bestRho < minDensity) return null;
    const p: Vec3 = [c[0] + d[0] * bestS, c[1] + d[1] * bestS, c[2] + d[2] * bestS];
    const co = this.coarse(p);
    const near = nearestLandmark(this.meta, p);
    return {
      xyz: p, distCam: bestS, density: bestRho, coarseMean: co.mean, coarseStd: co.std,
      // relative uncertainty from the 12 pc grid, applied to the 6 pc value
      densityStd: co.mean > 0 ? (bestRho * co.std) / co.mean : NaN,
      avFromCamera: aBefore, avRayTotal: a, avFromSun: this.sunAv(p), landmark: near,
    };
  }
}

export interface DustPick {
  xyz: Vec3;
  distCam: number;
  density: number;
  densityStd: number;
  coarseMean: number;
  coarseStd: number;
  avFromCamera: number;
  avRayTotal: number;
  avFromSun: number;
  landmark: { name: string; sepPc: number; ref: string } | null;
}

/** landmark (validation cloud) within 40 pc of p */
export function nearestLandmark(m: DustMeta, p: Vec3, maxPc = 40): { name: string; sepPc: number; ref: string } | null {
  let best: { name: string; sepPc: number; ref: string } | null = null;
  for (const l of m.landmarks) {
    const s = Math.hypot(p[0] - l.xyz[0], p[1] - l.xyz[1], p[2] - l.xyz[2]);
    if (s <= maxPc && (!best || s < best.sepPc)) best = { name: l.name, sepPc: s, ref: l.ref };
  }
  return best;
}

/** where the data lives: |p| ≤ R (outer data radius) and |z| ≤ grid half-thickness */
export function dataBounds(m: DustMeta): { R: number; Z: number } {
  return { R: m.dataRadiusPc[1], Z: zHalf(m) };
}

/** [t0, t1] of the ray c + t d (d unit, t ≥ 0) inside sphere(R) ∩ slab(|z| ≤ Z), or null */
export function rayInterval(m: DustMeta, c: Vec3, d: Vec3): [number, number] | null {
  const { R, Z } = dataBounds(m);
  const b = c[0] * d[0] + c[1] * d[1] + c[2] * d[2];
  const cc = c[0] * c[0] + c[1] * c[1] + c[2] * c[2] - R * R;
  const disc = b * b - cc;
  if (disc <= 0) return null;
  const sq = Math.sqrt(disc);
  let t0 = Math.max(-b - sq, 0);
  let t1 = -b + sq;
  if (Math.abs(d[2]) > 1e-9) {
    const ta = (-Z - c[2]) / d[2];
    const tb = (Z - c[2]) / d[2];
    t0 = Math.max(t0, Math.min(ta, tb));
    t1 = Math.min(t1, Math.max(ta, tb));
  } else if (Math.abs(c[2]) > Z) return null;
  return t1 > t0 ? [t0, t1] : null;
}

/**
 * p pulled back along the Sun→p ray to just inside the data (sphere ∩ slab, minus one coarse voxel),
 * where the A_V from the Sun stops growing; the shader does the same.
 */
export function clampToData(m: DustMeta, p: Vec3): Vec3 {
  const { R, Z } = dataBounds(m);
  const pad = m.aux.voxelPc * 0.5;
  const r = Math.hypot(p[0], p[1], p[2]);
  let k = 1;
  if (r > R - pad) k = Math.min(k, (R - pad) / r);
  if (Math.abs(p[2]) > Z - pad) k = Math.min(k, (Z - pad) / Math.abs(p[2]));
  return [p[0] * k, p[1] * k, p[2] * k];
}

/** relative extinction factor for light that was photometered from the Sun (see dust/shader.ts) */
export function relativeFactor(avCam: number, avSun: number, ratio: number, cap: number): number {
  return Math.min(Math.pow(10, -0.4 * ratio * (avCam - avSun)), cap);
}
