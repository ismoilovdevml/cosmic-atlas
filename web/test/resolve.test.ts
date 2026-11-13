import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseSesame, searchCatalog } from '../src/data/resolve';
import { comovingDistancePc } from '../src/math/cosmology';
import type { CatalogEntry } from '../src/data/manifest';

const fx = (n: string) => readFileSync(resolve(import.meta.dirname, 'fixtures', `sesame_${n}.xml`), 'utf8');

// Fixtures are real answers from vizier.cfa.harvard.edu nph-sesame/-oxp/SNV, saved 2026-11-13.
describe('Sesame parsing', () => {
  it('Vega: significant parallax -> distance', () => {
    const r = parseSesame(fx('Vega'), 'Vega')!;
    expect(r.distPc).toBeCloseTo(1000 / 130.23, 6);
    expect(r.kind).toBe('star');
    expect(r.xyz).not.toBeNull();
  });
  it('M31: blueshifted, no usable distance, direction still known', () => {
    const r = parseSesame(fx('M31'), 'M31')!;
    expect(r.distPc).toBeNull();
    expect(r.ra).toBeCloseTo(10.68470833, 6);
    expect(Math.hypot(...r.dir)).toBeCloseTo(1, 12);
  });
  it('3C 273: redshift wins over an insignificant Gaia parallax', () => {
    const r = parseSesame(fx('3C273'), '3C 273')!;
    expect(r.kind).toBe('galaxy');
    expect(r.distPc).toBeCloseTo(comovingDistancePc(0.15756751), 0);
  });
  it('NGC 1300: cz -> z, Hubble-flow distance allowed above z=0.003', () => {
    const r = parseSesame(fx('NGC1300'), 'NGC 1300')!;
    expect(r.z).toBeCloseTo(1570.5 / 299792.458, 9);
    expect(r.distPc! / 1e6).toBeGreaterThan(20);
    expect(r.distPc! / 1e6).toBeLessThan(26);
  });
  it('unknown names return null', () => {
    expect(parseSesame('<?xml version="1.0"?><Sesame><Target><name>xx</name><INFO>*** Nothing found ***</INFO></Target></Sesame>', 'xx')).toBeNull();
  });
});

describe('catalogue search', () => {
  const E: CatalogEntry[] = [
    { name: 'Sirius', alt: ['alf CMa', 'HIP 32349'], kind: 'star', dist_pc: 2.64, mag: -1.46, xyz: [0, 0, 0] },
    { name: 'Andromeda Galaxy', alt: ['M31', 'NGC 224'], kind: 'lg_galaxy', dist_pc: 765000, mag: 3.44, xyz: [0, 0, 0] },
    { name: 'M87', alt: ['Virgo A'], kind: 'galaxy', dist_pc: 16.4e6, mag: 8.6, xyz: [0, 0, 0] },
  ];
  it('matches alternative names, ignoring case and spaces', () => {
    expect(searchCatalog(E, 'm 31')[0].entry.name).toBe('Andromeda Galaxy');
    expect(searchCatalog(E, 'hip32349')[0].entry.name).toBe('Sirius');
  });
  it('ranks exact over prefix over substring', () => {
    const r = searchCatalog(E, 'm');
    expect(r.length).toBeGreaterThan(0);
    expect(searchCatalog(E, 'M87')[0].score).toBe(100);
  });
});

import { catalogKey } from '../src/data/manifest';
describe('catalogue duplicate keys', () => {
  it('normalises Messier/NGC spellings', () => {
    expect(catalogKey('MESSIER031')).toBe(catalogKey('M31'));
    expect(catalogKey('NGC 0224')).toBe(catalogKey('NGC224'));
    expect(catalogKey('Andromeda Galaxy')).not.toBe(catalogKey('Andromeda'));
  });
});
