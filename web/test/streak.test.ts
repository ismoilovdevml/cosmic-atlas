import { describe, expect, it } from 'vitest';
import { streakCorner, streakDir, streakPerp, type V2 } from '../src/render/streak';

// PlaneGeometry(1, 1): corners in this order, two triangles by index (counter-clockwise, +z facing)
const CORNERS: V2[] = [[-0.5, 0.5], [0.5, 0.5], [-0.5, -0.5], [0.5, -0.5]];
const TRIS = [[0, 2, 1], [2, 3, 1]];
const area2 = (a: V2, b: V2, c: V2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

describe('uncertainty streak quad', () => {
  it('the source quad is counter-clockwise (what FrontSide keeps)', () => {
    for (const [a, b, c] of TRIS) expect(area2(CORNERS[a], CORNERS[b], CORNERS[c])).toBeGreaterThan(0);
  });

  it('keeps the winding for every streak direction, including degenerate ones', () => {
    const cases: [V2, V2][] = [[[0, 0], [0, 0]], [[-3, 1], [5, 1]], [[0, -4], [0, 9]], [[2, 2], [-7, -1]], [[0, 0], [0.0001, 0]]];
    for (let k = 0; k < 16; k++) cases.push([[0, 0], [40 * Math.cos(k), 40 * Math.sin(k)]]);
    for (const [lo, hi] of cases) {
      const P = CORNERS.map(([x, y]) => streakCorner(lo, hi, 3, x, y));
      for (const [a, b, c] of TRIS) expect(area2(P[a], P[b], P[c])).toBeGreaterThan(0);
    }
  });

  it('spans lo − w/2 … hi + w/2 along the line of sight and w across it', () => {
    const lo: V2 = [10, 0];
    const hi: V2 = [30, 0];
    const w = 4;
    expect(streakCorner(lo, hi, w, 0, -0.5)).toEqual([8, 0]);
    expect(streakCorner(lo, hi, w, 0, 0.5)).toEqual([32, 0]);
    const a = streakCorner(lo, hi, w, -0.5, 0);
    const b = streakCorner(lo, hi, w, 0.5, 0);
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeCloseTo(w, 12);
  });

  it('perp is dir rotated by −90° (rotation, not reflection)', () => {
    const d = streakDir([0, 0], [3, 4]);
    const p = streakPerp(d);
    expect(d[0] * p[0] + d[1] * p[1]).toBeCloseTo(0, 12);
    expect(p[0] * d[1] - p[1] * d[0]).toBeCloseTo(1, 12); // det [perp dir] = +1
  });
});
