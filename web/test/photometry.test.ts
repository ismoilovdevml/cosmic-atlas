import { describe, expect, it } from 'vitest';
import { appearance, depositedLight, K_GAUSS, knee, linearToSrgb, profile, REF_PX_PER_RAD, srgbToLinear, STAR_MAX_PX } from '../src/render/brightness';

describe('photometry per solid angle', () => {
  it('K_GAUSS is the disc integral of the rim-zeroed Gaussian', () => {
    let s = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const r = (i + 0.5) / n;
      s += 2 * Math.PI * r * profile(r) / n;
    }
    expect(s).toBeCloseTo(K_GAUSS, 6);
    expect(K_GAUSS).toBeCloseTo(0.7268, 4);
    expect(profile(1)).toBe(0);
  });
  it('deposited light equals flux and does not depend on canvas size, pixel ratio or fov', () => {
    for (const pxPerRad of [300, REF_PX_PER_RAD, 2000, 4500]) {
      for (const dpr of [1, 2]) {
        for (const [M, r, phys] of [[5, 10, 0], [0, 100, 0], [-20, 1e7, 1e4], [-20, 3e8, 1e4]]) {
          const a = appearance(M, r, 8, pxPerRad, dpr, phys, 220);
          if (a.trueSizePx > a.sizePx) continue; // ceiling reached: surface brightness frozen by design
          // light per steradian: deposited (ref px²) is the same number whatever the canvas
          expect(depositedLight(a, pxPerRad) / a.flux).toBeCloseTo(1, 9);
        }
      }
    }
  });
  it('peak is computed from the pre-ceiling radius (a very near star does not blow out)', () => {
    const far = appearance(-5, 10, 8, 900, 1, 0, STAR_MAX_PX);
    const near = appearance(-5, 0.01, 8, 900, 1, 0, STAR_MAX_PX);
    expect(near.sizePx).toBe(STAR_MAX_PX);
    expect(near.peak / far.peak).toBeLessThan(near.flux / far.flux);
  });
  it('knee is linear below K and bounded by K', () => {
    expect(knee(0.01) / 0.01).toBeCloseTo(1, 2);
    expect(knee(1e6)).toBeCloseTo(8, 9);
  });
  it('sRGB transfer functions invert each other', () => {
    for (const v of [0, 0.002, 0.04, 0.2, 0.5, 1]) expect(linearToSrgb(srgbToLinear(v))).toBeCloseTo(v, 12);
    expect(Math.round(linearToSrgb(srgbToLinear(11 / 255)) * 255)).toBe(11);
  });
});
