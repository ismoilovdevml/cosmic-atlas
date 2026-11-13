import { describe, expect, it } from 'vitest';
import type { CatalogEntry } from '../src/data/manifest';
import { NAMED_VIEWS, editDistance, fold, matchAliases } from '../src/search/aliases';
import { buildSuggestions } from '../src/search/suggest';
import { resolveTarget, type TourContext } from '../src/tour/tours';

const top = (q: string) => matchAliases(q, 3)[0]?.entry.id;

const CAT: CatalogEntry[] = [
  { name: 'Sun', kind: 'star', dist_pc: 0, xyz: [0, 0, 0], mag: -26.7 },
  { name: 'Sirius', alt: ['alf CMa'], kind: 'star', dist_pc: 2.64, xyz: [1, 1, 1], mag: -1.46 },
  { name: 'Gaia BH3', kind: 'black_hole', dist_pc: 590.6, xyz: [1, 2, 3], mag: 11 },
  { name: 'Cyg X-1', kind: 'black_hole', dist_pc: 2220, xyz: [3, 2, 1], mag: 8.9 },
  { name: 'Sgr A*', kind: 'bh', dist_pc: 8275, xyz: [8275, 0, 0] },
  { name: 'Crab Pulsar', alt: ['PSR B0531+21'], kind: 'pulsar', dist_pc: 2000, xyz: [1, 0, 0] },
  { name: 'Andromeda (M31)', alt: ['M31', 'MESSIER031'], kind: 'lg_galaxy', dist_pc: 765000, xyz: [-368258, 608681, -281281], mag: 3.4 },
  { name: 'Milky Way (Galactic Centre)', kind: 'lg_galaxy', dist_pc: 8275, xyz: [8275, 0, 0] },
];

describe('folding', () => {
  it('folds case, diacritics, Uzbek apostrophes and Cyrillic', () => {
    expect(fold('Somon yoʻli')).toBe('somon yoli');
    expect(fold("Somon yo'li")).toBe('somon yoli');
    expect(fold('Somon yo‘li')).toBe('somon yoli');
    expect(fold('Somon yoli')).toBe('somon yoli');
    expect(fold('Сомон йўли')).toBe('somon yoli');
    expect(fold('SOMON  YOʻLI!')).toBe('somon yoli');
    expect(fold('Чёрные дыры')).toBe(fold('черные дыры'));
    expect(fold('Sgr A*')).toBe('sgr a*');
    expect(editDistance('andromdea', 'andromeda')).toBe(1); // adjacent swap
  });
});

describe('multilingual aliases', () => {
  it('Yer / Earth / Земля → Earth', () => {
    for (const q of ['Yer', 'Earth', 'Земля', 'земля', 'EARTH', 'Ер']) expect(top(q), q).toBe('body:earth');
  });
  it('Somon yoʻli / Milky Way / Млечный путь → the Milky Way, in every spelling', () => {
    for (const q of ['Somon yoʻli', 'Somon yoli', "Somon yo'li", 'somon yo‘li', 'Сомон йўли', 'Milky Way', 'milky way', 'Млечный путь', 'Млечный Путь', 'млечный'])
      expect(top(q), q).toBe('view:milky-way');
  });
  it('named views in all three languages', () => {
    expect(top('Andromeda')).toBe('view:andromeda');
    expect(top('Андромеда')).toBe('view:andromeda');
    expect(top('Laniakea')).toBe('view:laniakea');
    expect(top('Ланиакея')).toBe('view:laniakea');
    expect(top('Mahalliy guruh')).toBe('view:local-group');
    expect(top('Местная группа')).toBe('view:local-group');
    expect(top('Magellan bulutlari')).toBe('view:magellanic-clouds');
    expect(top('Virgo cluster')).toBe('view:virgo-cluster');
    expect(top('kuzatiladigan koinot')).toBe('view:observable-universe');
    expect(top('Galactic Center')).toBe('view:galactic-centre');
    expect(top('Quyosh sistemasi')).toBe('view:solar-system');
    expect(top('DESI footprint')).toBe('view:desi-footprint');
    expect(top('cosmic web')).toBe('view:cosmic-web');
  });
  it('tolerates prefixes and small typos', () => {
    expect(top('Andromdea')).toBe('view:andromeda');
    expect(top('Andro')).toBe('view:andromeda');
    expect(top('Jupyter')).toBe('body:jupiter');
    expect(top('Saturm')).toBe('body:saturn');
    expect(top('Milky Wya')).toBe('view:milky-way');
    expect(top('Laniakia')).toBe('view:laniakea');
    expect(matchAliases('xq')).toEqual([]);
  });
  it('kind words in uz / en / ru', () => {
    for (const q of ['qora tuynuk', 'black holes', 'чёрные дыры', 'черные дыры']) expect(top(q), q).toBe('kind:black_hole');
    expect(top('sayyoralar')).toBe('kind:planet');
    expect(top('pulsar')).toBe('kind:pulsar');
    expect(top('пульсары')).toBe('kind:pulsar');
  });
  it('every named view resolves to a finite camera target', () => {
    const ctx: TourContext = { catalog: () => null, galacticCentre: [8275, 0, 0], galaxyEdgePc: () => 2e9, lookbackText: () => '' };
    for (const [id, v] of Object.entries(NAMED_VIEWS)) {
      const p = resolveTarget(v.target, ctx);
      expect(p.every(Number.isFinite), id).toBe(true);
      const d = typeof v.dist === 'number' ? v.dist : v.dist.galaxyEdge * 2e9;
      expect(d, id).toBeGreaterThan(0);
    }
    // the Laniakea view must take in its ~160 Mpc extent (Tully et al. 2014)
    expect(NAMED_VIEWS.laniakea.dist).toBeGreaterThanOrEqual(1.6e8);
  });
});

describe('search dropdown', () => {
  it('ranks the alias first and keeps the Sesame fallback last', () => {
    const s = buildSuggestions('Milky Way', CAT);
    expect(s[0]).toMatchObject({ type: 'alias', entry: { id: 'view:milky-way' } });
    expect(s.at(-1)).toEqual({ type: 'sesame', q: 'Milky Way' });
  });
  it('a kind word offers the article and lists the matching objects', () => {
    for (const q of ['qora tuynuk', 'black holes', 'чёрные дыры']) {
      const s = buildSuggestions(q, CAT);
      expect(s[0], q).toMatchObject({ type: 'kind', count: 3 });
      const names = s.filter((x) => x.type === 'catalog').map((x) => (x.type === 'catalog' ? x.entry.name : ''));
      expect(names, q).toEqual(['Cyg X-1', 'Gaia BH3', 'Sgr A*']);
    }
  });
  it('planets list the Solar System planets', () => {
    const s = buildSuggestions('sayyoralar', CAT);
    expect(s[0]).toMatchObject({ type: 'kind', entry: { id: 'kind:planet' } });
    const bodies = s.filter((x) => x.type === 'alias').map((x) => (x.type === 'alias' ? x.entry.id : ''));
    expect(bodies.slice(0, 3)).toEqual(['body:mercury', 'body:venus', 'body:earth']);
  });
  it('a view that names a catalogue object yields to that object', () => {
    const s = buildSuggestions('M31', CAT);
    expect(s[0]).toMatchObject({ type: 'catalog', entry: { name: 'Andromeda (M31)' } });
    expect(s.some((x) => x.type === 'alias' && x.entry.id === 'view:andromeda')).toBe(false);
  });
  it('plain catalogue search still works', () => {
    expect(buildSuggestions('sirius', CAT)[0]).toMatchObject({ type: 'catalog', entry: { name: 'Sirius' } });
  });
});
