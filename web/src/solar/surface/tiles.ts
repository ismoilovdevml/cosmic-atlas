/**
 * Geographic (equirectangular) tile pyramid shared by the NASA Trek WMTS layers and the Murray Lab
 * CTX MapServer cache: level 0 is 2 × 1 tiles of 180°, origin (−180°, +90°), row 0 at the north,
 * each level halves the tile. Trek tiles are 256 px, CTX 512 px, over the same geometry
 * (checked against both capabilities documents on 2026-11-14, see docs/open-data-inventory.md).
 *
 * Endpoints, checked 2026-11-14 with `curl -H 'Origin: https://example.org'` (all answer
 * `Access-Control-Allow-Origin: *`):
 *   Moon  LRO WAC global mosaic v2, 303 ppd (levels 0-8; ~83 m/px at level 8)
 *   Moon  LRO LOLA colour-shaded relief v6, 256 ppd (levels 0-6)
 *   Mars  Viking MDIM 2.1 colour mosaic, 232 m (levels 0-7)
 *   Mars  MGS MOLA colour-shaded relief, 463 m (levels 0-7)
 *   Mars  MRO CTX global mosaic beta01, Murray Lab / Caltech, ~5 m/px (Esri cache, levels 0-17;
 *         native resolution is reached at level 12)
 */

import type { BodyId } from '../bodies';

export interface TileSource {
  id: string;
  /** tile edge in pixels */
  px: number;
  minLevel: number;
  maxLevel: number;
  url: (z: number, x: number, y: number) => string;
  credit: string;
}

const trek = (body: string, layer: string, ext: string) => (z: number, x: number, y: number) =>
  `https://trek.nasa.gov/tiles/${body}/EQ/${layer}/1.0.0/default/default028mm/${z}/${y}/${x}.${ext}`;

export const SOURCES = {
  moonWac: {
    id: 'moon-wac', px: 256, minLevel: 0, maxLevel: 8,
    url: trek('Moon', 'LRO_WAC_Mosaic_Global_303ppd_v02', 'jpg'),
    credit: 'LRO WAC global mosaic v2: NASA/GSFC/Arizona State University, via NASA Moon Trek',
  },
  moonLola: {
    id: 'moon-lola', px: 256, minLevel: 0, maxLevel: 6,
    url: trek('Moon', 'LRO_LOLA_ClrShade_Global_256ppd_v06', 'png'),
    credit: 'LRO LOLA colour-shaded relief v6: NASA/GSFC, via NASA Moon Trek',
  },
  marsViking: {
    id: 'mars-viking', px: 256, minLevel: 0, maxLevel: 7,
    url: trek('Mars', 'Mars_Viking_MDIM21_ClrMosaic_global_232m', 'jpg'),
    credit: 'Viking MDIM 2.1 colour mosaic: NASA/JPL/USGS, via NASA Mars Trek',
  },
  marsMola: {
    id: 'mars-mola', px: 256, minLevel: 0, maxLevel: 7,
    url: trek('Mars', 'Mars_MGS_MOLA_ClrShade_merge_global_463m', 'jpg'),
    credit: 'MGS MOLA colour-shaded relief: NASA/JPL/GSFC, via NASA Mars Trek',
  },
  marsCtx: {
    id: 'mars-ctx', px: 512, minLevel: 0, maxLevel: 12,
    url: (z: number, x: number, y: number) => `https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile/${z}/${y}/${x}`,
    credit: 'MRO CTX global mosaic beta01: NASA/JPL/MSSS/The Murray Lab (Caltech), served by Esri',
  },
} satisfies Record<string, TileSource>;

export interface SurfaceSpec {
  /** colour imagery (also the lighting albedo) */
  color: TileSource;
  /** optional greyscale detail layer: modulates the colour by its local contrast */
  detail?: { src: TileSource; fromLevel: number };
  /** deepest quadtree level (finest source) */
  maxLevel: number;
}

export type SurfaceMode = 'photo' | 'relief';
export type SurfaceBody = Extract<BodyId, 'moon' | 'mars'>;

export const SURFACES: Record<SurfaceBody, Record<SurfaceMode, SurfaceSpec>> = {
  moon: {
    photo: { color: SOURCES.moonWac, maxLevel: 8 },
    relief: { color: SOURCES.moonLola, maxLevel: 6 },
  },
  mars: {
    photo: { color: SOURCES.marsViking, detail: { src: SOURCES.marsCtx, fromLevel: 5 }, maxLevel: 12 },
    relief: { color: SOURCES.marsMola, maxLevel: 7 },
  },
};

export const isSurfaceBody = (id: string): id is SurfaceBody => id === 'moon' || id === 'mars';

export interface TileBounds {
  lon0: number;
  lon1: number;
  lat0: number;
  lat1: number;
}

/** tile edge in degrees at level z */
export const tileDeg = (z: number) => 180 / 2 ** z;

/** tiles across (x) and down (y) at level z */
export const tileCount = (z: number) => ({ nx: 2 ** (z + 1), ny: 2 ** z });

export function tileBounds(z: number, x: number, y: number): TileBounds {
  const s = tileDeg(z);
  const lon0 = -180 + x * s;
  const lat1 = 90 - y * s;
  return { lon0, lon1: lon0 + s, lat0: lat1 - s, lat1 };
}

/** the tile containing (lat, east lon), lon in any range */
export function tileAt(z: number, latDeg: number, lonEastDeg: number): { z: number; x: number; y: number } {
  const s = tileDeg(z);
  const { nx, ny } = tileCount(z);
  const lon = ((lonEastDeg + 180) % 360 + 360) % 360; // 0..360 from −180°
  const x = Math.min(nx - 1, Math.floor(lon / s));
  const y = Math.min(ny - 1, Math.max(0, Math.floor((90 - latDeg) / s)));
  return { z, x, y };
}

/** ancestor of (z, x, y) at level `zz` (≤ z) */
export function ancestor(z: number, x: number, y: number, zz: number): { z: number; x: number; y: number } {
  const k = z - zz;
  return { z: zz, x: x >> k, y: y >> k };
}

/**
 * Where tile (z, x, y) sits inside its ancestor at level zz, as a texture-space transform
 * uv_ancestor = off + uv_tile * scale, with uv (0, 0) at the south-west corner (v up = north).
 */
export function subRect(z: number, x: number, y: number, zz: number): { off: [number, number]; scale: number } {
  const k = z - zz;
  const n = 2 ** k;
  const a = ancestor(z, x, y, zz);
  const fx = x - a.x * n;
  const fy = y - a.y * n; // rows count down from the north edge
  return { off: [fx / n, 1 - (fy + 1) / n], scale: 1 / n };
}

/** the same transform into a global equirectangular map (u = (lon+180)/360, v = (lat+90)/180) */
export function globalRect(z: number, x: number, y: number): { off: [number, number]; scale: [number, number] } {
  const b = tileBounds(z, x, y);
  return { off: [(b.lon0 + 180) / 360, (b.lat0 + 90) / 180], scale: [(b.lon1 - b.lon0) / 360, (b.lat1 - b.lat0) / 180] };
}

export const tileKey = (src: string, z: number, x: number, y: number) => `${src}/${z}/${x}/${y}`;
