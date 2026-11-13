/**
 * Black holes from the catalogue (data/tiles/catalogs/black-holes.json): mass -> r_s, and the
 * orientation of the optional thin disk.
 *
 * Disk orientation is only known for the two event-horizon-scale targets. Both are given as the
 * inclination i of the disk's angular momentum to the line of sight toward Earth (i > 90°:
 * clockwise on the sky) and the position angle (east of north) of its sky projection:
 *   - M87*: i = 163°, the angular momentum along the receding (counter-)jet, whose PA is
 *     288° − 180° = 108°. Jet PA 288° and viewing angle 17°: Walker et al. 2018, ApJ 855, 128;
 *     spin pointing away from Earth, clockwise flow: EHT Collaboration 2019, ApJL 875, L5.
 *   - Sgr A*: i = 154.9°, PA 177.3° (GRAVITY Collaboration 2023, A&A 677, L10, combined flare fit,
 *     posterior means; clockwise on the sky). We read their Ω as the PA of the projected angular
 *     momentum; if it is the line of nodes instead, our bright side is 90° off on the sky.
 * Everything else gets the Galactic +z axis as an arbitrary normal and the disk off.
 */

import type { CatalogEntry } from '../data/manifest';
import { radecDistToGal, type Vec3 } from '../math/frames';
import type { FactValue } from '../objects/facts';
import { M_PER_PC, schwarzschildRadiusM } from './physics';

export interface DiskSpec {
  /** on when the hole is first visited */
  defaultOn: boolean;
  /** unit angular-momentum vector of the (prograde) disk, contract frame */
  n: Vec3;
  /** where the orientation comes from (i18n key) */
  source: string;
}

export interface BlackHole {
  entry: CatalogEntry;
  name: string;
  xyz: Vec3;
  massMsun: number;
  /** the catalogue mass was a range or a bound; massMsun is its midpoint / bound */
  massApprox: boolean;
  rsM: number;
  rsPc: number;
  disk: DiskSpec;
}

/** a mass fact: number, [value, err...] or text like "5.71–8.10 (...)", ">3.1 ± 0.1", "≤7.3" */
export function parseMassMsun(v: FactValue | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  if (Array.isArray(v)) return typeof v[0] === 'number' && v[0] > 0 ? v[0] : null;
  if (typeof v !== 'string') return null;
  const range = /^\s*[<>≤≥~]?\s*(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)/.exec(v);
  if (range) return (parseFloat(range[1]) + parseFloat(range[2])) / 2;
  const one = /(\d+(?:\.\d+)?)/.exec(v);
  return one ? parseFloat(one[1]) : null;
}

const DEG = Math.PI / 180;

function unit(v: Vec3): Vec3 {
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
}

/** unit vector of angular momentum with inclination i to the line of sight toward Earth and sky PA */
/** unit vectors (contract frame) of celestial north and east on the sky at (ra, dec), and the line of sight */
export function skyAxes(ra: number, dec: number): { north: Vec3; east: Vec3; los: Vec3 } {
  const p = radecDistToGal(ra, dec, 1);
  const e = 1e-4;
  const north = unit(radecDistToGal(ra, dec + e, 1).map((x, k) => x - p[k]) as Vec3);
  const east = unit(radecDistToGal(ra + e / Math.cos(dec * DEG), dec, 1).map((x, k) => x - p[k]) as Vec3);
  return { north, east, los: p };
}

export function diskNormal(ra: number, dec: number, iDeg: number, paDeg: number): Vec3 {
  const { north, east, los: p } = skyAxes(ra, dec);
  const toEarth: Vec3 = [-p[0], -p[1], -p[2]];
  const ci = Math.cos(iDeg * DEG);
  const si = Math.sin(iDeg * DEG);
  const cp = Math.cos(paDeg * DEG);
  const sp = Math.sin(paDeg * DEG);
  return unit([0, 1, 2].map((k) => ci * toEarth[k] + si * (cp * north[k] + sp * east[k])) as Vec3);
}

const KNOWN_DISKS: Record<string, { i: number; pa: number; source: string }> = {
  'M87*': { i: 163, pa: 108, source: 'bh.disk.src.m87' },
  'Sgr A*': { i: 154.9, pa: 177.3, source: 'bh.disk.src.sgra' },
};

export function blackHolesFrom(catalog: CatalogEntry[]): BlackHole[] {
  const out: BlackHole[] = [];
  for (const e of catalog) {
    if (e.kind !== 'black_hole' || !e.xyz) continue;
    const raw = e.facts?.mass_msun;
    const m = parseMassMsun(raw);
    if (!m) continue;
    const rsM = schwarzschildRadiusM(m);
    const known = KNOWN_DISKS[e.name];
    const disk: DiskSpec = known && e.ra !== undefined && e.dec !== undefined
      ? { defaultOn: true, n: diskNormal(e.ra, e.dec, known.i, known.pa), source: known.source }
      : { defaultOn: false, n: [0, 0, 1], source: 'bh.disk.src.none' };
    out.push({
      entry: e, name: e.name, xyz: e.xyz, massMsun: m, massApprox: typeof raw === 'string',
      rsM, rsPc: rsM / M_PER_PC, disk,
    });
  }
  return out;
}
