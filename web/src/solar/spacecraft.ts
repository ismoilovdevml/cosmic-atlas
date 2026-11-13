/**
 * Probe tracks from data/tiles/catalogs/spacecraft.json (scripts/build_spacecraft.py): JPL Horizons
 * heliocentric state vectors every 30 days, already in the contract frame (pc, pc/day).
 * Positions between samples use cubic Hermite interpolation on position + velocity, which is
 * exact for the straight cruise and keeps flybys (New Horizons at Jupiter, 2007) close.
 */

import type { Vec3 } from '../math/frames';

export interface CraftTrack {
  t0_jd_tdb: number;
  step_days: number;
  n: number;
  xyz_pc: number[];
  vel_pc_per_day: number[];
}

export interface CraftEntry {
  name: string;
  alt?: string[];
  kind: 'spacecraft';
  docs?: string;
  facts?: { launch?: string; horizons_id?: number };
  ref?: string;
  provenance?: Record<string, unknown>;
  track: CraftTrack;
}

export function parseSpacecraft(json: unknown): CraftEntry[] {
  if (!Array.isArray(json)) return [];
  return json.filter((e): e is CraftEntry => {
    const t = (e as CraftEntry)?.track;
    return !!t && Number.isFinite(t.t0_jd_tdb) && t.step_days > 0 && t.n >= 2 &&
      t.xyz_pc?.length === t.n * 3 && t.vel_pc_per_day?.length === t.n * 3;
  });
}

/** JD (TDB) range covered by a track */
export function trackSpan(t: CraftTrack): [number, number] {
  return [t.t0_jd_tdb, t.t0_jd_tdb + (t.n - 1) * t.step_days];
}

/**
 * Position (pc) and velocity (pc/day) at `jd` (TDB), or null outside the track. Cubic Hermite on
 * the cell [i, i+1]: p(s) = h00 p0 + h10 h v0 + h01 p1 + h11 h v1, s in [0, 1], h = step.
 */
export function interpolateTrack(t: CraftTrack, jd: number, out?: Vec3): { pos: Vec3; vel: Vec3 } | null {
  const f = (jd - t.t0_jd_tdb) / t.step_days;
  if (!(f >= 0 && f <= t.n - 1)) return null;
  const i = Math.min(t.n - 2, Math.floor(f));
  const s = f - i;
  const h = t.step_days;
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  // derivatives with respect to s (divided by h for velocity)
  const d00 = 6 * s2 - 6 * s;
  const d10 = 3 * s2 - 4 * s + 1;
  const d01 = -6 * s2 + 6 * s;
  const d11 = 3 * s2 - 2 * s;
  const pos: Vec3 = out ?? [0, 0, 0];
  const vel: Vec3 = [0, 0, 0];
  const P = t.xyz_pc;
  const V = t.vel_pc_per_day;
  for (let k = 0; k < 3; k++) {
    const p0 = P[i * 3 + k];
    const p1 = P[i * 3 + 3 + k];
    const v0 = V[i * 3 + k];
    const v1 = V[i * 3 + 3 + k];
    pos[k] = h00 * p0 + h10 * h * v0 + h01 * p1 + h11 * h * v1;
    vel[k] = (d00 * p0 + d10 * h * v0 + d01 * p1 + d11 * h * v1) / h;
  }
  return { pos, vel };
}
