import { afterEach, describe, expect, it, vi } from 'vitest';
import { factLabel, factRows, fmtSig, formatFact, planetRows, unitFor } from '../src/objects/facts';
import { kindColor, kindInfo } from '../src/objects/kinds';
import { loadCatalogs, type CatalogEntry } from '../src/data/manifest';
import { searchCatalog } from '../src/data/resolve';
import { scaleWindow } from '../src/render/labels';

describe('fact formatting', () => {
  it('unit from the key suffix, longest suffix wins', () => {
    expect(unitFor('mass_msun')).toBe('M☉');
    expect(unitFor('period_s')).toBe('s');
    expect(unitFor('dm_pc_cm3')).toBe('pc cm⁻³');
    expect(unitFor('orbital_period_days')).toBe('d');
    expect(unitFor('type')).toBe('');
  });
  it('[value, error] keeps the precision of the error', () => {
    expect(formatFact('mass_msun', [32.7, 0.82])).toBe('32.70 ± 0.82 M☉');
    expect(formatFact('period_s', [0.0333924123, 1.2e-9])).toBe('0.0333924123 ± 0.0000000012 s');
    expect(formatFact('mass_msun', [4.297e6, 1.2e4])).toBe('(4.297 ± 0.012)×10⁶ M☉');
  });
  it('asymmetric errors: contract order [v, -err, +err] and archive order [v, +err1, err2<0]', () => {
    expect(formatFact('mass_msun', [9.0, 0.6, 0.2])).toBe('9.00 +0.20 −0.60 M☉');
    expect(formatFact('x_rearth', [1.116, 0.014, -0.012])).toBe('1.116 +0.014 −0.012 R⊕');
  });
  it('text, limits and plain numbers', () => {
    expect(formatFact('mass_msun', '≥4.4')).toBe('≥4.4 M☉');
    expect(formatFact('type', 'stellar, dormant')).toBe('stellar, dormant');
    expect(formatFact('discovered', 2024)).toBe('2024');
    expect(formatFact('reached_target', false)).toBe('✗');
    expect(fmtSig(51.9912, 4)).toBe('51.99');
  });
  it('labels: i18n facts.<key>, else the key itself', () => {
    const t = (k: string) => ({ 'facts.mass_msun': 'Mass' })[k] ?? k;
    expect(factLabel('mass_msun', t)).toBe('Mass');
    expect(factLabel('light_front_ly', t)).toBe('light_front_ly');
    expect(factLabel('type')).toBe('type');
    expect(factRows({ mass_msun: [21.2, 2.2], type: 'stellar' }, t)).toEqual([
      ['Mass', '21.2 ± 2.2 M☉'],
      ['type', 'stellar'],
    ]);
  });
  it('planet rows', () => {
    const rows = planetRows([
      { pl_name: 'Proxima Cen b', discoverymethod: 'Radial Velocity', disc_year: 2016, pl_orbper: [11.18465, 0.00053],
        pl_rade: 1.02, pl_bmassj: [0.00332, 0.00017], pl_bmassprov: 'Msini', pl_eqt: 218 },
    ]);
    expect(rows[0][0]).toBe('Proxima Cen b');
    expect(rows[0][1]).toBe('P = 11.18465 ± 0.00053 d · 1.02 R⊕ · ≥ 0.00332 ± 0.00017 M_J · 218 K · Radial Velocity 2016');
  });
});

describe('kinds', () => {
  it('colours and label windows for the new catalogue kinds', () => {
    expect(kindColor('black_hole')).toBe('#c9a8ff');
    expect(kindColor('planetary_nebula')).toBe(kindColor('nebula'));
    expect(kindInfo('nonsense').label).toBe('kind.unknown');
    expect(scaleWindow('exoplanet')).toEqual([0, 3000]);
    expect(scaleWindow('star')).toEqual([0, 3000]);
    expect(scaleWindow('galaxy')).toEqual([2e4, 2e8]);
  });
});

describe('catalogue loader', () => {
  afterEach(() => vi.unstubAllGlobals());
  const files: Record<string, unknown[]> = {
    'stars.json': [{ name: 'Proxima Centauri', alt: ['Proxima Cen', 'alf Cen C'], kind: 'star', ra: 217.4, dec: -62.7, dist_pc: 1.3, xyz: [0.9, -0.94, -0.04] }],
    'exo.json': [{ name: 'Proxima Cen', kind: 'exoplanet', ra: 217.4, dec: -62.7, dist_pc: 1.3, xyz: [0.9, -0.94, -0.04],
      planets: [{ pl_name: 'Proxima Cen b' }, { pl_name: 'Proxima Cen d' }] }],
    'neb.json': [{ name: 'Crab Nebula', alt: ['M1', 'NGC 1952'], kind: 'snr', ra: 83.6, dec: 22.0, dist_pc: 1900, xyz: [-1884, -150, -191] }],
    'messier.json': [{ name: 'M1', alt: ['NGC 1952', 'Crab Nebula'], kind: 'supernova_remnant', ra: 83.6, dec: 22.0, dist_pc: 2000, xyz: [-1983, -158, -201] }],
  };
  const stub = () =>
    vi.stubGlobal('fetch', async (url: string) => {
      const d = files[url];
      return new Response(d ? JSON.stringify(d) : 'nope', { status: d ? 200 : 404, headers: { 'content-type': 'application/json' } });
    });

  it('a planet system is kept next to the star of the same name; planet names become aliases', async () => {
    stub();
    const { entries } = await loadCatalogs(['stars.json', 'exo.json']);
    expect(entries.map((e) => e.kind)).toEqual(['star', 'exoplanet']);
    const exo = entries.find((e) => e.kind === 'exoplanet') as CatalogEntry;
    expect(exo.alt).toEqual(['Proxima Cen b', 'Proxima Cen d']);
    const hit = searchCatalog(entries, 'Proxima Cen b');
    expect(hit[0].entry.kind).toBe('exoplanet');
    expect(hit[0].matched).toBe('Proxima Cen b');
  });
  it('nebulae/SNRs listed first win over the Messier entry of the same object', async () => {
    stub();
    const { entries } = await loadCatalogs(['neb.json', 'messier.json']);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('Crab Nebula');
    expect(entries[0].dist_pc).toBe(1900);
  });
});
