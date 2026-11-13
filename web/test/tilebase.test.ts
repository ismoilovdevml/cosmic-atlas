import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TILE_BASE, applyTileBase, fetchJson, rebaseTilePath, resolveTileBase } from '../src/data/tilebase';
import type { Manifest } from '../src/data/manifest';

const PAGE = 'https://user.example.org/cosmic-atlas/index.html';

describe('tile base', () => {
  it('precedence: ?tiles= > VITE_TILE_BASE > layers.json tilesBase > tiles/', () => {
    expect(resolveTileBase('', undefined, undefined, PAGE)).toBe(DEFAULT_TILE_BASE);
    expect(resolveTileBase('', '', '', PAGE)).toBe('tiles/');
    expect(resolveTileBase('', undefined, 'https://m.example/t', PAGE)).toBe('https://m.example/t/');
    expect(resolveTileBase('', 'https://r2.example/tiles', 'https://m.example/t', PAGE)).toBe('https://r2.example/tiles/');
    expect(resolveTileBase('?tiles=http://localhost:8001/lite/', 'https://r2.example/tiles', undefined, PAGE)).toBe('http://localhost:8001/lite/');
    expect(resolveTileBase('?backend=webgl&tiles=lite', undefined, undefined, PAGE)).toBe('lite/');
  });

  it('ignores unusable bases (not http/https) and falls through', () => {
    expect(resolveTileBase('?tiles=javascript:alert(1)', undefined, undefined, PAGE)).toBe('tiles/');
    expect(resolveTileBase('?tiles=data:text/plain,x', 'https://r2.example/t/', undefined, PAGE)).toBe('https://r2.example/t/');
    expect(resolveTileBase('?tiles=', undefined, undefined, PAGE)).toBe('tiles/');
  });

  it('re-roots tiles/ paths and leaves everything else alone', () => {
    const hf = 'https://huggingface.co/datasets/u/atlas-tiles/resolve/main/';
    expect(rebaseTilePath('tiles/galaxies-desi', hf)).toBe(`${hf}galaxies-desi`);
    expect(rebaseTilePath('./tiles/catalogs/named-stars.json', hf)).toBe(`${hf}catalogs/named-stars.json`);
    expect(rebaseTilePath('tiles/x', 'tiles/')).toBe('tiles/x');
    expect(rebaseTilePath('sky/gaia_dr3_sky_l9.jpg', hf)).toBe('sky/gaia_dr3_sky_l9.jpg');
    expect(rebaseTilePath('https://other.example/tiles/x', hf)).toBe('https://other.example/tiles/x');
  });

  it('applies to every point layer and catalogue in the manifest, not to model layers', () => {
    const m: Manifest = {
      version: 1,
      catalogs: ['tiles/catalogs/a.json'],
      layers: [
        { id: 'g', title: 'G', path: 'tiles/g', visible: true, colorMode: 'galaxy' },
        { id: 'sky', type: 'sky', title: 'Sky', visible: true, image: 'sky/s.jpg' },
      ],
    };
    const out = applyTileBase(m, 'https://cdn.example/t');
    expect(out.catalogs).toEqual(['https://cdn.example/t/catalogs/a.json']);
    expect((out.layers[0] as { path: string }).path).toBe('https://cdn.example/t/g');
    expect(out.layers[1]).toEqual(m.layers[1]);
    expect(m.catalogs[0]).toBe('tiles/catalogs/a.json'); // input untouched
  });
});

describe('fetchJson', () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = (status: number, type: string, body: string) => {
    const f = vi.fn(async (_u: string, _init?: RequestInit) => new Response(body, { status, headers: { 'content-type': type } }));
    vi.stubGlobal('fetch', f);
    return f;
  };

  it('parses JSON served as text/plain (Hugging Face resolve URLs do this)', async () => {
    const f = stub(200, 'text/plain; charset=utf-8', '{"layers":["a"],"catalogs":[]}');
    expect(await fetchJson('x')).toEqual({ status: 'ok', data: { layers: ['a'], catalogs: [] } });
    // plain CORS GET: no credentials, no custom headers
    expect(f.mock.calls[0][1]).toEqual({ credentials: 'omit' });
  });

  it('404 and SPA HTML fallbacks are "missing"; other failures are errors', async () => {
    stub(404, 'text/plain', 'Entry not found');
    expect((await fetchJson('x')).status).toBe('missing');
    stub(200, 'text/html', '<!doctype html>');
    expect((await fetchJson('x')).status).toBe('missing');
    stub(403, 'application/xml', '<Error/>');
    expect(await fetchJson('x')).toEqual({ status: 'error', message: 'HTTP 403' });
    stub(200, 'application/json', '{bad');
    expect((await fetchJson('x')).status).toBe('error');
  });
});
