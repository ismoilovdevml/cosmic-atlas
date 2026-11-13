/**
 * Density-aware exposure for galaxies at survey scales.
 *
 * In density mode every galaxy is a fixed small sprite of the same energy E = k·K_GAUSS·r²
 * (r = sprite radius, device px). Additive light per screen bin is then k·K·r²·count/area, so the
 * exposure k that maps the 98th percentile of the frame's bin density to a target luminance T is
 *
 *     k = T · binArea / (p98(count) · K_GAUSS · r²)
 *
 * The counts come from a strided sample of the drawn galaxy points (≤ maxSamples), projected on the
 * CPU and filtered by the same thin slab as the shader, so a dense z < 0.4 core does not saturate
 * and sparse filaments stay visible (a floor keeps a lone galaxy faintly visible).
 */

import { K_GAUSS } from './brightness';

export interface SamplePoints {
  /** node centre − camera, pc (float64) */
  rel: [number, number, number];
  positions: Float32Array;
  count: number;
  /** own-points alpha of the node (fades) */
  alpha: number;
}

export interface ProjectionParams {
  /** row-major 3×3 world → view rotation */
  rot: number[];
  /** device px per unit of x/(−z) at the screen centre */
  f: number;
  width: number;
  height: number;
  slabZ: number;
  slabHalf: number;
}

export const GRID_X = 48;
export const GRID_Y = 30;

/** p-quantile of an array (0..1), nearest-rank */
export function percentile(values: ArrayLike<number>, p: number): number {
  const a = Array.from(values).sort((x, y) => x - y);
  if (!a.length) return 0;
  return a[Math.min(a.length - 1, Math.max(0, Math.ceil(p * a.length) - 1))];
}

/** Counts of (sampled, re-weighted) galaxies per screen bin. */
export function binCounts(nodes: SamplePoints[], P: ProjectionParams, maxSamples: number): Float32Array {
  const bins = new Float32Array(GRID_X * GRID_Y);
  let total = 0;
  for (const n of nodes) total += n.count;
  const stride = Math.max(1, Math.ceil(total / maxSamples));
  const R = P.rot;
  const hw = P.width / 2;
  const hh = P.height / 2;
  for (const n of nodes) {
    const pos = n.positions;
    const w = stride * n.alpha;
    for (let i = (n.count * 0.37) % stride | 0; i < n.count; i += stride) {
      const x = n.rel[0] + pos[i * 3];
      const y = n.rel[1] + pos[i * 3 + 1];
      const z = n.rel[2] + pos[i * 3 + 2];
      const vx = R[0] * x + R[1] * y + R[2] * z;
      const vy = R[3] * x + R[4] * y + R[5] * z;
      const vz = R[6] * x + R[7] * y + R[8] * z;
      if (vz >= 0) continue;
      if (Math.abs(vz - P.slabZ) > P.slabHalf) continue;
      const sx = hw + (P.f * vx) / -vz;
      const sy = hh - (P.f * vy) / -vz;
      if (sx < 0 || sy < 0 || sx >= P.width || sy >= P.height) continue;
      bins[((sy / P.height) * GRID_Y | 0) * GRID_X + ((sx / P.width) * GRID_X | 0)] += w;
    }
  }
  return bins;
}

export interface ExposureOptions {
  /** target linear luminance for the p98 bin */
  target: number;
  /** sprite diameter, device px */
  spritePx: number;
  /** a lone galaxy never goes below this peak */
  kMin: number;
  kMax: number;
}

export const DEFAULT_EXPOSURE: ExposureOptions = { target: 0.9, spritePx: 2.2, kMin: 0.06, kMax: 3 };

export function exposureFromCounts(bins: Float32Array, width: number, height: number, o: ExposureOptions): { k: number; p98: number } {
  const p98 = percentile(bins, 0.98);
  const binArea = (width / GRID_X) * (height / GRID_Y);
  const r = o.spritePx / 2;
  if (p98 <= 0) return { k: o.kMax, p98 };
  const k = (o.target * binArea) / (p98 * K_GAUSS * r * r);
  return { k: Math.min(o.kMax, Math.max(o.kMin, k)), p98 };
}

/** temporal smoothing in log space, so exposure eases instead of flickering */
export function smoothExposure(prev: number, next: number, dt: number, tau = 0.6): number {
  if (!(prev > 0)) return next;
  const a = 1 - Math.exp(-dt / tau);
  return Math.exp(Math.log(prev) + (Math.log(next) - Math.log(prev)) * a);
}
