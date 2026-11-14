/**
 * Named surface features and landing sites of the Moon and Mars
 * (data/tiles/catalogs/planet-features.json, scripts/build_planet_features.py): IAU Gazetteer of
 * Planetary Nomenclature centre points, Wikidata ru/uz labels, Apollo LM and Mars lander positions.
 * Coordinates are planetocentric latitude and east longitude; layer.ts places them on the body at
 * the simulation time (they rotate with it).
 */

import type { Names } from './bodies';
import type { SurfaceBody } from './surface/tiles';

export interface PlanetFeature {
  name: string;
  alt: string[];
  kind: 'surface_feature' | 'landing_site';
  body: SurfaceBody;
  lat: number;
  lon: number;
  diam_km: number;
  type: string;
  names: Names;
  gid?: number;
  link?: string;
  origin?: string;
  ref: string;
}

/** validate the catalogue rows we can use; others are skipped */
export function parseFeatures(json: unknown): PlanetFeature[] {
  if (!Array.isArray(json)) return [];
  const out: PlanetFeature[] = [];
  for (const r of json as Record<string, unknown>[]) {
    if (!r || (r.body !== 'moon' && r.body !== 'mars')) continue;
    if (typeof r.lat !== 'number' || typeof r.lon !== 'number' || typeof r.name !== 'string') continue;
    const names = (r.names ?? {}) as Partial<Names>;
    out.push({
      name: r.name,
      alt: Array.isArray(r.alt) ? (r.alt as string[]) : [],
      kind: r.kind === 'landing_site' ? 'landing_site' : 'surface_feature',
      body: r.body,
      lat: r.lat,
      lon: r.lon,
      diam_km: typeof r.diam_km === 'number' ? r.diam_km : 0,
      type: typeof r.type === 'string' ? r.type : '',
      names: { en: names.en ?? r.name, uz: names.uz ?? names.en ?? r.name, ru: names.ru ?? names.en ?? r.name },
      gid: typeof r.gid === 'number' ? r.gid : undefined,
      link: typeof r.link === 'string' ? r.link : undefined,
      origin: typeof r.origin === 'string' ? r.origin : undefined,
      ref: typeof r.ref === 'string' ? r.ref : '',
    });
  }
  return out;
}

/** effective size (km) used to decide when a label shows: landing sites are points */
export const labelSizeKm = (f: PlanetFeature) => (f.kind === 'landing_site' ? 30 : Math.max(f.diam_km, 1));

/** camera altitude (km) for a "fly here" that frames the feature looking straight down */
export function viewAltitudeKm(f: PlanetFeature, radiusKm: number): number {
  if (f.kind === 'landing_site') return 30;
  return Math.min(radiusKm * 0.8, Math.max(20, f.diam_km * 1.3));
}

/** "43.296° S, 11.215° W" style readout with east longitude in (−180, 180] */
export function formatLatLon(lat: number, lonEast: number): { lat: number; lon: number } {
  let lon = ((lonEast % 360) + 360) % 360;
  if (lon > 180) lon -= 360;
  return { lat, lon };
}
