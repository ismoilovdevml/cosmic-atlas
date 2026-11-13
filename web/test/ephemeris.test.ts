import { readFileSync } from 'node:fs';
import { JupiterMoons } from 'astronomy-engine';
import { describe, expect, it } from 'vitest';
import { ICRS_TO_GAL, mulMat3, type Vec3 } from '../src/math/frames';
import { PC_PER_AU } from '../src/math/units';
import { BODY_BY_ID } from '../src/solar/bodies';
import {
  bodyFrame, earthFrame, eqjAuToGalPc, flyTargetForLatLon, heliocentricPc, observerGalacticXyz, observerGeocentricPc,
  sampleOrbit, solarPositions, timeFromJdTdb,
} from '../src/solar/ephemeris';

/**
 * JPL Horizons vectors (DE441 / mar099 / jup365), fetched 2026-11-13; the request is stored in the
 * fixture: CENTER='500@10' (Sun centre; Io: '500@599'), REF_PLANE='FRAME', REF_SYSTEM='ICRF',
 * VEC_CORR='NONE', OUT_UNITS='AU-D', TLIST = JD TDB 2451545.0 and 2461357.5.
 */
const HZ = JSON.parse(readFileSync(new URL('./fixtures/horizons_planets.json', import.meta.url), 'utf8')) as {
  bodies: { name: string; id: number; center: string; vectors: { jd_tdb: number; xyz_au: Vec3 }[] }[];
};
const AU = PC_PER_AU;
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** printed so the evidence of each run is in the test log */
const report: string[] = [];

describe('astronomy-engine -> contract frame vs JPL Horizons', () => {
  for (const b of HZ.bodies.filter((x) => x.center === '500@10')) {
    for (const v of b.vectors) {
      it(`${b.name} at JD ${v.jd_tdb}: error < 1e-3 of the Sun distance`, () => {
        const t = timeFromJdTdb(v.jd_tdb);
        const ours = heliocentricPc(b.name.toLowerCase() as 'earth', t);
        const ref = eqjAuToGalPc(...v.xyz_au); // Horizons ICRF -> Galactic with the same matrix
        const rel = len(sub(ours, ref)) / len(ref);
        report.push(`${b.name} JD ${v.jd_tdb}: r=${(len(ref) / AU).toFixed(6)} AU, |d|=${((len(sub(ours, ref)) / AU) * 149597870.7).toFixed(0)} km, rel=${rel.toExponential(2)}`);
        expect(rel).toBeLessThan(1e-3);
        // the conversion lands in the contract frame: same l, b as converting Horizons' own vector
        const refGal = mulMat3(ICRS_TO_GAL, v.xyz_au);
        expect(dot(ours, refGal) / (len(ours) * len(refGal))).toBeGreaterThan(1 - 1e-6);
      });
    }
  }
  it('the Moon relative to the Earth: error < 1e-3 of the Earth-Moon distance', () => {
    const E = HZ.bodies.find((x) => x.name === 'Earth')!;
    const M = HZ.bodies.find((x) => x.name === 'Moon')!;
    for (let i = 0; i < E.vectors.length; i++) {
      const t = timeFromJdTdb(E.vectors[i].jd_tdb);
      const ours = sub(heliocentricPc('moon', t), heliocentricPc('earth', t));
      const ref = eqjAuToGalPc(...sub(M.vectors[i].xyz_au, E.vectors[i].xyz_au));
      const rel = len(sub(ours, ref)) / len(ref);
      report.push(`Moon-Earth JD ${E.vectors[i].jd_tdb}: ${((len(ref) / AU) * 149597870.7).toFixed(0)} km, |d|=${((len(sub(ours, ref)) / AU) * 149597870.7).toFixed(1)} km, rel=${rel.toExponential(2)}`);
      expect(rel).toBeLessThan(1e-3);
    }
  });
  it('Io relative to Jupiter (JupiterMoons, EQJ): error < 1 % of the orbit radius', () => {
    const Io = HZ.bodies.find((x) => x.name === 'Io')!;
    for (const v of Io.vectors) {
      const m = JupiterMoons(timeFromJdTdb(v.jd_tdb)).io;
      const d = len(sub([m.x, m.y, m.z], v.xyz_au)) / len(v.xyz_au);
      report.push(`Io-Jupiter JD ${v.jd_tdb}: |d|=${(len(sub([m.x, m.y, m.z], v.xyz_au)) * 149597870.7).toFixed(0)} km, rel=${d.toExponential(2)}`);
      expect(d).toBeLessThan(1e-2);
    }
  });
  it('report', () => {
    console.log(report.join('\n'));
  });
});

describe('positions and orbits', () => {
  it('solarPositions agrees with heliocentricPc for every body', () => {
    const t = timeFromJdTdb(2461357.5);
    const all = solarPositions(t);
    for (const id of ['earth', 'moon', 'mars', 'io', 'callisto', 'pluto'] as const) {
      expect(len(sub(all[id], heliocentricPc(id, t)))).toBeLessThan(1e-15);
    }
    expect(len(all.sun)).toBe(0);
  });
  it('an orbit sample is centred on the body and closes after one period', () => {
    const t = timeFromJdTdb(2461357.5);
    const n = 256;
    const o = sampleOrbit('mars', t, n);
    const mid: Vec3 = [o[(n / 2) * 3], o[(n / 2) * 3 + 1], o[(n / 2) * 3 + 2]];
    expect(len(sub(mid, heliocentricPc('mars', t)))).toBeLessThan(1e-15);
    const first: Vec3 = [o[0], o[1], o[2]];
    const last: Vec3 = [o[n * 3], o[n * 3 + 1], o[n * 3 + 2]];
    expect(len(sub(first, last)) / len(first)).toBeLessThan(2e-3);
    const moon = sampleOrbit('moon', t, 128);
    const r = len([moon[0], moon[1], moon[2]]) / AU * 149597870.7;
    expect(r).toBeGreaterThan(356000);
    expect(r).toBeLessThan(407000);
  });
});

describe('body orientation', () => {
  it('frames are orthonormal and right-handed', () => {
    const t = timeFromJdTdb(2461357.5);
    for (const id of ['earth', 'mars', 'saturn', 'uranus', 'moon', 'sun'] as const) {
      const f = bodyFrame(id, t);
      for (const a of [f.x, f.y, f.z]) expect(len(a)).toBeCloseTo(1, 12);
      expect(dot(f.x, f.y)).toBeCloseTo(0, 12);
      expect(dot(f.x, f.z)).toBeCloseTo(0, 12);
      const c: Vec3 = [f.x[1] * f.y[2] - f.x[2] * f.y[1], f.x[2] * f.y[0] - f.x[0] * f.y[2], f.x[0] * f.y[1] - f.x[1] * f.y[0]];
      expect(dot(c, f.z)).toBeCloseTo(1, 12);
    }
  });
  it("Earth's pole is the celestial pole (precessed): within 0.5 deg of the J2000 pole near 2026", () => {
    const f = earthFrame(new Date('2026-11-13T00:00:00Z'));
    const ncp = mulMat3(ICRS_TO_GAL, [0, 0, 1]);
    expect(Math.acos(dot(f.z, ncp)) * 180 / Math.PI).toBeLessThan(0.5);
  });
  it("Saturn's ring plane (equator) is tilted 26.7 deg from its orbit", () => {
    const t = timeFromJdTdb(2461357.5);
    const o = sampleOrbit('saturn', t, 64);
    const a: Vec3 = [o[0], o[1], o[2]];
    const b: Vec3 = [o[16 * 3], o[16 * 3 + 1], o[16 * 3 + 2]];
    const nrm: Vec3 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const tilt = Math.acos(Math.abs(dot(nrm, bodyFrame('saturn', t).z)) / len(nrm)) * 180 / Math.PI;
    expect(tilt).toBeGreaterThan(26);
    expect(tilt).toBeLessThan(27.5);
  });
});

/**
 * Tashkent (41.31 N, 69.28 E, 0 m) checked against astropy 8.0.2 in the repo .venv:
 *   EarthLocation.from_geodetic(69.28, 41.31, 0).get_gcrs(Time(t, scale='utc')), GCRS axes rotated
 *   to Galactic with the same ICRS->Galactic unit-vector transform (IERS UT1-UTC and polar
 *   motion applied by astropy). Values in km.
 */
const TASHKENT_ASTROPY: { utc: string; gal_km: Vec3 }[] = [
  { utc: '2026-11-13T12:00:00Z', gal_km: [1409.2951098585297, 6188.443260335054, 528.6426759764909] },
  { utc: '2026-06-21T03:30:00Z', gal_km: [-4393.411632729508, 4069.846869354179, -2167.1839924948954] },
];
const KM_PER_PC = 149597870.7 / PC_PER_AU;

describe('observer on the Earth (Show me)', () => {
  for (const c of TASHKENT_ASTROPY) {
    it(`Tashkent at ${c.utc} matches astropy GCRS->Galactic within 2 km`, () => {
      const d = new Date(c.utc);
      const geo = observerGeocentricPc(41.31, 69.28, 0, d).map((x) => x * KM_PER_PC) as Vec3;
      const err = len(sub(geo, c.gal_km));
      console.log(`Tashkent ${c.utc}: ours ${geo.map((x) => x.toFixed(1)).join(', ')} km, astropy ${c.gal_km.map((x) => x.toFixed(1)).join(', ')} km, |d| = ${err.toFixed(3)} km`);
      expect(err).toBeLessThan(2);
      // one Earth radius from the centre (WGS-84 radius at 41.3 deg is 6368.9 km)
      const p = observerGalacticXyz(41.31, 69.28, 0, d);
      const r = len(sub(p, heliocentricPc('earth', d))) * KM_PER_PC;
      expect(Math.abs(r - BODY_BY_ID.get('earth')!.radiusKm)).toBeLessThan(25);
    });
  }
  it('Tashkent faces the Sun at local afternoon and away from it after local midnight', () => {
    const side = (utc: string) => {
      const d = new Date(utc);
      const up = observerGeocentricPc(41.31, 69.28, 0, d);
      const toSun = sub([0, 0, 0], heliocentricPc('earth', d));
      return dot(up, toSun) / (len(up) * len(toSun));
    };
    expect(side('2026-11-13T09:00:00Z')).toBeGreaterThan(0.3); // 13:37 local mean time
    expect(side('2026-11-13T20:00:00Z')).toBeLessThan(-0.3); // 00:37
  });
  it('flyTargetForLatLon looks straight down from the requested altitude', () => {
    const d = new Date('2026-11-13T12:00:00Z');
    const v = flyTargetForLatLon(41.31, 69.28, d, 3000);
    expect(v.dist * KM_PER_PC).toBeCloseTo(3000, 6);
    const back: Vec3 = [Math.cos(v.pitch) * Math.cos(v.yaw), Math.cos(v.pitch) * Math.sin(v.yaw), Math.sin(v.pitch)];
    const up = observerGeocentricPc(41.31, 69.28, 0, d);
    expect(dot(back, up) / len(up)).toBeCloseTo(1, 12);
    const cam: Vec3 = [v.focus[0] + back[0] * v.dist, v.focus[1] + back[1] * v.dist, v.focus[2] + back[2] * v.dist];
    expect((len(sub(cam, heliocentricPc('earth', d))) * KM_PER_PC)).toBeCloseTo(6368.9 + 3000, 0);
  });
});
