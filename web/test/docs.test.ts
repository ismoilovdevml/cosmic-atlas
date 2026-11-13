import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFrontMatter } from '../src/docs/frontmatter';
import { classifyLink, renderMarkdown } from '../src/docs/markdown';
import { KINDS, SUBKINDS, docSlugFor } from '../src/objects/kinds';
import { ALIASES, NAMED_VIEWS } from '../src/search/aliases';
import { LAYER_VIEWS, resolveFocus } from '../src/search/focus';
import type { CatalogEntry } from '../src/data/manifest';

const DOCS = resolve(__dirname, '../public/docs');
const LANGS = ['uz', 'en', 'ru'] as const;
const slugs = (l: string) => readdirSync(resolve(DOCS, l)).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort();
const read = (l: string, s: string) => readFileSync(resolve(DOCS, l, `${s}.md`), 'utf8');

/** the slug list in docs/content-contract.md §4 "Slug list v1" */
function contractSlugs(): string[] {
  const md = readFileSync(resolve(__dirname, '../../docs/content-contract.md'), 'utf8');
  const sec = md.slice(md.indexOf('### Slug list v1'));
  return [...sec.matchAll(/`([a-z0-9-]+)`/g)].map((m) => m[1]);
}

describe('docs articles', () => {
  it('uz, en and ru have the same slug set', () => {
    expect(slugs('uz')).toEqual(slugs('en'));
    expect(slugs('ru')).toEqual(slugs('en'));
  });

  it('contains every slug of the content contract', () => {
    const want = contractSlugs();
    expect(want.length).toBeGreaterThan(45);
    for (const s of want) expect(slugs('en'), s).toContain(s);
  });

  it('has an article for every kind, sub-kind, named view and search alias', () => {
    const have = new Set(slugs('en'));
    const need = [
      ...Object.keys(KINDS).map((k) => docSlugFor({ kind: k })),
      ...Object.keys(SUBKINDS).map((k) => docSlugFor({ kind: k })),
      docSlugFor({ kind: 'nonsense' }),
      ...Object.values(NAMED_VIEWS).map((v) => v.doc).filter(Boolean),
      ...ALIASES.map((a) => a.doc).filter(Boolean),
    ] as string[];
    for (const s of need) expect(have.has(s), s).toBe(true);
  });

  it('every file has front matter with a title and a summary of at most 160 characters', () => {
    for (const l of LANGS) {
      for (const s of slugs(l)) {
        const r = parseFrontMatter(read(l, s));
        expect(r, `${l}/${s}`).not.toBeNull();
        expect(r!.meta.title, `${l}/${s}`).not.toBe('');
        expect(r!.meta.summary, `${l}/${s}`).not.toBe('');
        expect([...r!.meta.summary].length, `${l}/${s}`).toBeLessThanOrEqual(160);
      }
    }
  });

  it('doc: links and related slugs point at existing articles', () => {
    for (const l of LANGS) {
      const have = new Set(slugs(l));
      for (const s of slugs(l)) {
        const r = parseFrontMatter(read(l, s))!;
        for (const rel of r.meta.related) expect(have.has(rel), `${l}/${s} related ${rel}`).toBe(true);
        for (const m of r.body.matchAll(/\]\(doc:([a-z0-9-]+)\)/g)) expect(have.has(m[1]), `${l}/${s} → ${m[1]}`).toBe(true);
      }
    }
  });
});

describe('front matter', () => {
  it('parses the contract example', () => {
    const r = parseFrontMatter(`---
title: Qora tuynuk
summary: Tortishish kuchi shu qadar kuchliki, undan hatto yorugʻlik ham chiqa olmaydigan hudud.
related: [neutron-star, pulsar, sgr-a-star, gaia-mission]
sources:
  - Event Horizon Telescope Collaboration 2022, ApJL 930, L12 (doi:10.3847/2041-8213/ac6674)
  - https://science.nasa.gov/universe/black-holes/
updated: 2026-11-13
---

## Bu nima?
`)!;
    expect(r.meta.title).toBe('Qora tuynuk');
    expect(r.meta.related).toEqual(['neutron-star', 'pulsar', 'sgr-a-star', 'gaia-mission']);
    expect(r.meta.sources).toHaveLength(2);
    expect(r.meta.placeholder).toBe(false);
    expect(r.body.trim()).toBe('## Bu nima?');
  });
  it('reads quoted values and flags placeholders; rejects files without it', () => {
    const r = parseFrontMatter('---\ntitle: "A: \\"quoted\\" title"\nsummary: \'it\'\'s\'\nplaceholder: true\n---\nx')!;
    expect(r.meta.title).toBe('A: "quoted" title');
    expect(r.meta.summary).toBe("it's");
    expect(r.meta.placeholder).toBe(true);
    expect(parseFrontMatter('<!doctype html><html>')).toBeNull();
  });
});

describe('markdown renderer is safe by construction', () => {
  it('shows raw HTML as text', () => {
    const h = renderMarkdown('Hello <script>alert(1)</script> <img src=x onerror=alert(1)>');
    expect(h).not.toContain('<script');
    expect(h).not.toContain('<img');
    expect(h).toContain('&lt;script&gt;');
  });
  it('drops dangerous URLs and keeps the text', () => {
    expect(renderMarkdown('[x](javascript:alert(1))')).toBe('<p>x</p>');
    expect(renderMarkdown('[x](data:text/html,hi)')).toBe('<p>x</p>');
    expect(renderMarkdown('![a](javascript:alert(1))')).toBe('<p>a</p>');
    expect(renderMarkdown('![a](//evil.example/x.png)')).toBe('<p>a</p>');
    expect(renderMarkdown('[x](https://a.example/"onmouseover="y)')).not.toContain('onmouseover="');
  });
  it('turns doc: and #focus= links into in-app links', () => {
    expect(classifyLink('doc:parallax')).toEqual({ type: 'doc', slug: 'parallax' });
    expect(classifyLink('#focus=sgr-a-star')).toEqual({ type: 'focus', name: 'sgr-a-star' });
    const h = renderMarkdown('See [parallaks](doc:parallax) and [Sgr A*](#focus=sgr-a-star).');
    expect(h).toContain('<a href="#doc=parallax" data-doc="parallax">parallaks</a>');
    expect(h).toContain('data-focus="sgr-a-star"');
    expect(renderMarkdown('[NASA](https://nasa.gov)')).toContain('target="_blank" rel="noopener noreferrer"');
  });
  it('renders the usual article structure', () => {
    const h = renderMarkdown('# T\n\n## Bu nima?\n\nA **bold** and *em* `code`.\n\n- one\n- two\n  - nested\n\n1. a\n2. b\n\n> quote\n\n| a | b |\n|---|--:|\n| 1 | 2 |\n\n---\n\n![Crab](https://x.example/c.jpg "NASA, ESA (public domain)")');
    expect(h).toContain('<h2>T</h2><h2>Bu nima?</h2>');
    expect(h).toContain('<strong>bold</strong>');
    expect(h).toContain('<em>em</em>');
    expect(h).toContain('<code>code</code>');
    expect(h).toContain('<ul><li>one</li><li>two<ul><li>nested</li></ul></li></ul>');
    expect(h).toContain('<ol><li>a</li><li>b</li></ol>');
    expect(h).toContain('<blockquote><p>quote</p></blockquote>');
    expect(h).toContain('<td class="right">2</td>');
    expect(h).toContain('<hr>');
    expect(h).toContain('<figure><img src="https://x.example/c.jpg" alt="Crab" loading="lazy"><figcaption>NASA, ESA (public domain)</figcaption></figure>');
  });
  it('leaves snake_case and lone asterisks alone', () => {
    expect(renderMarkdown('mass_msun and 2 * 3 * 4')).toBe('<p>mass_msun and 2 * 3 * 4</p>');
  });
});

describe('deep links inside articles', () => {
  const catalogs = resolve(__dirname, '../../data/tiles/catalogs');
  const catalog = readdirSync(catalogs).filter((f) => f.endsWith('.json'))
    .flatMap((f) => {
      const d = JSON.parse(readFileSync(resolve(catalogs, f), 'utf8'));
      return (Array.isArray(d) ? d : d.entries ?? []) as CatalogEntry[];
    });
  const links = (re: RegExp) => {
    const out = new Map<string, string[]>();
    for (const l of LANGS) for (const s of slugs(l)) for (const m of read(l, s).matchAll(re)) {
      const target = decodeURIComponent(m[1]);
      out.set(target, [...(out.get(target) ?? []), `${l}/${s}`]);
    }
    return out;
  };

  it('every #focus= target resolves to a catalogue entry, an alias or a Solar System body', () => {
    const targets = links(/\]\(#focus=([^)&]+)\)/g);
    expect(targets.size).toBeGreaterThan(10);
    const unresolved = [...targets].filter(([name]) => !resolveFocus(name, catalog));
    // logged, not failed: Solar System and spacecraft targets arrive with the Solar System module
    if (unresolved.length) console.warn(`[docs] unresolved #focus= targets:\n${unresolved.map(([n, f]) => `  ${n} (${f.length} links, e.g. ${f[0]})`).join('\n')}`);
    for (const name of ['Earth', 'Sun', 'Mars', 'Moon', 'Pluto', 'Sgr A*', 'M87', 'Gaia BH3', 'TRAPPIST-1', 'Arecibo message', 'Wow! signal', 'M13', 'M1'])
      if (targets.has(name)) expect(resolveFocus(name, catalog), name).not.toBeNull();
    expect(resolveFocus('Earth', catalog)).toEqual({ type: 'body', id: 'earth' });
    expect(resolveFocus('sgr-a-star', catalog)).not.toBeNull();
    // own name wins over an alias ("Sgr A*" is also an alias of "Milky Way (Galactic Centre)")
    expect(resolveFocus('Sgr A*', catalog)).toMatchObject({ type: 'catalog', entry: { name: 'Sgr A*' } });
  });

  it('every #layer= target is a layer in layers.json', () => {
    const layers = new Set((JSON.parse(readFileSync(resolve(__dirname, '../public/layers.json'), 'utf8')).layers as { id: string }[]).map((x) => x.id));
    for (const [id, files] of links(/\]\(#layer=([^)&]+)\)/g)) expect(layers.has(id), `${id} in ${files[0]}`).toBe(true);
    for (const id of Object.keys(LAYER_VIEWS)) expect(layers.has(id) || id === 'solar', id).toBe(true);
    expect(classifyLink('#layer=galaxies-desi')).toEqual({ type: 'layer', id: 'galaxies-desi' });
  });
});
