import { describe, expect, it } from 'vitest';
import { binCounts, DEFAULT_EXPOSURE, exposureFromCounts, GRID_X, GRID_Y, percentile, smoothExposure } from '../src/render/exposure';
import { K_GAUSS } from '../src/render/brightness';

const ID = [1, 0, 0, 0, 1, 0, 0, 0, 1];

describe('density-aware galaxy exposure', () => {
  it('percentile is nearest-rank', () => {
    expect(percentile([5, 1, 4, 2, 3], 0.98)).toBe(5);
    expect(percentile([5, 1, 4, 2, 3], 0.5)).toBe(3);
    expect(percentile([], 0.98)).toBe(0);
  });

  it('maps the 98th-percentile bin to the target luminance (energy check)', () => {
    const W = 960, H = 600;
    const bins = new Float32Array(GRID_X * GRID_Y);
    bins.fill(2);
    for (let i = 0; i < 40; i++) bins[i] = 500; // a dense core in 40 of 1440 bins (2.8 %)
    const { k, p98 } = exposureFromCounts(bins, W, H, { ...DEFAULT_EXPOSURE, kMin: 0, kMax: 1e9 });
    expect(p98).toBe(500);
    const r = DEFAULT_EXPOSURE.spritePx / 2;
    const binArea = (W / GRID_X) * (H / GRID_Y);
    // mean luminance of a p98 bin = count · k · K · r² / area = target
    expect((p98 * k * K_GAUSS * r * r) / binArea).toBeCloseTo(DEFAULT_EXPOSURE.target, 9);
  });

  it('keeps a floor so lone galaxies stay visible, and a ceiling for empty frames', () => {
    const many = new Float32Array(GRID_X * GRID_Y).fill(1e7);
    expect(exposureFromCounts(many, 960, 600, DEFAULT_EXPOSURE).k).toBe(DEFAULT_EXPOSURE.kMin);
    expect(exposureFromCounts(new Float32Array(GRID_X * GRID_Y), 960, 600, DEFAULT_EXPOSURE).k).toBe(DEFAULT_EXPOSURE.kMax);
  });

  it('counts points into screen bins, honours the slab and re-weights by the sample stride', () => {
    // 1000 points straight ahead at z = -10, half inside a ±1 slab around z = -10, half at z = -20
    const n = 1000;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) pos[i * 3 + 2] = i < 500 ? -10 : -20;
    const node = { rel: [0, 0, 0] as [number, number, number], positions: pos, count: n, alpha: 1 };
    const P = { rot: ID, f: 500, width: 960, height: 600, slabZ: -10, slabHalf: 1 };
    const all = binCounts([node], { ...P, slabHalf: 1e30 }, 1e6);
    expect(all.reduce((a, b) => a + b, 0)).toBe(1000);
    const slab = binCounts([node], P, 1e6);
    expect(slab.reduce((a, b) => a + b, 0)).toBe(500);
    const sampled = binCounts([node], { ...P, slabHalf: 1e30 }, 100);
    expect(sampled.reduce((a, b) => a + b, 0)).toBeCloseTo(1000, -1);
  });

  it('smooths in log space', () => {
    expect(smoothExposure(0, 2, 0.016)).toBe(2);
    const s = smoothExposure(1, 4, 0.6, 0.6);
    expect(s).toBeGreaterThan(1);
    expect(s).toBeLessThan(4);
  });
});
