/**
 * Sky-direction data of the multi-messenger layers (pure; unit-tested in test/messengers.test.ts).
 *
 * frb-sky.json (scripts/build_frb.py) and neutrino-sky.json (scripts/build_neutrinos.py) are
 * column tables. Each row becomes a catalogue entry WITHOUT a position in space (xyz = null): only
 * its direction is known, and the info card says so. Neutrino rows also carry their 90 % error
 * region (an RA/Dec rectangle for IceCat-1, a circle for KM3-230213A), outlined on the sky.
 */

import type { CatalogEntry } from '../data/manifest';
import type { FactValue } from '../objects/facts';
import { radecDistToGal, type Vec3 } from '../math/frames';

export interface SkyTable {
  columns: string[];
  src: Record<string, string>;
  note?: string;
  rows: (string | number | null)[][];
}

export interface SkyItem {
  entry: CatalogEntry;
  /** unit vector, contract Galactic frame */
  dir: Vec3;
  /** 0..1 brightness of the marker */
  weight: number;
  /** marker glyph: 0 ring (FRB), 1 star (neutrino) */
  glyph: number;
  /** larger marker (repeating FRB, KM3NeT event) */
  big: boolean;
  /** 90 % error region outline as unit vectors (closed loop), neutrinos only */
  region?: Vec3[];
}

const row = (t: SkyTable, r: (string | number | null)[]) => Object.fromEntries(t.columns.map((c, i) => [c, r[i]])) as Record<string, string | number | null>;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function frbItems(t: SkyTable): SkyItem[] {
  return t.rows.map((r) => {
    const o = row(t, r);
    const ra = num(o.ra)!;
    const dec = num(o.dec)!;
    const facts: Record<string, FactValue> = {};
    if (num(o.dm_pc_cm3) !== null) facts.dm_pc_cm3 = o.dm_pc_cm3 as number;
    if (num(o.fluence_jy_ms) !== null) facts[o.repeater ? 'fluence_median_jy_ms' : 'fluence_jy_ms'] = o.fluence_jy_ms as number;
    facts.repeater = !!o.repeater;
    if ((o.n_bursts as number) > 1) facts.n_bursts = o.n_bursts as number;
    facts.host_galaxy = null; // not identified: the card shows "—"
    if (num(o.err_deg) !== null && (o.err_deg as number) > 0) facts.position_error_deg = Number((o.err_deg as number).toPrecision(2));
    const name = String(o.name);
    const entry: CatalogEntry = {
      name, alt: [name.replace(/\s+/g, '')], kind: 'frb', ra, dec, dist_pc: NaN, xyz: null,
      ref: t.src[String(o.src)] ?? String(o.src), facts, source: 'frb-sky.json',
    };
    return { entry, dir: radecDistToGal(ra, dec, 1), weight: o.repeater ? 1 : 0.55, glyph: 0, big: !!o.repeater };
  });
}

/** closed outline of an RA/Dec rectangle (deg of the coordinate, as IceCat-1 quotes them) */
export function rectOutline(ra: number, dec: number, raPlus: number, raMinus: number, decPlus: number, decMinus: number, perEdge = 12): Vec3[] {
  const r0 = ra - raMinus;
  const r1 = ra + raPlus;
  const d0 = Math.max(-90, dec - decMinus);
  const d1 = Math.min(90, dec + decPlus);
  const pts: Vec3[] = [];
  const lerp = (a: number, b: number, k: number) => a + (b - a) * (k / perEdge);
  for (let k = 0; k < perEdge; k++) pts.push(radecDistToGal(lerp(r0, r1, k), d0, 1));
  for (let k = 0; k < perEdge; k++) pts.push(radecDistToGal(r1, lerp(d0, d1, k), 1));
  for (let k = 0; k < perEdge; k++) pts.push(radecDistToGal(lerp(r1, r0, k), d1, 1));
  for (let k = 0; k < perEdge; k++) pts.push(radecDistToGal(r0, lerp(d1, d0, k), 1));
  return pts;
}

/** closed small circle of angular radius rDeg around (ra, dec) */
export function circleOutline(ra: number, dec: number, rDeg: number, n = 48): Vec3[] {
  const c = radecDistToGal(ra, dec, 1);
  // two unit vectors perpendicular to c
  const a: Vec3 = Math.abs(c[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = norm(cross(c, a));
  const v = cross(c, u);
  const r = (rDeg * Math.PI) / 180;
  const pts: Vec3[] = [];
  for (let k = 0; k < n; k++) {
    const t = (2 * Math.PI * k) / n;
    pts.push(norm([0, 1, 2].map((i) => Math.cos(r) * c[i] + Math.sin(r) * (Math.cos(t) * u[i] + Math.sin(t) * v[i])) as Vec3));
  }
  return pts;
}

export function neutrinoItems(t: SkyTable): SkyItem[] {
  return t.rows.map((r) => {
    const o = row(t, r);
    const ra = num(o.ra)!;
    const dec = num(o.dec)!;
    const km3 = o.src === 'KM3';
    const facts: Record<string, FactValue> = {};
    if (km3) facts.energy_pev = [220, 110, 570];
    else if (num(o.energy_tev) !== null) facts.energy_tev = o.energy_tev as number;
    if (num(o.signalness) !== null) facts.signalness = o.signalness as number;
    if (num(o.far_per_yr) !== null) facts.far_per_yr = o.far_per_yr as number;
    facts.error_90 = km3
      ? `r = ${o.r90_deg}°`
      : `RA +${o.ra_plus}° / −${o.ra_minus}°, Dec +${o.dec_plus}° / −${o.dec_minus}°`;
    facts.alert_type = String(o.type);
    facts.detected = String(o.date);
    if (o.cr_veto) facts.cr_veto = true;
    const name = String(o.name);
    const entry: CatalogEntry = {
      name, kind: 'neutrino', ra, dec, dist_pc: NaN, xyz: null, ref: t.src[String(o.src)] ?? String(o.src), facts,
      source: 'neutrino-sky.json', ...(km3 ? { doi: '10.1038/s41586-024-08543-1', facts_ref: { energy_pev: 'KM3NeT Collaboration 2025, arXiv:2502.08173 (68 % range)' } } : {}),
    };
    const region = km3
      ? circleOutline(ra, dec, num(o.r90_deg) ?? 2.2)
      : rectOutline(ra, dec, o.ra_plus as number, o.ra_minus as number, o.dec_plus as number, o.dec_minus as number);
    const s = num(o.signalness);
    return { entry, dir: radecDistToGal(ra, dec, 1), weight: km3 ? 1 : 0.25 + 0.75 * (s ?? 0.5), glyph: 1, big: km3, region };
  });
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function norm(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
