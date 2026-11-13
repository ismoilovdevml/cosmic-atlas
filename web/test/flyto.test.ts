import { describe, expect, it } from 'vitest';
import { makeZoomPath, easeInOut } from '../src/math/flyto';

describe('log fly-to path', () => {
  it('pure zoom is linear in log-distance', () => {
    const p = makeZoomPath(1e-5, 1e9, 0);
    for (const t of [0, 0.1, 0.25, 0.5, 0.9, 1]) {
      const want = -5 + 14 * t;
      expect(Math.log10(p.at(t).dist)).toBeCloseTo(want, 9);
    }
    expect(p.S).toBeCloseTo((14 * Math.LN10) / 1.4, 9);
  });

  it('hits both endpoints exactly and pan is monotone 0 -> 1', () => {
    const p = makeZoomPath(4.85e-6, 3e4, 765000); // ~1 AU view at the Sun -> 30 kpc view at M31
    expect(p.at(0)).toEqual({ pan: 0, dist: 4.85e-6 });
    expect(p.at(1)).toEqual({ pan: 1, dist: 3e4 });
    let prev = -1;
    for (let i = 0; i <= 400; i++) {
      const { pan, dist } = p.at(i / 400);
      expect(pan).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(Number.isFinite(dist) && dist > 0).toBe(true);
      prev = pan;
    }
    // the closed form itself reaches the end (not only the clamped t>=1 branch)
    const near = p.at(1 - 1e-9);
    expect(near.pan).toBeCloseTo(1, 6);
    expect(Math.log(near.dist / 3e4)).toBeCloseTo(0, 5);
  });

  it('a long pan rises above both endpoints so start and end share a view', () => {
    const p = makeZoomPath(1, 1, 765000);
    let maxD = 0;
    for (let i = 0; i <= 200; i++) maxD = Math.max(maxD, p.at(i / 200).dist);
    expect(maxD).toBeGreaterThan(765000 / 2);
    // symmetric endpoints -> symmetric path
    expect(Math.log(p.at(0.3).dist)).toBeCloseTo(Math.log(p.at(0.7).dist), 6);
  });

  it('log-distance is continuous (no jumps) across 15 decades', () => {
    const p = makeZoomPath(1e-6, 2e9, 2e9);
    let prev = Math.log(p.at(0).dist);
    for (let i = 1; i <= 2000; i++) {
      const cur = Math.log(p.at(i / 2000).dist);
      expect(Math.abs(cur - prev)).toBeLessThan(0.1);
      prev = cur;
    }
  });

  it('ease is 0/1 at the ends and symmetric', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.25) + easeInOut(0.75)).toBeCloseTo(1, 12);
  });
});
