/**
 * Earth satellites: CelesTrak GP (OMM) rows -> SGP4 (satellite.js) -> the contract frame.
 *
 * SGP4 returns positions in TEME (true equator, mean equinox of date), km. TEME -> Earth-fixed is a
 * rotation by GMST about the true pole (Vallado et al. 2006, AIAA 2006-6753, "Revisiting Spacetrack
 * Report #3", sec. on TEME), and earthFrame() (ephemeris.ts) already gives the Earth-fixed axes in
 * the Galactic frame (GAST about the true pole, precession + nutation from astronomy-engine). So
 *   gal = [X Y Z] · R3(GMST) · teme
 * which also keeps the satellites in step with the drawn, rotating Earth. Polar motion (~10 m) and
 * UT1 - UTC (< 0.9 s, ~0.4 km along an LEO track at most) are ignored, as in earthFrame().
 */

import { gstime, json2satrec, propagate, type OMMJsonObject, type SatRec } from './satellitejs';
import type { Vec3 } from '../math/frames';
import { earthFrame } from './ephemeris';

export const SATELLITE_JS_VERSION = '7.1.0';

export interface GpSnapshot {
  fields: string[];
  rows: (string | number)[][];
  group: number[];
}

export interface SatRecord {
  name: string;
  norad: number;
  intl: string;
  /** element epoch, ms since 1970 UTC */
  epochMs: number;
  /** 0 = space station, 1 = Starlink, 2 = other active */
  group: number;
  /** inclination (deg) and mean motion (rev/day) from the element set, for the info card */
  incDeg: number;
  revPerDay: number;
  ecc: number;
  rec: SatRec;
}

/** parse gp.json (scripts/build_satellites.py); rows SGP4 cannot initialise are dropped */
export function parseGp(doc: GpSnapshot): SatRecord[] {
  const ix = (k: string) => doc.fields.indexOf(k);
  const iName = ix('OBJECT_NAME');
  const iId = ix('OBJECT_ID');
  const iEp = ix('EPOCH');
  const iNorad = ix('NORAD_CAT_ID');
  const out: SatRecord[] = [];
  doc.rows.forEach((row, k) => {
    const o: Record<string, string | number> = {};
    doc.fields.forEach((f, i) => (o[f] = row[i]));
    let rec: SatRec;
    try {
      rec = json2satrec(o as unknown as OMMJsonObject);
    } catch {
      return;
    }
    if (rec.error) return;
    const ep = String(row[iEp]);
    out.push({
      name: String(row[iName]), norad: Number(row[iNorad]), intl: String(row[iId]),
      epochMs: Date.parse(ep.endsWith('Z') ? ep : `${ep}Z`), group: doc.group[k] ?? 2,
      incDeg: Number(o.INCLINATION), revPerDay: Number(o.MEAN_MOTION), ecc: Number(o.ECCENTRICITY), rec,
    });
  });
  return out;
}

/** row-major TEME -> Galactic rotation at a UTC time (ms) */
export function temeToGal(ms: number, out: number[] = new Array(9)): number[] {
  const d = new Date(ms);
  const g = gstime(d);
  const c = Math.cos(g);
  const s = Math.sin(g);
  const F = earthFrame(d);
  // ecef = R3(g) teme:  ex = c tx + s ty,  ey = -s tx + c ty,  ez = tz
  for (let r = 0; r < 3; r++) {
    out[r * 3] = F.x[r] * c - F.y[r] * s;
    out[r * 3 + 1] = F.x[r] * s + F.y[r] * c;
    out[r * 3 + 2] = F.z[r];
  }
  return out;
}

export function mat3Apply(m: readonly number[], v: Vec3, out: Vec3 = [0, 0, 0]): Vec3 {
  const x = v[0];
  const y = v[1];
  const z = v[2];
  out[0] = m[0] * x + m[1] * y + m[2] * z;
  out[1] = m[3] * x + m[4] * y + m[5] * z;
  out[2] = m[6] * x + m[7] * y + m[8] * z;
  return out;
}

/** SGP4 state in TEME (km, km/s) at a UTC time, or null if SGP4 fails (decayed, bad elements) */
export function sgp4Teme(rec: SatRec, ms: number): { r: Vec3; v: Vec3 } | null {
  const pv = propagate(rec, new Date(ms));
  if (!pv || !pv.position || typeof pv.position === 'boolean' || !pv.velocity || typeof pv.velocity === 'boolean') return null;
  const p = pv.position;
  const v = pv.velocity;
  if (!Number.isFinite(p.x)) return null;
  return { r: [p.x, p.y, p.z], v: [v.x, v.y, v.z] };
}

/** geocentric position in the Galactic frame, km */
export function satGeocentricGalKm(rec: SatRec, ms: number): Vec3 | null {
  const s = sgp4Teme(rec, ms);
  return s ? mat3Apply(temeToGal(ms), s.r) : null;
}
