import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CMB_RADIUS_PC, cmbFade, cmbUV, limbAnchor } from '../src/messengers/cmb';
import { circleOutline, frbItems, neutrinoItems, rectOutline, type SkyTable } from '../src/messengers/data';
import { galToLB, radecDistToGal, type Vec3 } from '../src/math/frames';
import { KINDS } from '../src/objects/kinds';
import { unitFor } from '../src/objects/facts';

const CATS = resolve(__dirname, '../../data/tiles/catalogs');
const PUB = resolve(__dirname, '../public');
const json = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const ang = (a: Vec3, b: Vec3) => (Math.acos(Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / Math.hypot(...a) / Math.hypot(...b))) * 180) / Math.PI;

describe('CMB shell', () => {
  it('radius is the astropy Planck18 comoving distance to z = 1090 (13,884.42 Mpc)', () => {
    expect(Math.abs(CMB_RADIUS_PC / 13884420658.31242 - 1)).toBeLessThan(1e-5);
  });
  it('the catalogue entry and the texture sidecar agree with it', () => {
    const [e] = json(resolve(CATS, 'cmb.json'));
    expect(e.kind).toBe('cmb');
    expect(Math.abs(e.dist_pc / CMB_RADIUS_PC - 1)).toBeLessThan(1e-4);
    const meta = json(resolve(PUB, 'sky/planck_smica_cmb.json'));
    expect(Math.abs(meta.comoving_distance_pc_astropy_planck18 / CMB_RADIUS_PC - 1)).toBeLessThan(1e-5);
    expect(meta.range_uK).toEqual([-300, 300]);
    expect(statSync(resolve(PUB, 'sky/planck_smica_cmb.jpg')).size).toBeLessThanOrEqual(4 * 1024 * 1024);
  });
  it('is hidden inside the cosmic web and fully drawn from 12 Gpc out', () => {
    expect(cmbFade(1e9)).toBe(0);
    expect(cmbFade(8e9)).toBe(0);
    expect(cmbFade(12e9)).toBe(1);
    expect(cmbFade(3e10)).toBe(1);
  });
  it('maps Galactic directions to the equirectangular texture (l = 0 centre, l grows left, NGP top)', () => {
    expect(cmbUV(0, 0)).toEqual([0.5, 0.5]);
    expect(cmbUV(90, 0)[0]).toBeCloseTo(0.25, 12);
    expect(cmbUV(270, 0)[0]).toBeCloseTo(0.75, 12);
    expect(cmbUV(0, 90)[1]).toBe(1);
  });
  it('puts the label on the visible rim seen from outside, and on the shell from inside', () => {
    const R = CMB_RADIUS_PC;
    const cam: Vec3 = [3e10, 0, 0];
    const p = limbAnchor(cam, [0, 0, 1], R, [0, 0, 0]);
    expect(Math.hypot(...p) / R).toBeCloseTo(1, 9);
    // tangent: the camera ray to the point is perpendicular to the radius there
    const v: Vec3 = [p[0] - cam[0], p[1] - cam[1], p[2] - cam[2]];
    expect(Math.abs(v[0] * p[0] + v[1] * p[1] + v[2] * p[2]) / (Math.hypot(...v) * R)).toBeLessThan(1e-9);
    expect(p[2]).toBeGreaterThan(0);
    const q = limbAnchor([1e9, 0, 0], [0, 0, 1], R, [0, 0, 0]);
    expect(q[2] / R).toBeCloseTo(1, 9);
  });
});

describe('FRB data', () => {
  const hosts = json(resolve(CATS, 'frb-hosts.json'));
  const sky = json(resolve(CATS, 'frb-sky.json')) as SkyTable;
  it('only FRBs with a host redshift have a 3D position, at the Planck18 comoving distance', () => {
    expect(hosts.length).toBeGreaterThanOrEqual(100);
    for (const h of hosts) {
      expect(h.kind).toBe('frb');
      expect(typeof h.facts.z).toBe('number');
      expect(Math.abs(Math.hypot(...h.xyz) / h.dist_pc - 1)).toBeLessThan(1e-4);
      expect(h.facts).toHaveProperty('dm_pc_cm3');
      expect(h.facts).toHaveProperty('repeater');
      expect(h.facts).toHaveProperty('host_galaxy');
    }
    // FRB 20200120E sits in a globular cluster of M81
    expect(hosts.find((h: { name: string }) => h.name === 'FRB 20200120E').facts.host_galaxy).toMatch(/M81/);
  });
  it('every other FRB is a direction only (no distance), with DM, fluence and the repeater flag', () => {
    const items = frbItems(sky);
    expect(items.length).toBeGreaterThan(3500);
    const names = new Set(hosts.map((h: { name: string }) => h.name));
    for (const it of items) {
      expect(it.entry.xyz).toBeNull();
      expect(Number.isNaN(it.entry.dist_pc)).toBe(true);
      expect(names.has(it.entry.name)).toBe(false);
      expect(it.entry.facts).toHaveProperty('repeater');
      expect(it.entry.facts).toHaveProperty('host_galaxy', null);
      expect(Math.hypot(...it.dir)).toBeCloseTo(1, 9);
    }
    const reps = items.filter((i) => i.entry.facts!.repeater);
    expect(reps.length).toBeGreaterThan(40);
    expect(reps.every((r) => r.big)).toBe(true);
  });
});

describe('neutrino data', () => {
  const sky = json(resolve(CATS, 'neutrino-sky.json')) as SkyTable;
  const items = neutrinoItems(sky);
  it('has the 348 IceCat-1 tracks and KM3-230213A, each with a 90 % region around its direction', () => {
    expect(items.filter((i) => i.entry.source === 'neutrino-sky.json' && i.entry.name.startsWith('IC')).length).toBe(348);
    const km3 = items.find((i) => i.entry.name === 'KM3-230213A')!;
    expect(km3.entry.ra).toBe(94.3);
    expect(km3.entry.dec).toBe(-7.8);
    for (const p of km3.region!) expect(ang(p, km3.dir)).toBeCloseTo(2.2, 6);
    for (const it of items) {
      expect(it.region!.length).toBeGreaterThan(8);
      expect(it.entry.xyz).toBeNull();
    }
  });
  it('IceCat-1 rectangles span RA - minus .. RA + plus and Dec - minus .. Dec + plus', () => {
    const pts = rectOutline(100, 10, 2, 1, 0.5, 0.25, 4);
    const radec = pts.map((p) => {
      const d = Math.hypot(...p);
      // back to RA/Dec through the Galactic frame helpers
      const lb = galToLB(p);
      return { d, lb };
    });
    expect(radec.every((r) => Math.abs(r.d - 1) < 1e-12)).toBe(true);
    // the corners are the rectangle's corners
    expect(ang(pts[0], radecDistToGal(99, 9.75, 1))).toBeLessThan(1e-9);
    expect(ang(pts[4], radecDistToGal(102, 9.75, 1))).toBeLessThan(1e-9);
    expect(ang(pts[8], radecDistToGal(102, 10.5, 1))).toBeLessThan(1e-9);
    expect(ang(pts[12], radecDistToGal(99, 10.5, 1))).toBeLessThan(1e-9);
    const c = circleOutline(0, 89.5, 1, 12);
    for (const p of c) expect(ang(p, radecDistToGal(0, 89.5, 1))).toBeCloseTo(1, 9);
  });
  it('TXS 0506+056 and NGC 1068 are in 3D at their published distances, with significances', () => {
    const src = json(resolve(CATS, 'neutrino-sources.json'));
    const txs = src.find((e: { name: string }) => e.name === 'TXS 0506+056');
    const ngc = src.find((e: { name: string }) => e.name.startsWith('NGC 1068'));
    // SIMBAD (Harvard mirror) / NED, 2026-11-14: TXS 77.358185 +5.693148; NGC 1068 40.669622 -0.013294
    expect(txs.ra).toBeCloseTo(77.358185, 5);
    expect(txs.dec).toBeCloseTo(5.693148, 5);
    expect(ngc.ra).toBeCloseTo(40.6696, 3);
    expect(ngc.dec).toBeCloseTo(-0.0133, 3);
    expect(txs.dist_pc / 1e6).toBeCloseTo(1369.3, 0); // Planck18 D_C(z = 0.3365)
    expect(ngc.dist_pc).toBe(14.4e6);
    expect(txs.facts.significance).toMatch(/3σ/);
    expect(ngc.facts.significance).toMatch(/4\.2σ/);
  });
});

describe('integration', () => {
  const layers = json(resolve(PUB, 'layers.json'));
  it('layers.json lists the new catalogues, layers and background images, and every file exists', () => {
    for (const c of ['cmb.json', 'frb-hosts.json', 'neutrino-sources.json']) expect(layers.catalogs).toContain(`tiles/catalogs/${c}`);
    const byId = Object.fromEntries(layers.layers.map((l: { id: string }) => [l.id, l]));
    expect(byId.cmb.type).toBe('cmb');
    expect(existsSync(resolve(PUB, byId.cmb.image))).toBe(true);
    for (const id of ['frb', 'neutrinos']) {
      expect(byId[id].type).toBe('markers');
      expect(KINDS).toHaveProperty(byId[id].kind);
      expect(existsSync(resolve(CATS, byId[id].data))).toBe(true);
      expect(byId[id].credit).toBeTruthy();
    }
    const bgs = byId['gaia-sky'].backgrounds;
    expect(bgs.map((b: { id: string }) => b.id)).toEqual(['gaia', 'erosita', 'planck857']);
    for (const b of bgs) {
      expect(b.credit).toBeTruthy();
      if (b.image) expect(statSync(resolve(PUB, b.image)).size).toBeLessThanOrEqual(4 * 1024 * 1024);
    }
  });
  it('new fact units resolve', () => {
    expect(unitFor('fluence_jy_ms')).toBe('Jy ms');
    expect(unitFor('dm_pc_cm3')).toBe('pc cm⁻³');
    expect(unitFor('anisotropy_rms_uk')).toBe('µK');
    expect(unitFor('energy_tev')).toBe('TeV');
    expect(unitFor('comoving_distance_gpc')).toBe('Gpc');
  });
});
