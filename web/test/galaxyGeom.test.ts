import { describe, expect, it } from 'vitest';
import { galToRadec, radecDistToGal, type Vec3 } from '../src/math/frames';
import {
  BULGE_QUAD, DISK_FADE, K_BULGE, K_DISK_IN, K_SPH_IN, QUAD_R, THUMB_FADE, bulgeProfile, diskAxes, diskProfile, lodWeights,
  peakIntensities, planeCos, radialIntegral, skyOffset, spheroidProfile, thumbUV,
} from '../src/render/galaxyGeom';

const DEG = Math.PI / 180;

/** position angle (deg, N through E) and separation (rad) of b as seen from a, both RA/Dec in degrees */
function paSep(a: { ra: number; dec: number }, b: { ra: number; dec: number }) {
  const d1 = a.dec * DEG;
  const d2 = b.dec * DEG;
  const da = (b.ra - a.ra) * DEG;
  const pa = Math.atan2(Math.sin(da) * Math.cos(d2), Math.cos(d1) * Math.sin(d2) - Math.sin(d1) * Math.cos(d2) * Math.cos(da)) / DEG;
  const sep = Math.acos(Math.min(1, Math.sin(d1) * Math.sin(d2) + Math.cos(d1) * Math.cos(d2) * Math.cos(da)));
  return { pa: (pa + 360) % 360, sep };
}

const add = (c: Vec3, v: Vec3, k: number): Vec3 => [c[0] + v[0] * k, c[1] + v[1] * k, c[2] + v[2] * k];

describe('LOD crossfade weights', () => {
  it('sum to one everywhere and stay in [0, 1]', () => {
    for (let px = 0; px <= 200; px += 0.25)
      for (const ready of [0, 0.1, 0.37, 0.5, 0.9, 1]) {
        const w = lodWeights(px, ready);
        expect(w.dot + w.disk + w.thumb).toBeCloseTo(1, 12);
        for (const v of [w.dot, w.disk, w.thumb]) {
          expect(v).toBeGreaterThanOrEqual(-1e-12);
          expect(v).toBeLessThanOrEqual(1 + 1e-12);
        }
      }
  });
  it('ladder: dot below the disk band, disk between, thumbnail only once ready', () => {
    expect(lodWeights(DISK_FADE[0] - 1, 1)).toEqual({ dot: 1, disk: 0, thumb: 0 });
    const mid = lodWeights((DISK_FADE[1] + THUMB_FADE[0]) / 2, 1);
    expect(mid.disk).toBe(1);
    expect(lodWeights(THUMB_FADE[1] + 10, 1).thumb).toBe(1);
    // no image (missing, failed or blocked by CORS) -> the procedural disk stays
    expect(lodWeights(500, 0)).toEqual({ dot: 0, disk: 1, thumb: 0 });
  });
});

describe('disk orientation on the sky (seen from the Sun)', () => {
  const cases = [
    { name: 'M31', ra: 10.68471, dec: 41.26875, pa: 35, incl: 72.2, q: 0.392 },
    { name: 'M81', ra: 148.88822, dec: 69.0653, pa: 157, incl: 62.7, q: 0.52 },
    { name: 'NGC 253', ra: 11.88806, dec: -25.2888, pa: 52.5, incl: 90, q: 0.171 },
    { name: 'LMC', ra: 80.89417, dec: -69.75611, pa: 170, incl: 35.4, q: 0.851 },
    { name: 'near pole', ra: 200, dec: 89.5, pa: 10, incl: 50, q: 0.64 },
  ];
  for (const c of cases) {
    it(`${c.name}: major axis at PA, in-plane axis foreshortened by cos i`, () => {
      const d = 1e6;
      const R = 1e2; // small against d, so the projection is linear to ~1e-4
      const C = radecDistToGal(c.ra, c.dec, d);
      const cosI = planeCos(c.incl, c.q);
      const ax = diskAxes(c.ra, c.dec, c.pa, cosI);
      const centre = { ra: c.ra, dec: c.dec };
      const tip = paSep(centre, galToRadec(add(C, ax.major, R)));
      expect(Math.abs(((tip.pa - c.pa + 540) % 360) - 180)).toBeLessThan(1e-3);
      expect((tip.sep * d) / R).toBeCloseTo(1, 4);
      const side = paSep(centre, galToRadec(add(C, ax.inPlane, R)));
      expect(Math.abs(((side.pa - (c.pa + 90) + 540) % 360) - 180)).toBeLessThan(1e-2);
      expect((side.sep * d) / R).toBeCloseTo(cosI, 4);
      // plane orthonormal frame
      const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      expect(dot(ax.major, ax.inPlane)).toBeCloseTo(0, 12);
      expect(dot(ax.normal, ax.inPlane)).toBeCloseTo(0, 12);
      expect(dot(ax.normal, ax.los)).toBeCloseTo(cosI, 12);
    });
    it(`${c.name}: thumbnail mapping of plane points equals their true sky offset`, () => {
      const d = 1e6;
      const R = 1e2;
      const C = radecDistToGal(c.ra, c.dec, d);
      const cosI = planeCos(c.incl, c.q);
      const ax = diskAxes(c.ra, c.dec, c.pa, cosI);
      for (const [u, v] of [[1, 0], [0, 1], [0.7, -0.4], [-1.2, 1.1]]) {
        const P = add(add(C, ax.major, R * u), ax.inPlane, R * v);
        const s = paSep({ ra: c.ra, dec: c.dec }, galToRadec(P));
        const east = (Math.sin(s.pa * DEG) * s.sep * d) / R;
        const north = (Math.cos(s.pa * DEG) * s.sep * d) / R;
        const o = skyOffset(u, v, cosI, c.pa);
        expect(o.east).toBeCloseTo(east, 3);
        expect(o.north).toBeCloseTo(north, 3);
      }
    });
  }
  it('thumbnail uv: north at the top row (v = 0 of the decoded rows), east to the left', () => {
    const fov = QUAD_R;
    expect(thumbUV(0, 0, fov)).toEqual([0.5, 0.5]);
    expect(thumbUV(0, fov, fov)[1]).toBeCloseTo(0, 12); // north edge -> first row
    expect(thumbUV(fov, 0, fov)[0]).toBeCloseTo(0, 12); // east edge -> left column
  });
  it('plane tilt never hides the D25 ellipse: cos >= 0.85 b/a', () => {
    expect(planeCos(90, 0.17)).toBeCloseTo(0.85 * 0.17, 12);
    expect(planeCos(60, 0.52)).toBeCloseTo(0.5, 12);
    expect(planeCos(null, 0.4)).toBe(0.4);
  });
});

describe('procedural profile normalisation', () => {
  it('mean intensity over D25 equals the target (disk + bulge)', () => {
    const target = 0.2;
    for (const fb of [0, 0.15, 0.4]) {
      for (const cosView of [1, 0.5, 0.2]) {
        const I = peakIntensities(target, fb, cosView, false);
        // screen-projected light inside D25, in units of R² (disk projected by cosView; bulge camera-facing)
        const diskLight = I.disk * K_DISK_IN * cosView;
        const bulgeLight = I.bulge * K_BULGE;
        const area = Math.PI * cosView;
        expect((diskLight + bulgeLight) / area).toBeCloseTo(target, 10);
      }
    }
    const S = peakIntensities(target, 0, 1, true);
    expect((S.disk * K_SPH_IN) / Math.PI).toBeCloseTo(target, 10);
  });
  it('integrals are what the shader assumes', () => {
    expect(K_DISK_IN).toBeCloseTo(radialIntegral(diskProfile, 1, 20000), 6);
    expect(K_BULGE).toBeCloseTo(radialIntegral(bulgeProfile, BULGE_QUAD, 20000), 6);
    expect(K_SPH_IN).toBeCloseTo(radialIntegral(spheroidProfile, 1, 20000), 6);
    expect(bulgeProfile(BULGE_QUAD)).toBe(0);
    expect(diskProfile(QUAD_R)).toBe(0);
  });
});
