import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../src/math/frames';
import { PC_PER_AU } from '../src/math/units';
import { eqjAuToGalPc } from '../src/solar/ephemeris';
import { interpolateTrack, parseSpacecraft, trackSpan } from '../src/solar/spacecraft';

const crafts = parseSpacecraft(JSON.parse(readFileSync(new URL('../../data/tiles/catalogs/spacecraft.json', import.meta.url), 'utf8')));
const KM_PER_PC = 149597870.7 / PC_PER_AU;
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * Off-grid JPL Horizons vectors (not in the 30-day track), fetched 2026-11-13:
 * COMMAND='-31' / '-98', CENTER='500@10', REF_PLANE='FRAME', REF_SYSTEM='ICRF', VEC_TABLE='1',
 * VEC_CORR='NONE', OUT_UNITS='AU-D', TLIST='2454160.5' '2461357.5' (JD TDB). ICRF AU.
 */
const OFF_GRID: { name: string; jd: number; au: Vec3; tol: number }[] = [
  { name: 'Voyager 1', jd: 2454160.5, au: [-2.358202388969970e1, -9.683843879356621e1, 2.141765141234810e1], tol: 1e-4 },
  { name: 'Voyager 1', jd: 2461357.5, au: [-3.221442308046873e1, -1.653194181956192e2, 3.649020851607951e1], tol: 1e-4 },
  // one day after the closest approach to Jupiter (2007-02-28): 30-day samples cannot resolve the
  // gravity assist, so this cell is off by ~1.4 million km (documented as approximate)
  { name: 'New Horizons', jd: 2454160.5, au: [-2.094633106191739, -4.548780459817894, -1.900682415200825], tol: 3e-3 },
  { name: 'New Horizons', jd: 2461357.5, au: [2.097897057349379e1, -5.833747244409552e1, -2.278255953454630e1], tol: 1e-4 },
];

describe('spacecraft tracks (JPL Horizons, 30-day samples)', () => {
  it('has the five probes with provenance and the 2000-2040 span (New Horizons from launch)', () => {
    expect(crafts.map((c) => c.name).sort()).toEqual(['New Horizons', 'Pioneer 10', 'Pioneer 11', 'Voyager 1', 'Voyager 2']);
    for (const c of crafts) {
      const [a, b] = trackSpan(c.track);
      expect(b).toBeGreaterThan(2466000); // ~2039-12
      expect(a).toBeLessThan(c.name === 'New Horizons' ? 2453760 : 2451546);
      expect(c.provenance?.service).toContain('horizons');
    }
  });
  it('interpolation returns the samples at the nodes and null outside the track', () => {
    const t = crafts[0].track;
    const p = interpolateTrack(t, t.t0_jd_tdb + 30 * 7)!.pos;
    expect(p).toEqual([t.xyz_pc[21], t.xyz_pc[22], t.xyz_pc[23]]);
    expect(interpolateTrack(t, t.t0_jd_tdb - 1)).toBeNull();
    expect(interpolateTrack(t, trackSpan(t)[1] + 1)).toBeNull();
  });
  for (const o of OFF_GRID) {
    it(`${o.name} at JD ${o.jd} matches an off-grid Horizons vector`, () => {
      const c = crafts.find((x) => x.name === o.name)!;
      const r = interpolateTrack(c.track, o.jd)!;
      const ref = eqjAuToGalPc(...o.au);
      const err = dist(r.pos, ref) * KM_PER_PC;
      const rAU = Math.hypot(...ref) / PC_PER_AU;
      console.log(`${o.name} JD ${o.jd}: r = ${rAU.toFixed(3)} AU, interpolation error ${err.toFixed(0)} km (${(err / (rAU * 149597870.7)).toExponential(2)} of r)`);
      expect(err / (rAU * 149597870.7)).toBeLessThan(o.tol);
    });
  }
});
