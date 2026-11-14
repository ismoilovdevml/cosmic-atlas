/**
 * Star clusters (clusters.json, scripts/build_clusters.py) and gravitational-wave events
 * (gw-events.json, scripts/build_gw.py): merge with Messier/NGC, spot values from the papers,
 * localisation volumes, and the viewer helpers (src/render/gwVolumes.ts, src/objects/facts.ts).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { catalogKey, loadCatalogs, type CatalogEntry } from '../src/data/manifest';
import { formatFact, unitFor, factValueKey } from '../src/objects/facts';
import { gwFade, parseLoc, rayEllipsoid } from '../src/render/gwVolumes';
import { nearestEntry } from '../src/objects/gw';
import { radecDistToGal } from '../src/math/frames';

const dir = resolve(import.meta.dirname, '../../data/tiles/catalogs');
const load = (n: string) => JSON.parse(readFileSync(resolve(dir, `${n}.json`), 'utf8')) as CatalogEntry[];
const clusters = load('clusters');
const gw = load('gw-events');
const named = (es: CatalogEntry[], n: string) => es.find((e) => e.name === n || (e.alt ?? []).includes(n))!;

describe('clusters.json', () => {
  it('holds the Hunt & Reffert census and the Baumgardt globulars', () => {
    expect(clusters.length).toBeGreaterThan(5900);
    const types = new Set(clusters.map((e) => e.facts?.type));
    expect([...types].sort()).toEqual(['globular cluster', 'moving group', 'open cluster']);
    expect(clusters.filter((e) => e.facts?.type === 'globular cluster').length).toBeGreaterThanOrEqual(167);
  });

  it('M45 and M44 appear once after the viewer loads clusters.json before messier-ngc.json', async () => {
    const m = JSON.parse(readFileSync(resolve(import.meta.dirname, '../public/layers.json'), 'utf8')) as { catalogs: string[] };
    const order = m.catalogs.map((u) => u.split('/').pop());
    expect(order.indexOf('clusters.json')).toBeLessThan(order.indexOf('messier-ngc.json'));
    const files: Record<string, unknown> = {};
    for (const f of ['clusters.json', 'messier-ngc.json']) files[f] = JSON.parse(readFileSync(resolve(dir, f), 'utf8'));
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (u: string) => new Response(JSON.stringify(files[String(u).split('/').pop()!] ?? null), { status: files[String(u).split('/').pop()!] ? 200 : 404 })) as typeof fetch;
    try {
      const { entries } = await loadCatalogs(['clusters.json', 'messier-ngc.json']);
      for (const n of ['M45', 'M44', 'Pleiades', 'NGC 869', 'M13', 'NGC 5139']) {
        const hits = entries.filter((e) => [e.name, ...(e.alt ?? [])].some((a) => catalogKey(a) === catalogKey(n)));
        expect(hits.length, n).toBe(1);
        expect(hits[0].source, n).toBe('clusters.json');
      }
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('spot values: Hunt & Reffert 2023/2024 (VizieR J/A+A/673/A114, J/A+A/686/A42), Baumgardt & Vasiliev 2021', () => {
    const m45 = named(clusters, 'M45');
    expect(m45.dist_pc).toBeCloseTo(134.84, 2);
    expect(m45.facts!.n_members).toBe(1721);
    expect(m45.facts!.mass_msun).toEqual([985, 92]);
    const hy = named(clusters, 'Hyades');
    expect(hy.name).toBe('Melotte 25');
    expect(hy.dist_pc).toBeCloseTo(47.19, 2);
    expect(named(clusters, 'M44').dist_pc).toBeCloseTo(183.49, 2);
    expect(named(clusters, 'NGC 869').dist_pc).toBeCloseTo(2279.6, 1);
    expect(named(clusters, 'NGC 884').dist_pc).toBeCloseTo(2293.2, 1);
    const m13 = named(clusters, 'M13');
    expect(m13.dist_pc).toBe(7420);
    expect(m13.facts!.type).toBe('globular cluster');
    const oc = named(clusters, 'NGC 5139');
    expect(oc.dist_pc).toBe(5430);
    expect(oc.facts!.mass_msun).toEqual([3.94e6, 1.7e4]);
    expect(oc.facts!.age_myr).toBeUndefined(); // Paper II ages are not used for globulars
  });

  it('a cluster that shares its NGC/IC number with a nebula keeps both', () => {
    expect(clusters.some((e) => e.name === 'NGC 2264 cluster')).toBe(true);
  });
});

describe('gw-events.json', () => {
  it('< 5 MB, every event has a localisation volume and the facts the card needs', () => {
    expect(statSync(resolve(dir, 'gw-events.json')).size).toBeLessThan(5_000_000);
    const ev = gw.filter((e) => e.kind === 'gw_event');
    expect(ev.length).toBeGreaterThan(270);
    for (const e of ev) {
      expect(parseLoc(e).length, e.name).toBeGreaterThan(0);
      const f = e.facts!;
      expect(typeof f.vol90_mpc3, e.name).toBe('number');
      expect(f.position, e.name).toBe(e.name === 'GW170817' ? 'host galaxy' : 'uncertain');
      for (const k of ['mass1_msun', 'mass2_msun', 'lum_dist_mpc', 'comoving_dist_mpc']) expect(f[k], `${e.name}.${k}`).toBeDefined();
      // weights sum to one, the label anchor sits at the heaviest ellipsoid (or the host)
      const parts = parseLoc(e);
      expect(parts.reduce((s, p) => s + p.w, 0)).toBeCloseTo(1, 2);
      if (e.name !== 'GW170817') expect(Math.hypot(...e.xyz!) / Math.hypot(...parts[0].c)).toBeCloseTo(1, 3);
    }
  });

  it('GW170817 sits exactly at NGC 4993 (SBF 40.7 Mpc as luminosity distance, Planck18 comoving)', () => {
    const e = named(gw, 'GW170817');
    const host = named(gw, 'NGC 4993');
    expect((e as unknown as { host: string }).host).toBe('NGC 4993');
    expect(e.xyz).toEqual(host.xyz);
    expect(e.dist_pc / 1e6).toBeCloseTo(40.33, 1);
    const g = radecDistToGal(host.ra!, host.dec!, host.dist_pc);
    expect(Math.hypot(g[0] - host.xyz![0], g[1] - host.xyz![1], g[2] - host.xyz![2]) / host.dist_pc).toBeLessThan(1e-5);
    expect(e.alt).toContain('AT 2017gfo');
  });

  it('GW150914: GWOSC values and a 90 % volume within 1 % of ligo-skymap-stats', () => {
    const e = named(gw, 'GW150914');
    expect(e.facts!.lum_dist_mpc).toEqual([470, 160, 140]); // GWOSC cumulative list (GWTC-2.1)
    expect(e.facts!.vol90_mpc3 as number).toBeGreaterThan(3.35e6);
    expect(e.facts!.vol90_mpc3 as number).toBeLessThan(3.42e6); // LVK: 3.387e6 Mpc³ (Planck15)
  });
});

describe('viewer helpers', () => {
  it('units and translated text values', () => {
    expect(unitFor('vol90_mpc3')).toBe('Mpc³');
    expect(unitFor('comoving_dist_mpc')).toBe('Mpc');
    expect(unitFor('age_myr')).toBe('Myr');
    expect(unitFor('area90_deg2')).toBe('deg²');
    expect(unitFor('r50_pc')).toBe('pc');
    expect(factValueKey('neutron star–black hole')).toBe('facts.val.neutron_star_black_hole');
    const L = { t: (k: string) => (k === 'facts.val.uncertain' ? 'aniq emas' : k), decimal: ',' };
    expect(formatFact('position', 'uncertain', L)).toBe('aniq emas');
    expect(formatFact('type', 'binary, millisecond', L)).toBe('binary, millisecond');
  });

  it('ray–ellipsoid hits and misses', () => {
    const p = { w: 1, c: [0, 0, 10] as [number, number, number], axes: [1, 2, 3] as [number, number, number], q: [0, 0, 0, 1] as [number, number, number, number] };
    expect(rayEllipsoid([0, 0, 0], [0, 0, 1], p)).toBeCloseTo(7, 9);
    expect(rayEllipsoid([1.5, 0, 0], [0, 0, 1], p)).toBeNull();
    expect(rayEllipsoid([0, 1.5, 0], [0, 0, 1], p)).not.toBeNull();
    // rotated 90° about z: the 2-unit axis now lies along x
    const s = Math.SQRT1_2;
    expect(rayEllipsoid([1.5, 0, 0], [0, 0, 1], { ...p, q: [0, 0, s, s] })).not.toBeNull();
    expect(rayEllipsoid([0, 0, 20], [0, 0, 1], p)).toBeNull(); // behind the origin
  });

  it('volumes fade in beyond ~1 Mpc from the Sun', () => {
    expect(gwFade(1e4)).toBe(0);
    expect(gwFade(1e7)).toBe(1);
  });

  it('a star-clusters point finds its catalogue entry', () => {
    const m45 = named(clusters, 'M45');
    const p = m45.xyz!.map((v) => v + 0.004) as [number, number, number];
    expect(nearestEntry(clusters, p, ['cluster', 'cluster_nebula'])?.name).toBe('M45');
    expect(nearestEntry(clusters, [m45.xyz![0] + 5, m45.xyz![1], m45.xyz![2]], ['cluster'])).toBeNull();
  });
});
