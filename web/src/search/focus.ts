/**
 * `#focus=<name>` and `#layer=<id>` targets (page URLs and links inside docs articles).
 *
 * resolveFocus: a Solar System body id, a named view id, a catalogue object (name or alias, then the
 * slug form "sgr-a-star" ↔ "Sgr A*"), or an exact multilingual alias ("Yer", "Млечный путь").
 * Pure (no DOM), so a test can check every target the articles use.
 */

import type { CatalogEntry } from '../data/manifest';
import { normName } from '../data/resolve';
import { SCALE_TOUR } from '../tour/tours';
import { BODIES, NAMED_VIEWS, fold, matchAliases, type AliasTarget, type NamedView } from './aliases';

export type FocusTarget = { type: 'catalog'; entry: CatalogEntry } | Exclude<AliasTarget, { type: 'catalog' }>;

/** "Sgr A*" → "sgr-a-star", the form docs use in #focus= links */
export function slugify(s: string): string {
  return fold(s.replace(/\*/g, ' star ').replace(/\+/g, ' plus ')).replace(/ /g, '-');
}

/** an entry whose own name matches wins over one that only lists the name as an alias */
function findEntry(catalog: CatalogEntry[], names: string[]): CatalogEntry | null {
  const keys = names.map(normName).filter(Boolean);
  return catalog.find((e) => keys.includes(normName(e.name)))
    ?? catalog.find((e) => (e.alt ?? []).some((n) => keys.includes(normName(n)))) ?? null;
}

export function resolveFocus(name: string, catalog: CatalogEntry[]): FocusTarget | null {
  const raw = name.trim();
  if (!raw) return null;
  const id = raw.toLowerCase();
  if (BODIES.includes(id)) return { type: 'body', id };
  if (NAMED_VIEWS[id]) return { type: 'view', id };
  const exact = findEntry(catalog, [raw]);
  if (exact) return { type: 'catalog', entry: exact };
  const alias = matchAliases(raw.replace(/-/g, ' '), 1).find((m) => m.score >= 96);
  if (alias) {
    const tg = alias.entry.target;
    if (tg.type !== 'catalog') return tg;
    const e = findEntry(catalog, tg.names);
    if (e) return { type: 'catalog', entry: e };
  }
  const slug = slugify(raw);
  const bySlug = catalog.find((e) => [e.name, ...(e.alt ?? [])].some((n) => slugify(n) === slug));
  return bySlug ? { type: 'catalog', entry: bySlug } : null;
}

const beat = (id: string): NamedView => {
  const b = SCALE_TOUR.beats.find((x) => x.id === id)!;
  return { target: b.target, dist: b.dist, pitchDeg: b.pitchDeg, yawDeg: b.yawDeg };
};

/** where to look when a link turns a layer on (`#layer=<id>`) */
export const LAYER_VIEWS: Record<string, NamedView> = {
  'stars-gaia': beat('neighbourhood'),
  'synthetic-stars': beat('neighbourhood'),
  'galaxies-desi': NAMED_VIEWS['desi-footprint'],
  'synthetic-galaxies': NAMED_VIEWS['desi-footprint'],
  // 2MRS reaches cz ≈ 9,000 km/s (~130 Mpc); CF4 is similar in depth
  'galaxies-2mrs': { target: { sun: true }, dist: 4e8, pitchDeg: 30 },
  'galaxies-cf4': { target: { sun: true }, dist: 4e8, pitchDeg: 30 },
  'local-group': NAMED_VIEWS['local-group'],
  'local-volume': { target: { sun: true }, dist: 2.5e7, pitchDeg: 30 },
  'milky-way-model': NAMED_VIEWS['milky-way'],
  // the Solar System layer (src/solar) is not in layers.json; main.ts adds it to the panel
  solar: NAMED_VIEWS['solar-system'],
  // the all-sky image is only drawn within ~2 kpc of the Sun
  'gaia-sky': { target: { sun: true }, dist: 1, pitchDeg: 10 },
  // Hunt & Reffert clusters thin out beyond ~3 kpc; the bright, nearby ones within 1 kpc
  'star-clusters': { target: { sun: true }, dist: 1500, pitchDeg: 35 },
  // GWTC events reach ~3.5 Gpc comoving; 4 Gpc of camera distance shows them all
  'gw-volumes': { target: { sun: true }, dist: 4e9, pitchDeg: 25 },
  // multi-messenger layers (src/messengers): the CMB shell whole from the zoom limit; FRB hosts
  // reach z ~ 1 (3.4 Gpc); neutrino alerts are sky regions, so look at the sky from the Sun
  cmb: { target: { sun: true }, dist: 3e10, pitchDeg: 20 },
  frb: { target: { sun: true }, dist: 6e9, pitchDeg: 25 },
  neutrinos: { target: { sun: true }, dist: 1, pitchDeg: 10 },
};

export const LAYER_ID = /^[A-Za-z0-9_.-]{1,64}$/;
