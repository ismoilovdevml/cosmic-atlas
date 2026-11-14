/** web/public/layers.json: which layers and catalogues the viewer knows about. */

import type { Vec3 } from '../math/frames';
import type { FactValue, Planet } from '../objects/facts';
import { fetchJson } from './tilebase';

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
  /** hidden automatically once any of these layers is available */
  fallbackFor?: string | string[];
  /** built from part of the data only (e.g. the Gaia chunks downloaded so far): tagged in the panel */
  preview?: boolean;
  credit?: string;
}

export interface ModelLayerConfig {
  id: string;
  type: 'milky-way-model' | 'sky';
  title: string;
  visible: boolean;
  credit?: string;
  /** sky only: full-resolution image URL (JPEG: the fallback every browser decodes) */
  image?: string;
  /** sky only: the same image as WebP (smaller), tried before `image` */
  imageWebp?: string;
  /** sky only: small preview shown until the full image is in (progressive loading) */
  preview?: string;
}

export type LayerConfig = PointLayerConfig | ModelLayerConfig;

export interface Manifest {
  version: number;
  /** default tile origin when neither ?tiles= nor VITE_TILE_BASE is set (see tilebase.ts) */
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
  /** NaN / null when the catalogue has no distance */
  dist_pc: number;
  dist_lo_pc?: number | null;
  dist_hi_pc?: number | null;
  mag?: number | null;
  /** null when there is no distance: only the direction (ra, dec) is known */
  xyz: Vec3 | null;
  ref?: string;
  doi?: string;
  /** docs article slug (content contract section 3); defaults to the kind's article */
  docs?: string;
  /** numbers as value, [value, err] or [value, err_minus, err_plus]; keys end in their unit */
  facts?: Record<string, FactValue>;
  /** per-fact citation when it differs from the entry's ref */
  facts_ref?: Record<string, string>;
  /** exoplanets.json: the planets of this host star */
  planets?: Planet[];
  /** set by the loader: which file it came from */
  source?: string;
}

/**
 * Kinds drawn AT another object (a planet system at its star, a pulsar in its nebula, a black hole in
 * a galaxy nucleus): they share names with that object but are separate entries, so duplicate
 * detection only compares them with entries of the same kind.
 */
export const OWN_NAMESPACE_KINDS = new Set(['exoplanet', 'pulsar', 'black_hole', 'message', 'seti_signal']);

/**
 * Optional listing of what is built under tiles/ ({layers: [...], catalogs: [...]}). The dev
 * server generates it; for a static host, scripts/write_tiles_index.py writes the same file. When
 * it is absent, every configured layer and catalogue is probed (missing ones show up as 404s).
 */
export interface TilesIndex {
  layers: string[];
  catalogs: string[];
}

/** `base` is the tile base ending in '/' (tilebase.ts) */
export async function loadTilesIndex(base = 'tiles/'): Promise<TilesIndex | null> {
  const r = await fetchJson<TilesIndex>(`${base}_index.json`);
  if (r.status !== 'ok') return null;
  const j = r.data;
  return j && Array.isArray(j.layers) && Array.isArray(j.catalogs) ? j : null;
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
      const r = await fetchJson<CatalogEntry[]>(u);
      return { u, data: r.status === 'ok' ? r.data : null };
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
      if (!e || typeof e.name !== 'string') continue;
      const hasXyz = Array.isArray(e.xyz) && e.xyz.length === 3 && e.xyz.every(Number.isFinite);
      const hasDir = Number.isFinite(e.ra) && Number.isFinite(e.dec);
      if (!hasXyz && !hasDir) continue;
      if (!hasXyz) e.xyz = null;
      // planet names are search aliases of their host system (exoplanets.json leaves alt empty)
      if (Array.isArray(e.planets) && e.planets.length) {
        e.alt = [...(e.alt ?? []), ...e.planets.map((p) => p.pl_name).filter((n) => typeof n === 'string')];
      }
      // the same object can appear in several catalogues under different primary names
      // (e.g. 'Andromeda (M31)' and 'MESSIER031'): any shared name or alias makes it a duplicate
      const ns = OWN_NAMESPACE_KINDS.has(e.kind) ? `${e.kind}:` : '';
      const keys = [e.name, ...(e.alt ?? [])].map(catalogKey).filter(Boolean).map((k) => ns + k);
      if (keys.some((k) => seen.has(k))) continue;
      keys.forEach((k) => seen.add(k));
      entries.push({ ...e, source: u.split('/').pop() });
    }
  }
  return { entries, missing };
}
