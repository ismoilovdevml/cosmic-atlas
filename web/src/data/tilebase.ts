/**
 * Where the tiles live. The app (index.html, JS, layers.json, the sky image) is always served from
 * the page's own origin; the tile directory (layer octrees, meta.json, catalogues, _index.json) can
 * live anywhere that answers plain CORS GETs: a `tiles/` folder next to the page, a second static
 * site, a Hugging Face dataset or an R2 bucket.
 *
 * Precedence: `?tiles=<url>` (testing) > VITE_TILE_BASE (build time) > layers.json `tilesBase` >
 * `tiles/`. Fetches never send credentials or custom headers, so they stay "simple" CORS requests
 * without a preflight.
 */

import type { Manifest } from './manifest';

export const DEFAULT_TILE_BASE = 'tiles/';

/** Is `s` usable as a tile base? Relative paths and http(s) URLs only (no data:, javascript:, blob:). */
export function isUsableBase(s: string, pageHref: string): boolean {
  try {
    const u = new URL(s, pageHref);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Always ends with one '/', so `base + 'layer/meta.json'` works. */
export function normalizeBase(s: string): string {
  return s.replace(/\/+$/, '') + '/';
}

/**
 * Pick the tile base. `search` is `location.search`, `envBase` is `import.meta.env.VITE_TILE_BASE`.
 * Empty or unusable values fall through to the next source.
 */
export function resolveTileBase(search: string, envBase: string | undefined, manifestBase: string | undefined, pageHref: string): string {
  const fromQuery = new URLSearchParams(search).get('tiles') ?? '';
  for (const s of [fromQuery, envBase ?? '', manifestBase ?? '']) {
    const t = s.trim();
    if (t && isUsableBase(t, pageHref)) return normalizeBase(t);
  }
  return DEFAULT_TILE_BASE;
}

/**
 * layers.json names tile paths as `tiles/<layer>` and `tiles/catalogs/<file>.json` (relative to the
 * page). Re-root them on `base`. Paths that do not start with `tiles/` (absolute URLs, app assets)
 * are left alone.
 */
export function rebaseTilePath(p: string, base: string): string {
  const m = p.match(/^(?:\.\/)?tiles\/(.*)$/);
  return m ? normalizeBase(base) + m[1] : p;
}

/** A copy of the manifest with every layer path and catalogue URL re-rooted on `base`. */
export function applyTileBase(m: Manifest, base: string): Manifest {
  return {
    ...m,
    catalogs: (m.catalogs ?? []).map((c) => rebaseTilePath(c, base)),
    layers: m.layers.map((L) => ('path' in L && typeof L.path === 'string' ? { ...L, path: rebaseTilePath(L.path, base) } : L)),
  };
}

export type JsonResult<T> = { status: 'ok'; data: T } | { status: 'missing'; http: number } | { status: 'error'; message: string };

/**
 * GET a JSON file from the tile origin. A 404 or an HTML page (an SPA fallback answering 200 for
 * anything) means "not there". The Content-Type is not required to say json: Hugging Face serves
 * .json as text/plain, so the body is parsed and a parse failure is reported as an error.
 */
export async function fetchJson<T>(url: string): Promise<JsonResult<T>> {
  let r: Response;
  try {
    r = await fetch(url, { credentials: 'omit' });
  } catch (e) {
    return { status: 'error', message: (e as Error).message };
  }
  const type = (r.headers.get('content-type') ?? '').toLowerCase();
  if (r.status === 404 || (r.ok && type.includes('text/html'))) return { status: 'missing', http: r.status };
  if (!r.ok) return { status: 'error', message: `HTTP ${r.status}` };
  try {
    return { status: 'ok', data: JSON.parse(await r.text()) as T };
  } catch (e) {
    return { status: 'error', message: `invalid JSON (${(e as Error).message})` };
  }
}
