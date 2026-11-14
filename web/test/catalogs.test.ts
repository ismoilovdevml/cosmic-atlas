/**
 * Contract checks for the object catalogues in data/tiles/catalogs (content contract section 3):
 * registered kinds, xyz consistent with (ra, dec, dist_pc), fact value shapes, size < 2 MB,
 * and the spot values the catalogues are validated against.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { KINDS } from '../src/objects/kinds';
import { radecDistToGal } from '../src/math/frames';
import type { CatalogEntry } from '../src/data/manifest';

const dir = resolve(import.meta.dirname, '../../data/tiles/catalogs');
const NEW = ['black-holes', 'exoplanets', 'pulsars', 'nebulae-snr', 'seti', 'clusters'];
const load = (n: string) => JSON.parse(readFileSync(resolve(dir, `${n}.json`), 'utf8')) as CatalogEntry[];
const byName = (es: CatalogEntry[], n: string) => es.find((e) => e.name === n)!;

describe.each(NEW)('%s.json', (name) => {
  const path = resolve(dir, `${name}.json`);
  it('exists, < 2 MB, has a provenance block', () => {
    expect(existsSync(path)).toBe(true);
    expect(statSync(path).size).toBeLessThan(2_000_000);
    expect(existsSync(resolve(dir, 'provenance', `${name}.json`))).toBe(true);
  });
  it('entries follow the contract', () => {
    const es = load(name);
    expect(es.length).toBeGreaterThan(0);
    for (const e of es) {
      expect(typeof e.name).toBe('string');
      expect(KINDS[e.kind], `${e.name}: kind ${e.kind}`).toBeDefined();
      expect(Number.isFinite(e.ra) && Number.isFinite(e.dec)).toBe(true);
      if (e.xyz) {
        const g = radecDistToGal(e.ra!, e.dec!, e.dist_pc);
        const err = Math.hypot(g[0] - e.xyz[0], g[1] - e.xyz[1], g[2] - e.xyz[2]);
        expect(err, e.name).toBeLessThan(1e-3 * e.dist_pc + 1e-3);
      }
      for (const [k, v] of Object.entries(e.facts ?? {})) {
        const ok = typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean' ||
          (Array.isArray(v) && v.length >= 2 && v.length <= 3 && v.every((x) => x === null || Number.isFinite(x)));
        expect(ok, `${e.name}.facts.${k}`).toBe(true);
      }
    }
  });
});

describe('spot checks against the cited sources', () => {
  it('Sgr A*: GRAVITY 2022 mass 4.297e6 Msun, R0 8277 pc', () => {
    const e = byName(load('black-holes'), 'Sgr A*');
    expect(e.facts!.mass_msun).toEqual([4.297e6, 0.012e6]);
    expect(e.dist_pc).toBe(8277);
    expect(e.docs).toBe('sgr-a-star');
  });
  it('Gaia BH3: 32.70 +- 0.82 Msun at 590.6 pc; Cyg X-1 21.2 Msun at 2.22 kpc', () => {
    const bh = load('black-holes');
    expect(byName(bh, 'Gaia BH3').facts!.mass_msun).toEqual([32.7, 0.82]);
    expect(byName(bh, 'Gaia BH3').dist_pc).toBe(590.6);
    expect(byName(bh, 'Cyg X-1').facts!.mass_msun).toEqual([21.2, 2.2]);
    expect(byName(bh, 'Cyg X-1').dist_pc).toBe(2220);
  });
  it('Proxima b period 11.18465 d; TRAPPIST-1 at 12.43 pc', () => {
    const ex = load('exoplanets');
    const prox = byName(ex, 'Proxima Cen');
    expect(prox.docs).toBe('proxima-b');
    expect(prox.planets!.find((p) => p.pl_name === 'Proxima Cen b')!.pl_orbper).toEqual([11.18465, 0.00053]);
    const t1 = byName(ex, 'TRAPPIST-1');
    expect(t1.dist_pc).toBeCloseTo(12.43, 2);
    expect(t1.planets).toHaveLength(7);
  });
  it('Crab pulsar: P0 33.392 ms at 2.0 kpc (ATNF DIST)', () => {
    const e = byName(load('pulsars'), 'PSR J0534+2200');
    expect((e.facts!.period_s as number[])[0]).toBeCloseTo(0.0333924123, 9);
    expect(e.dist_pc).toBe(2000);
    expect(e.alt).toContain('Crab Pulsar');
  });
  it('Crab Nebula: docs crab-nebula, M1 alias, 1.90 kpc', () => {
    const e = byName(load('nebulae-snr'), 'Crab Nebula');
    expect(e.docs).toBe('crab-nebula');
    expect(e.alt).toContain('M1');
    expect(e.dist_pc).toBe(1900);
  });
  it('Arecibo message: light front = years since 1974-11-16 at the as_of date', () => {
    const s = load('seti');
    const e = byName(s, 'Arecibo message');
    const asOf = Date.parse(e.facts!.as_of as string);
    const years = (asOf - Date.parse('1974-11-16')) / (365.25 * 86400e3);
    expect(e.facts!.light_front_ly as number).toBeCloseTo(years, 1);
    expect(e.dist_pc * 3.261563777).toBeCloseTo(years, 1);
    expect(e.docs).toBe('arecibo-message');
    // no catalogue entry may claim a confirmed extraterrestrial signal
    for (const w of s.filter((x) => x.kind === 'seti_signal')) {
      expect(JSON.stringify(w.facts)).toContain('No confirmed extraterrestrial signal');
    }
  });
});
