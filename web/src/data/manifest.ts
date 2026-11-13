/** web/public/layers.json: which layers and catalogues the viewer knows about. */

import type { Vec3 } from '../math/frames';

export type ColorMode = 'star' | 'galaxy';

export interface PointLayerConfig {
  id: string;
  type?: 'points';
  title: string;
  /** URL path (relative to the page) of the layer directory holding meta.json */
  path: string;
  visible: boolean;
  colorMode: ColorMode;
  /** brightness offset in magnitudes for this layer (default 0) */
  magOffset?: number;
  /** development data; hidden automatically once the named real layer is available */
  dev?: boolean;
  fallbackFor?: string;
  credit?: string;
}

export interface ModelLayerConfig {
  id: string;
  type: 'milky-way-model' | 'sky';
  title: string;
  visible: boolean;
  credit?: string;
  /** sky only: image URL and its pixel size */
  image?: string;
}

export type LayerConfig = PointLayerConfig | ModelLayerConfig;

export interface Manifest {
  version: number;
  tilesBase?: string;
  catalogs: string[];
  layers: LayerConfig[];
}

export function isPointLayer(c: LayerConfig): c is PointLayerConfig {
  return c.type === undefined || c.type === 'points';
}

/** Catalogue entry, docs/data-contract.md section 4. */
export interface CatalogEntry {
  name: string;
  alt?: string[];
  kind: string;
  ra?: number;
  dec?: number;
  dist_pc: number;
  mag?: number | null;
  xyz: Vec3;
  ref?: string;
  /** set by the loader: which file it came from */
  source?: string;
}

/**
 * Optional listing of what is built under tiles/ ({layers: [...], catalogs: [...]}). The dev
 * server generates it; on a static host it may be absent, in which case every configured layer
 * and catalogue is probed (and missing ones show up as 404s in the console).
 */
export interface TilesIndex {
  layers: string[];
  catalogs: string[];
}

export async function loadTilesIndex(base = 'tiles'): Promise<TilesIndex | null> {
  try {
    const r = await fetch(`${base}/_index.json`);
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return null;
    const j = (await r.json()) as TilesIndex;
    return Array.isArray(j.layers) && Array.isArray(j.catalogs) ? j : null;
  } catch {
    return null;
  }
}

export async function loadManifest(url = 'layers.json'): Promise<Manifest> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return (await r.json()) as Manifest;
}

/** normalised identifier for duplicate detection: case/space-free, MESSIER031 -> m31 */
export function catalogKey(s: string): string {
  const k = s.toLowerCase().replace(/[^a-z0-9*+]/g, '');
  const m = k.match(/^(?:messier|m)0*(\d{1,3})$/);
  if (m) return `m${m[1]}`;
  const n = k.match(/^(ngc|ic|ugc|pgc|hip|hd)0*(\d+)$/);
  return n ? `${n[1]}${n[2]}` : k;
}

/** Load all catalogue files that exist; missing ones are reported, not fatal. */
export async function loadCatalogs(urls: string[]): Promise<{ entries: CatalogEntry[]; missing: string[] }> {
  const entries: CatalogEntry[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  const results = await Promise.all(
    urls.map(async (u) => {
      try {
        const r = await fetch(u);
        if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return { u, data: null };
        return { u, data: (await r.json()) as CatalogEntry[] };
      } catch {
        return { u, data: null };
      }
    }),
  );
  // real catalogues first so they win over dev placeholders with the same name
  results.sort((a, b) => Number(a.u.includes('placeholder')) - Number(b.u.includes('placeholder')));
  for (const { u, data } of results) {
    if (!data || !Array.isArray(data)) {
      missing.push(u);
      continue;
    }
    for (const e of data) {
      if (!e || !Array.isArray(e.xyz) || typeof e.name !== 'string') continue;
      // the same object can appear in several catalogues under different primary names
      // (e.g. 'Andromeda (M31)' and 'MESSIER031'): any shared name or alias makes it a duplicate
      const keys = [e.name, ...(e.alt ?? [])].map(catalogKey).filter(Boolean);
      if (keys.some((k) => seen.has(k))) continue;
      keys.forEach((k) => seen.add(k));
      entries.push({ ...e, source: u.split('/').pop() });
    }
  }
  return { entries, missing };
}
