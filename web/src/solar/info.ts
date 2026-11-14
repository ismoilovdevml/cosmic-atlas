/** Info-card content for Solar System bodies and probes (rows are [label, value], English via tr()). */

import type { Vec3 } from '../math/frames';
import { PC_PER_AU } from '../math/units';
import { BODY_BY_ID, KM_PER_AU } from './bodies';
import type { SolarEntry, SolarSystem } from './layer';
import { tr } from './strings';
import { AE_VERSION } from './ephemeris';
import { getLang } from '../i18n';
import { formatLatLon } from './features';

const LIGHT_MIN_PER_AU = 499.00478383615643 / 60;
const EARTH = BODY_BY_ID.get('earth')!;

function fmt(x: number, digits: number): string {
  return x.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

function sig(x: number, n = 4): string {
  if (x === 0) return '0';
  const d = Math.max(0, n - 1 - Math.floor(Math.log10(Math.abs(x))));
  return fmt(x, Math.min(d, 6));
}

/** "1.524 AU (12.67 light-minutes)" */
export function formatAuLight(pc: number): string {
  const au = pc / PC_PER_AU;
  const lmin = au * LIGHT_MIN_PER_AU;
  const light = lmin < 120 ? `${sig(lmin)} ${tr('unit.lmin')}` : `${sig(lmin / 60)} ${tr('unit.lhour')}`;
  const auS = au < 0.01 ? `${fmt(au * KM_PER_AU, 0)} ${tr('unit.km')}` : `${sig(au)} ${tr('unit.au')}`;
  return `${auS} (${light})`;
}

function sci(x: number): string {
  const e = Math.floor(Math.log10(x));
  return `${(x / 10 ** e).toFixed(3)} × 10^${e}`;
}

export interface SolarInfo {
  kind: string;
  title: string;
  rows: [string, string][];
  note: string;
  docs: string;
}

export function solarInfo(sys: SolarSystem, e: SolarEntry): SolarInfo {
  const earth: Vec3 = sys.positionOf('earth');
  const rows: [string, string][] = [];
  const dSun = Math.hypot(...e.xyz);
  const dEarth = Math.hypot(e.xyz[0] - earth[0], e.xyz[1] - earth[1], e.xyz[2] - earth[2]);
  if (e.solar.type === 'craft') {
    const c = sys.craftOf(e);
    if (c?.data.facts?.launch) rows.push([tr('facts.launch'), c.data.facts.launch]);
    if (c?.on) {
      rows.push([tr('facts.dist_sun'), formatAuLight(dSun)], [tr('facts.dist_earth'), formatAuLight(dEarth)]);
      const v = Math.hypot(...c.vel) / PC_PER_AU * KM_PER_AU / 86400;
      rows.push([tr('facts.speed_kms'), `${v.toFixed(2)} km/s`]);
    }
    const span = c ? sys.spanOf(c) : null;
    const isoDate = (jd: number) => new Date((jd - 2440587.5) * 86400000).toISOString().slice(0, 10);
    return {
      kind: tr('kind.spacecraft'),
      title: e.name,
      rows,
      note: tr('solar.note.craft', { span: span ? `${isoDate(span[0])} to ${isoDate(span[1])}` : 'n/a' }) + (c?.on ? '' : ' Outside the track at this time.'),
      docs: e.docs,
    };
  }
  if (e.solar.type === 'feature') {
    // a named place on the Moon or Mars (IAU Gazetteer / landing sites)
    const f = sys.featureOf(e)!;
    const ll = formatLatLon(f.lat, f.lon);
    rows.push([tr('facts.on_body'), tr(`body.${f.body}`)]);
    if (f.kind === 'surface_feature' && f.type) rows.push([tr('facts.feature_type'), f.type]);
    rows.push([tr('facts.latlon'), `${ll.lat.toFixed(3)}°, ${ll.lon.toFixed(3)}°`]);
    if (f.diam_km > 0) rows.push([tr('facts.diameter_km'), `${fmt(f.diam_km, f.diam_km < 10 ? 2 : 0)} ${tr('unit.km')}`]);
    if (f.origin) rows.push([tr('facts.named_after'), f.origin]);
    rows.push([tr('facts.dist_earth'), formatAuLight(dEarth)]);
    return {
      kind: tr(`kind.${f.kind}`),
      title: f.names[getLang()] ?? f.name,
      rows,
      note: tr(f.kind === 'landing_site' && !f.gid ? 'solar.note.lander' : 'solar.note.feature'),
      docs: e.docs,
    };
  }
  const def = BODY_BY_ID.get(e.solar.id)!;
  if (def.id !== 'sun') rows.push([tr('facts.dist_sun'), formatAuLight(dSun)]);
  if (def.id !== 'earth') rows.push([tr('facts.dist_earth'), formatAuLight(dEarth)]);
  const rE = def.radiusKm / EARTH.radiusKm;
  rows.push([tr('facts.radius_km'), `${fmt(def.radiusKm, def.radiusKm < 10000 ? 1 : 0)} ${tr('unit.km')}${def.id === 'earth' ? '' : ` (${sig(rE, 3)} ${tr('unit.earths')})`}`]);
  const mE = def.massKg / EARTH.massKg;
  rows.push([tr('facts.mass_kg'), `${sci(def.massKg)} kg${def.id === 'earth' ? '' : ` (${sig(mE, 3)} ${tr('unit.earths')})`}`]);
  if (def.periodDays) {
    const y = def.periodDays / 365.25;
    rows.push([tr('facts.period_days'), y >= 0.995 ? `${y.toFixed(y < 10 ? 2 : 1)} ${tr('unit.years')} (${fmt(def.periodDays, def.periodDays < 1000 ? 1 : 0)} ${tr('unit.days')})` : `${sig(def.periodDays, 4)} ${tr('unit.days')}`]);
  }
  const parent = def.parent ? BODY_BY_ID.get(def.parent)!.names.en : null;
  let note = tr('solar.note.body', { version: AE_VERSION });
  if (def.id === 'mars') note += ` ${tr('solar.note.moons_missing')}`;
  return {
    kind: parent && def.kind === 'moon' && def.parent !== 'earth' ? tr('kind.moon_of', { parent }) : tr(`kind.${def.kind}`),
    title: e.name,
    rows,
    note,
    docs: e.docs,
  };
}
