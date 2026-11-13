import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DICTS, LANGS, format, resolveLang, setLang, t } from '../src/i18n';
import { formatDistance, formatLy, describeLookback, niceScaleBar } from '../src/math/units';
import { factRows, formatFact, unitFor } from '../src/objects/facts';
import { KINDS, SUBKINDS } from '../src/objects/kinds';
import { ALIASES } from '../src/search/aliases';
import { SCALE_TOUR } from '../src/tour/tours';

const keys = (l: (typeof LANGS)[number]) => Object.keys(DICTS[l]).sort();

afterEach(() => setLang('uz', { persist: false }));

describe('i18n dictionaries', () => {
  it('uz, en and ru have exactly the same key set', () => {
    expect(keys('uz')).toEqual(keys('en'));
    expect(keys('ru')).toEqual(keys('en'));
  });

  it('no value is empty and every {placeholder} of en exists in the translations', () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)(?=[,}])/g)].map((m) => m[1]).sort();
    for (const k of keys('en')) {
      for (const l of LANGS) expect(DICTS[l][k].trim(), `${l} ${k}`).not.toBe('');
      const want = [...new Set(vars(DICTS.en[k]))];
      for (const l of LANGS) expect([...new Set(vars(DICTS[l][k]))], `${l} ${k}`).toEqual(want);
    }
  });

  it('has a label for every kind, sub-kind and search alias, and every contract fact label', () => {
    const need = [
      ...Object.values(KINDS).map((k) => k.label), ...Object.values(SUBKINDS).map((k) => k.label), 'kind.unknown',
      ...ALIASES.map((a) => a.label),
      ...['mass_msun', 'mass_mjup', 'radius_rearth', 'period_days', 'period_ms', 'temp_k', 'dist', 'discovered', 'type'].map((f) => `facts.${f}`),
      SCALE_TOUR.label, ...SCALE_TOUR.beats.flatMap((b) => [b.title, b.text]),
    ];
    for (const k of need) expect(DICTS.en, k).toHaveProperty([k]);
  });

  it('has a translated title for every layer in layers.json', () => {
    const m = JSON.parse(readFileSync(resolve(__dirname, '../public/layers.json'), 'utf8')) as { layers: { id: string }[] };
    for (const L of m.layers) expect(DICTS.uz, L.id).toHaveProperty([`layer.${L.id}`]);
  });

  it('writes Uzbek with oʻ / gʻ (U+02BB) and ʼ (U+02BC), never ASCII or curly apostrophes', () => {
    for (const [k, v] of Object.entries(DICTS.uz)) {
      expect(v, k).not.toMatch(/[og]['‘’`]/i);
      expect(v, k).not.toMatch(/[a-z]'[a-z]/i);
    }
    expect(DICTS.uz['view.milky-way']).toBe('Somon yoʻli');
  });

  it('every literal t(\'…\') / tr(\'…\') key used in src/ exists', () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d, { withFileTypes: true })) {
        if (f.isDirectory()) walk(resolve(d, f.name));
        else if (f.name.endsWith('.ts')) files.push(resolve(d, f.name));
      }
    };
    walk(resolve(__dirname, '../src'));
    const used = new Set<string>();
    for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/\b(?:t|tr|solarTr)\(\s*'([a-z][\w.-]*)'/g)) used.add(m[1]);
    expect(used.size).toBeGreaterThan(100);
    const missing = [...used].filter((k) => !(k in DICTS.en));
    expect(missing).toEqual([]);
  });

  it('every index.html data-i18n key exists', () => {
    const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
    const used = [
      ...[...html.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]),
      ...[...html.matchAll(/data-i18n-attr="([^"]+)"/g)].flatMap((m) => m[1].split(';').map((p) => p.split(':')[1].trim())),
    ];
    expect(used.length).toBeGreaterThan(30);
    for (const k of used) expect(DICTS.en, k).toHaveProperty([k]);
  });
});

describe('language resolution (contract §1)', () => {
  it('?lang= > saved > browser > uz', () => {
    expect(resolveLang({ search: '?lang=ru', saved: 'en', browser: ['uz-UZ'] })).toBe('ru');
    expect(resolveLang({ search: '?lang=xx', saved: 'en', browser: ['ru'] })).toBe('en');
    expect(resolveLang({ saved: null, browser: ['ru-RU', 'en'] })).toBe('ru');
    expect(resolveLang({ browser: ['uz-Latn-UZ'] })).toBe('uz');
    expect(resolveLang({ browser: ['de-DE'] })).toBe('en');
    expect(resolveLang({})).toBe('uz');
  });
});

describe('messages, plurals and numbers', () => {
  it('fills placeholders and picks plural forms per language', () => {
    expect(t('status.goto', { name: 'Sirius', d: '2.64 pc' }, 'en')).toBe('Sirius: 2.64 pc from the Sun.');
    const ly = (n: number, l: 'ru' | 'en' | 'uz') => t('unit.ly', { n }, l);
    expect(ly(1, 'ru')).toBe('1 св. год');
    expect(ly(3, 'ru')).toBe('3 св. года');
    expect(ly(5, 'ru')).toBe('5 св. лет');
    expect(ly(4.2, 'ru')).toBe('4,2 св. года');
    expect(ly(4.2, 'uz')).toBe('4,2 yorugʻlik yili');
    expect(ly(1, 'en')).toBe('1 ly');
    expect(format('{n, plural, =0 {none} one {# item} other {# items}}', { n: 0 }, 'en')).toBe('none');
    expect(format('{n, plural, one {# item} other {# items}}', { n: 2, nText: 'two' }, 'en')).toBe('two items');
  });

  it('formats distances with the language’s units and decimal mark', () => {
    setLang('en', { persist: false });
    expect(formatDistance(2.64)).toBe('2.64 pc');
    expect(formatDistance(765000)).toBe('765 kpc');
    setLang('ru', { persist: false });
    expect(formatDistance(2.64)).toBe('2,64 пк');
    expect(formatDistance(16.4e6)).toBe('16,4 Мпк');
    expect(formatLy(1.3)).toBe('4,24 св. года');
    setLang('uz', { persist: false });
    expect(formatDistance(2.64)).toBe('2,64 pk');
    expect(formatDistance(1e-5)).toBe('2,06 a.b.');
    expect(niceScaleBar(1, 170).label).toBe('100 pk');
    expect(describeLookback(1e9).ago).toMatch(/^2,9\d milliard yil oldin$/);
  });

  it('renders catalogue facts with translated labels, units and decimal marks', () => {
    const loc = (l: (typeof LANGS)[number]) => ({ t: (k: string) => t(k, undefined, l), decimal: l === 'en' ? '.' : ',' });
    expect(factRows({ mass_msun: [32.7, 0.82], discovered: 2024 }, loc('en').t, loc('en'))).toEqual([
      ['Mass', '32.70 ± 0.82 M☉'], ['Discovered', '2024'],
    ]);
    expect(factRows({ orbital_period_days: 11.2, dm_pc_cm3: 56.77 }, loc('ru').t, loc('ru'))).toEqual([
      ['Орбитальный период', '11,2 сут'], ['Мера дисперсии', '56,77 пк см⁻³'],
    ]);
    expect(formatFact('target_dist_ly', 25100, loc('uz'))).toBe('25100 yorugʻlik yili');
    expect(formatFact('mass_msun', '≥4.4', loc('uz'))).toBe('≥4,4 M☉');
    expect(formatFact('type', 'stellar, dormant', loc('ru'))).toBe('stellar, dormant');
  });

  it('every fact key in the shipped catalogues has a label in uz, en and ru, and every unit suffix a symbol', () => {
    const dir = resolve(__dirname, '../../data/tiles/catalogs');
    const used = new Set<string>();
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const d = JSON.parse(readFileSync(resolve(dir, f), 'utf8'));
      for (const e of Array.isArray(d) ? d : d.entries ?? []) for (const k of Object.keys(e.facts ?? {})) used.add(k);
    }
    expect(used.size).toBeGreaterThan(30);
    for (const k of used) for (const l of LANGS) expect(DICTS[l], `${l} facts.${k}`).toHaveProperty([`facts.${k}`]);
    const uz = { t: (x: string) => t(x, undefined, 'uz'), decimal: ',' };
    for (const k of used) if (unitFor(k)) expect(DICTS.uz, k).toHaveProperty([`facts.unit.${Object.keys(DICTS.uz).find((x) => x.startsWith('facts.unit.') && unitFor(k, uz) === DICTS.uz[x])?.slice(11)}`]);
  });
});
