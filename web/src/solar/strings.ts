/**
 * English UI strings for the Solar System module, keyed like web/src/i18n/{uz,en,ru}.json
 * (docs/content-contract.md §1). There is no i18n module in this branch yet, so `tr()` is a tiny
 * local stand-in with the same signature as the planned `t(key, vars?)`: the i18n work can move
 * these keys into en.json and replace `tr` with `t` one-for-one.
 */

import { hasKey, t } from '../i18n';

const EN: Record<string, string> = {
  'layer.solar': 'Solar System',
  'layer.solar.meta': 'Live positions from astronomy-engine; probe tracks from JPL Horizons.',
  'kind.sun': 'Star',
  'kind.planet': 'Planet',
  'kind.dwarf_planet': 'Dwarf planet',
  'kind.moon': 'Moon',
  'kind.spacecraft': 'Spacecraft',
  'kind.moon_of': 'Moon of {parent}',
  'facts.dist_sun': 'From the Sun now',
  'facts.dist_earth': 'From Earth now',
  'facts.radius_km': 'Mean radius',
  'facts.mass_kg': 'Mass',
  'facts.period_days': 'Orbital period',
  'facts.launch': 'Launched',
  'facts.speed_kms': 'Speed (heliocentric)',
  'facts.not_shown': 'Not shown',
  'unit.au': 'AU',
  'unit.lmin': 'light-minutes',
  'unit.lhour': 'light-hours',
  'unit.km': 'km',
  'unit.days': 'days',
  'unit.years': 'years',
  'unit.earths': 'Earth',
  'time.now': 'Now',
  'time.pause': 'Pause',
  'time.play': 'Play',
  'time.speed': 'Speed',
  'time.label': 'Simulation time',
  'time.utc': 'UTC',
  'solar.note.body': 'Position from astronomy-engine {version} at the time shown in the time bar. Radius: IAU WGCCRE 2015 (Archinal et al. 2018). Mass and period: NASA planetary fact sheets.',
  'solar.note.craft': 'Track: JPL Horizons heliocentric vectors every 30 days ({span}), cubic Hermite interpolation.',
  'solar.note.moons_missing': 'Phobos and Deimos are not shown: astronomy-engine has no ephemeris for them.',
  'solar.credit': 'Solar System: positions from astronomy-engine 2.1.19 (MIT, Don Cross); probe tracks from JPL Horizons; textures: Solar System Scope (CC BY 4.0), Earth: NASA Blue Marble Next Generation (NASA Earth Observatory).',
};

/** the i18n `t()` for keys in the dictionaries (all of these are), else this English table */
export function tr(key: string, vars?: Record<string, string | number>): string {
  if (hasKey(key, 'en')) return t(key, vars);
  let s = EN[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

export const SOLAR_STRINGS: Readonly<Record<string, string>> = EN;
