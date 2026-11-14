import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ICRS_TO_GAL, mulMat3, type Vec3 } from '../src/math/frames';
import { ECL_TO_GAL, MU_EARTH, MU_SUN, conicPosition, eclToGal, elementsFromState, periodDays } from '../src/solar/kepler';

/**
 * Two-body propagation of the packed MPC elements (scripts/build_small_bodies.py) against JPL
 * Horizons (fixture: scripts/fetch_horizons_fixtures.py). Horizons integrates the full N-body
 * problem, so the difference is the error of the viewer's model, which grows with the time from
 * the element epoch. Both float64 (CPU twin) and a float32 emulation of the shader are checked.
 */
const HZ = JSON.parse(readFileSync(new URL('./fixtures/horizons_smallbodies.json', import.meta.url), 'utf8')) as {
  ref_epoch_jd_tt: number;
  bodies: { name: string; packed: { el: number[] }; vectors: { jd_tdb: number; xyz_au: Vec3 }[] }[];
};
const KM_PER_AU = 149597870.7;
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const report: string[] = [];

function oursGal(el: number[], jd: number, f32: boolean): Vec3 {
  // TDB vs TT: < 2 ms, ignored
  const p = conicPosition(el, jd - HZ.ref_epoch_jd_tt, MU_SUN, [0, 0, 0], f32);
  return eclToGal(p);
}

describe('small bodies: two-body vs JPL Horizons', () => {
  /** limits (AU) as a function of |t - epoch|: the spec's 1e-3 AU within months, looser beyond */
  const limit = (name: string, dDays: number) => {
    const a = Math.abs(dDays);
    if (name === 'Apophis' && a > 1000) return Infinity; // the 2029-04-13 Earth flyby: two-body is meaningless after it (reported)
    if (a <= 200) return 1e-3;
    if (a <= 400) return 3e-3;
    if (a <= 800) return 1.5e-2;
    return 0.1;
  };
  for (const b of HZ.bodies) {
    it(`${b.name}: within the limit at every date`, () => {
      for (const v of b.vectors) {
        const d = v.jd_tdb - HZ.ref_epoch_jd_tt;
        const ref = mulMat3(ICRS_TO_GAL, v.xyz_au);
        const e64 = len(sub(oursGal(b.packed.el, v.jd_tdb, false), ref));
        const e32 = len(sub(oursGal(b.packed.el, v.jd_tdb, true), ref));
        report.push(`${b.name.padEnd(8)} t-epoch ${String(d).padStart(5)} d  r=${len(ref).toFixed(3)} AU  f64 ${e64.toExponential(2)} AU (${(e64 * KM_PER_AU).toFixed(0)} km)  f32 ${e32.toExponential(2)} AU`);
        expect(e64, `${b.name} at ${d} d`).toBeLessThan(limit(b.name, d));
        // the shader's float32 adds little on top of the model error near the epoch
        expect(Math.abs(e32 - e64), `${b.name} f32 at ${d} d`).toBeLessThan(Math.max(2e-5 * len(ref), 0.05 * e64));
      }
    });
  }
  it('two dates the spec asks about (2026-11-14 and 2027-05-14): < 1e-3 AU / < 3e-3 AU', () => {
    for (const b of HZ.bodies) {
      for (const [jd, lim] of [[2461358.5, 1e-3], [2461539.5, 3e-3]] as const) {
        const v = b.vectors.find((x) => Math.abs(x.jd_tdb - jd) < 1e-6)!;
        expect(len(sub(oursGal(b.packed.el, jd, false), mulMat3(ICRS_TO_GAL, v.xyz_au))), `${b.name} ${jd}`).toBeLessThan(lim);
      }
    }
  });
  it('report', () => console.log(report.join('\n')));
});

describe('kepler solver', () => {
  it('a circular orbit returns to its start after one period', () => {
    const el = [1, 0, 0.3, 1, 2, 0];
    const P = periodDays(1, 0);
    expect(P).toBeCloseTo(365.2569, 3);
    const a = conicPosition(el, 0, MU_SUN);
    const b = conicPosition(el, P, MU_SUN);
    expect(len(sub(a, b))).toBeLessThan(1e-12);
  });
  it('parabola and hyperbola: r = q at perihelion and r grows on both sides', () => {
    for (const e of [1, 1.2, 6.1]) {
      const el = [1.35, e, 2.3, 5.6, 2.2, 10];
      expect(len(conicPosition(el, 10, MU_SUN))).toBeCloseTo(1.35, 9);
      expect(len(conicPosition(el, 110, MU_SUN))).toBeGreaterThan(1.35);
      expect(len(conicPosition(el, -90, MU_SUN))).toBeGreaterThan(1.35);
    }
  });
  it('vis-viva: speed from finite differences matches sqrt(mu (2/r - 1/a)) for e = 0.97 (Halley-like)', () => {
    const el = [0.5725, 0.9679, 2.83, 1.04, 1.96, 0];
    const a = 0.5725 / (1 - 0.9679);
    for (const t of [3, 400, 13000]) {
      const p0 = conicPosition(el, t - 1e-4, MU_SUN);
      const p1 = conicPosition(el, t + 1e-4, MU_SUN);
      const v = len(sub(p1, p0)) / 2e-4;
      const r = len(conicPosition(el, t, MU_SUN));
      expect(v / Math.sqrt(MU_SUN * (2 / r - 1 / a))).toBeCloseTo(1, 6);
    }
  });
  it('elementsFromState inverts conicPosition (ISS-like and Molniya-like orbits, km/s)', () => {
    for (const el of [[6750, 0.0007, 0.9, 4.8, 0.4, -1200], [7000, 0.72, 1.1, 0.3, 4.7, 3000]]) {
      const r = conicPosition(el, 500, MU_EARTH);
      const r2 = conicPosition(el, 500.01, MU_EARTH);
      const r0 = conicPosition(el, 499.99, MU_EARTH);
      const v: Vec3 = [(r2[0] - r0[0]) / 0.02, (r2[1] - r0[1]) / 0.02, (r2[2] - r0[2]) / 0.02];
      const back = elementsFromState(r, v, MU_EARTH);
      // propagate the recovered elements (tp relative to t = 500) forward by 1000 s
      const p = conicPosition(back, 1000, MU_EARTH);
      const want = conicPosition(el, 1500, MU_EARTH);
      expect(len(sub(p, want))).toBeLessThan(0.05); // km
    }
  });
  it('ECL_TO_GAL is a rotation and sends the ecliptic pole to l = 96.38, b = 29.81', () => {
    const z = eclToGal([0, 0, 1]);
    const l = (Math.atan2(z[1], z[0]) * 180) / Math.PI;
    const b = (Math.asin(z[2]) * 180) / Math.PI;
    expect(l).toBeCloseTo(96.38, 2);
    expect(b).toBeCloseTo(29.81, 2);
    let s = 0;
    for (let i = 0; i < 9; i++) s += ECL_TO_GAL[i] ** 2;
    expect(s).toBeCloseTo(3, 12);
  });
});
