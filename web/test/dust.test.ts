import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DustGrid, clampToData, dataBounds, decodeLog, rayInterval, relativeFactor, sampleCode, texCoord, voxelCentre, voxelOf, voxelOffset,
  type DustMeta, type GridDesc,
} from '../src/dust/grid';
import { dustFade, glowWeight } from '../src/dust';
import { radecDistToGal, type Vec3 } from '../src/math/frames';

const DIR = resolve(import.meta.dirname, '../../data/tiles/dust');
const META = resolve(DIR, 'meta.json');
// meta.json is tracked in git; the textures are built by scripts/build_dust.py
const meta: DustMeta | null = existsSync(META) ? JSON.parse(readFileSync(META, 'utf8')) : null;
const haveBins = !!meta && existsSync(resolve(DIR, meta.fine.file)) && existsSync(resolve(DIR, meta.aux.file));

const lbDir = (l: number, b: number): Vec3 => {
  const L = (l * Math.PI) / 180;
  const B = (b * Math.PI) / 180;
  return [Math.cos(B) * Math.cos(L), Math.cos(B) * Math.sin(L), Math.sin(B)];
};

describe('dust grid <-> xyz mapping', () => {
  const g: GridDesc = { file: 'x', dims: [418, 418, 134], voxelPc: 6, origin: [-1254, -1254, -402], format: 'r8', bytes: 418 * 418 * 134 };

  it('voxel centres round-trip and sit at texel centres', () => {
    for (const ijk of [[0, 0, 0], [417, 417, 133], [209, 208, 67], [12, 300, 5]] as [number, number, number][]) {
      const c = voxelCentre(g, ijk);
      expect(voxelOf(g, c)).toEqual(ijk);
      const u = texCoord(g, c);
      for (let a = 0; a < 3; a++) expect(u[a]).toBeCloseTo((ijk[a] + 0.5) / g.dims[a], 12);
    }
  });

  it('the Sun is the corner shared by the eight central voxels, and the grid edges are where meta says', () => {
    expect(voxelOf(g, [0, 0, 0])).toEqual([209, 209, 67]);
    expect(voxelOf(g, [-1e-9, -1e-9, -1e-9])).toEqual([208, 208, 66]);
    expect(voxelOf(g, [-1254, 0, 0])).toEqual([0, 209, 67]);
    expect(voxelOf(g, [1254, 0, 0])).toBeNull();
    expect(voxelOf(g, [0, 0, 402.0001])).toBeNull();
    expect(texCoord(g, [0, 0, 0])).toEqual([0.5, 0.5, 0.5]);
  });

  it('x varies fastest in memory, then y, then z (build_dust.py writes C order (z, y, x))', () => {
    expect(voxelOffset(g, [1, 0, 0])).toBe(1);
    expect(voxelOffset(g, [0, 1, 0])).toBe(418);
    expect(voxelOffset(g, [0, 0, 1])).toBe(418 * 418);
    expect(voxelOffset(g, [3, 2, 1], 4)).toBe(4 * (418 * 418 + 2 * 418 + 3));
  });

  it('trilinear sampling follows the GPU (texel centres, clamp to edge)', () => {
    const t: GridDesc = { file: 'x', dims: [2, 2, 2], voxelPc: 10, origin: [0, 0, 0], format: 'r8', bytes: 8 };
    const d = new Uint8Array([0, 100, 0, 100, 0, 100, 0, 100]); // value = 100 * i
    expect(sampleCode(t, d, [5, 5, 5])).toBeCloseTo(0, 9); // centre of voxel 0
    expect(sampleCode(t, d, [15, 5, 5])).toBeCloseTo(100, 9); // centre of voxel 1
    expect(sampleCode(t, d, [10, 7, 12])).toBeCloseTo(50, 9); // halfway
    expect(sampleCode(t, d, [-50, 5, 5])).toBeCloseTo(0, 9); // clamped
    expect(sampleCode(t, d, [99, 5, 5])).toBeCloseTo(100, 9);
  });

  it('log code round trip matches build_dust.py (code 0 = below 10^lo, linear ramp under 1)', () => {
    const lo = -3.0654546463181016;
    const hi = 1.5019217364797801;
    expect(decodeLog(0, lo, hi)).toBe(0);
    expect(decodeLog(1, lo, hi)).toBeCloseTo(10 ** lo, 12);
    expect(decodeLog(255, lo, hi)).toBeCloseTo(10 ** hi, 9);
    expect(decodeLog(0.5, lo, hi)).toBeCloseTo(0.5 * 10 ** lo, 12);
    // one code step is (hi - lo) / 254 dex = 4.2 %: the quantisation build_dust.py reports (median 1.0 %)
    expect(decodeLog(129, lo, hi) / decodeLog(128, lo, hi)).toBeCloseTo(10 ** ((hi - lo) / 254), 9);
  });
});

describe.skipIf(!meta)('dust ray geometry', () => {
  const m = meta!;
  const { R, Z } = dataBounds(m);

  it('rays from the Sun leave the map at the sphere in the plane and at the slab toward the poles', () => {
    expect(rayInterval(m, [0, 0, 0], [1, 0, 0])).toEqual([0, R]);
    const up = rayInterval(m, [0, 0, 0], [0, 0, 1])!;
    expect(up[0]).toBe(0);
    expect(up[1]).toBeCloseTo(Z, 9);
    const d = lbDir(30, 30);
    const iv = rayInterval(m, [0, 0, 0], d)!;
    expect(iv[1]).toBeCloseTo(Math.min(R, Z / Math.sin(Math.PI / 6)), 9);
  });

  it('a camera 3 kpc above the plane sees the slab from its top face, and misses it looking up', () => {
    const iv = rayInterval(m, [0, 0, 3000], [0, 0, -1])!;
    expect(iv[0]).toBeCloseTo(3000 - Z, 9);
    expect(iv[1]).toBeCloseTo(3000 + Z, 9);
    expect(rayInterval(m, [0, 0, 3000], [0, 0, 1])).toBeNull();
    expect(rayInterval(m, [0, 0, 3000], [1, 0, 0])).toBeNull();
  });

  it('points beyond the map are pulled back along the Sun ray to just inside it', () => {
    const p = clampToData(m, [5000, 0, 0]);
    expect(p[0]).toBeCloseTo(R - m.aux.voxelPc / 2, 9);
    const q = clampToData(m, [0, 300, 3000]);
    expect(q[2]).toBeCloseTo(Z - m.aux.voxelPc / 2, 9);
    expect(q[1] / q[2]).toBeCloseTo(0.1, 12);
    expect(clampToData(m, [10, 20, 30])).toEqual([10, 20, 30]);
  });

  it('relative extinction: no change when camera and Sun see the same dust; only dimming with a cap of 1', () => {
    expect(relativeFactor(1.3, 1.3, 1, 1)).toBe(1);
    expect(relativeFactor(2.3, 1.3, 1, 1)).toBeCloseTo(10 ** -0.4, 12);
    expect(relativeFactor(0, 1.3, 1, 1)).toBe(1);
  });

  it('fades in over 10-20 pc and out over 5-8 kpc of camera distance; glow only outside the map in auto mode', () => {
    expect(dustFade(6)).toBe(0);
    expect(dustFade(300)).toBe(1);
    expect(dustFade(3000)).toBe(1);
    expect(dustFade(1e4)).toBe(0);
    expect(dustFade(15)).toBeCloseTo(0.5, 9);
    expect(glowWeight(m, [100, 0, 0], 'auto')).toBe(0);
    expect(glowWeight(m, [0, 0, 3000], 'auto')).toBe(1);
    expect(glowWeight(m, [0, 0, 3000], 'absorb')).toBe(0);
    expect(glowWeight(m, [0, 0, 0], 'glow')).toBe(1);
  });
});

describe.skipIf(!haveBins)('dust data: known clouds where the literature puts them', () => {
  const m = meta!;
  const grid = new DustGrid(m, new Uint8Array(readFileSync(resolve(DIR, m.fine.file))), new Uint8Array(readFileSync(resolve(DIR, m.aux.file))));
  // (l, b) and literature distance; the same list as scripts/build_dust.py CLOUDS
  const clouds: [string, number, number, number, number][] = [
    ['Taurus', 169.6, -16.1, 141, 25],
    ['Ophiuchus', 353.1, 16.9, 139, 25],
    ['Perseus', 159.4, -19.8, 294, 40],
    ['Orion A', 210.5, -19.6, 400, 60],
    ['Chamaeleon I', 297.1, -15.6, 190, 30],
    ['Lupus', 339.5, 15.5, 155, 30],
  ];

  for (const [name, l, b, d, tol] of clouds) {
    it(`${name}: the densest point on the sight line is ${d} ± ${tol} pc away, and dense`, () => {
      const u = lbDir(l, b);
      let best = 0;
      let at = 0;
      for (let r = 20; r < 1240; r += 1) {
        const rho = grid.density([u[0] * r, u[1] * r, u[2] * r]);
        if (rho > best) [best, at] = [rho, r];
      }
      expect(Math.abs(at - d)).toBeLessThanOrEqual(tol);
      expect(best).toBeGreaterThan(5); // mag per kpc; the diffuse median is 0.07
    });
  }

  it('the Local Bubble: nearly empty inside 60 pc, a wall by ~150 pc in the plane', () => {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < 2000; i++) {
      const u = lbDir((i * 137.5) % 360, Math.asin(((i * 0.618) % 2) - 1) * (180 / Math.PI));
      const r = 60 * Math.cbrt(((i * 0.377) % 1) + 1e-3);
      sum += grid.density([u[0] * r, u[1] * r, u[2] * r]);
      n++;
    }
    expect(sum / n).toBeLessThan(0.5);
    const walls: number[] = [];
    for (let l = 0; l < 360; l += 5) {
      const u = lbDir(l, 0);
      for (let r = 10; r < 1240; r += 2) {
        if (grid.density([u[0] * r, u[1] * r, u[2] * r]) > 1) {
          walls.push(r);
          break;
        }
      }
    }
    walls.sort((a, b) => a - b);
    const med = walls[Math.floor(walls.length / 2)];
    expect(med).toBeGreaterThan(80);
    expect(med).toBeLessThan(250);
  });

  it('the Sun-side A_V texture agrees with a CPU march through the 6 pc grid', () => {
    // at its own 12 pc voxel centres it is the same integral (python 512 steps vs 2048 here)
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const cpuAv = (p: Vec3) => {
      const r = Math.hypot(...p);
      return grid.rayAv([0, 0, 0], [p[0] / r, p[1] / r, p[2] / r], 2048, r);
    };
    for (let k = 0; k < 150; k++) {
      const p: Vec3 = [-1248 + 12 * (30 + Math.floor(rnd() * 150)), -1248 + 12 * (30 + Math.floor(rnd() * 150)), -396 + 12 * (5 + Math.floor(rnd() * 56))];
      if (Math.hypot(...p) > 1150) continue;
      expect(Math.abs(grid.sunAv(p) - cpuAv(p))).toBeLessThan(0.005);
    }
    // between centres the trilinear 12 pc field is an approximation: measured median 0.003 mag,
    // 90th percentile 0.027 mag, worst 0.17 mag over 371 random points (2026-11-14)
    const err: number[] = [];
    for (let k = 0; k < 300; k++) {
      const p: Vec3 = [(rnd() - 0.5) * 2000, (rnd() - 0.5) * 2000, (rnd() - 0.5) * 700];
      const r = Math.hypot(...p);
      if (r > 1150 || r < 20) continue;
      err.push(Math.abs(grid.sunAv(p) - cpuAv(p)));
    }
    err.sort((a, b) => a - b);
    expect(err[Math.floor(err.length / 2)]).toBeLessThan(0.01);
    expect(err[Math.floor(err.length * 0.9)]).toBeLessThan(0.05);
  });

  it('a click toward Taurus from 110 pc off its sight line lands on Taurus', () => {
    const taurus: Vec3 = [-136, 25, -40];
    const yaw = (-100.4 * Math.PI) / 180;
    const pitch = (10 * Math.PI) / 180;
    const cam: Vec3 = [taurus[0] + 110 * Math.cos(pitch) * Math.cos(yaw), taurus[1] + 110 * Math.cos(pitch) * Math.sin(yaw), taurus[2] + 110 * Math.sin(pitch)];
    const d: Vec3 = [(taurus[0] - cam[0]) / 110, (taurus[1] - cam[1]) / 110, (taurus[2] - cam[2]) / 110];
    const hit = grid.pick(cam, d)!;
    expect(hit).not.toBeNull();
    expect(hit.landmark?.name).toMatch(/^Taurus/);
    expect(hit.density).toBeGreaterThan(5);
    expect(hit.densityStd).toBeGreaterThan(0);
    expect(hit.avFromCamera).toBeLessThan(hit.avRayTotal);
  });

  it('Orion A sits behind the ONC direction (RA 83.82, Dec -5.39) at ~390-430 pc', () => {
    const onc = radecDistToGal(83.82, -5.39, 1);
    let best = 0;
    let at = 0;
    for (let r = 200; r < 700; r += 1) {
      const rho = grid.density([onc[0] * r, onc[1] * r, onc[2] * r]);
      if (rho > best) [best, at] = [rho, r];
    }
    expect(at).toBeGreaterThan(360);
    expect(at).toBeLessThan(460);
  });
});
