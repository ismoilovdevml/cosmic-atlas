import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import type { Vec3 } from '../src/math/frames';
import { bodyFrame, heliocentricPc, timeFromJdTdb } from '../src/solar/ephemeris';
import { angleDeg, bodyToGal, bodyToLatLon, detic2centric, galToBody, latLonToBody, latLonToGal } from '../src/solar/surface/geo';
import { ancestor, globalRect, subRect, tileAt, tileBounds, tileDeg } from '../src/solar/surface/tiles';
import { parseFeatures } from '../src/solar/features';

/**
 * JPL Horizons sub-observer (Earth geocentre) and sub-solar points of the Moon (MOON_ME frame,
 * DE441) and Mars (IAU_MARS), fetched 2026-11-14; the request is stored in the fixture. They are
 * an independent implementation of the body orientation that our lat/lon -> body-fixed ->
 * Galactic transform (bodyFrame() + geo.ts) has to reproduce.
 */
const HZ = JSON.parse(readFileSync(new URL('./fixtures/horizons_subpoints.json', import.meta.url), 'utf8')) as {
  bodies: {
    name: 'moon' | 'mars'; longitude_positive: 'east' | 'west'; radii_km: [number, number, number];
    rows: { jd_tt: number; obs_sub_lon: number; obs_sub_lat: number; sun_sub_lon: number; sun_sub_lat: number; lt_min: number }[];
  }[];
};

const report: string[] = [];
afterAll(() => console.log(`\nsurface frame checks:\n  ${report.join('\n  ')}`));

const unit = (a: Vec3): Vec3 => {
  const r = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / r, a[1] / r, a[2] / r];
};

/** Horizons row -> planetocentric east lat/lon */
function hzLatLon(b: (typeof HZ.bodies)[number], lat: number, lon: number) {
  const lonE = b.longitude_positive === 'west' ? (360 - lon) % 360 : lon;
  return { lat: detic2centric(lat, b.radii_km[0], b.radii_km[2]), lon: lonE };
}

/** our sub-Earth and sub-solar directions (Galactic) and the frame at the light-time-retarded epoch */
function ours(body: 'moon' | 'mars', jd: number, ltMin: number) {
  const t = timeFromJdTdb(jd);
  const tr = t.AddDays(-ltMin / 1440);
  const p = heliocentricPc(body, tr);
  const e = heliocentricPc('earth', t);
  const f = bodyFrame(body, tr);
  return { f, toEarth: unit([e[0] - p[0], e[1] - p[1], e[2] - p[2]]), toSun: unit([-p[0], -p[1], -p[2]]) };
}

describe('lat/lon -> body-fixed -> Galactic vs JPL Horizons sub-points', () => {
  // measured 2026-11-14: sub-Earth <= 0.0021 deg, sub-solar <= 0.0058 deg (0.34 km on Mars; the
  // sub-solar residual is the Sun's aberration / light time, which Horizons applies and we do not)
  const TOL = { moon: 0.02, mars: 0.02 };
  for (const b of HZ.bodies) {
    for (const r of b.rows) {
      it(`${b.name} JD ${r.jd_tt}: sub-Earth and sub-solar points within ${TOL[b.name]} deg`, () => {
        const o = ours(b.name, r.jd_tt, r.lt_min);
        for (const [what, dir, lat, lon] of [
          ['sub-Earth', o.toEarth, r.obs_sub_lat, r.obs_sub_lon],
          ['sub-solar', o.toSun, r.sun_sub_lat, r.sun_sub_lon],
        ] as const) {
          const ref = hzLatLon(b, lat, lon);
          const refGal = latLonToGal(o.f, ref.lat, ref.lon);
          const err = angleDeg(refGal, dir);
          const got = bodyToLatLon(galToBody(o.f, dir));
          report.push(`${b.name} JD ${r.jd_tt} ${what}: ours (${got.lat.toFixed(4)}, ${got.lon.toFixed(4)}) Horizons (${ref.lat.toFixed(4)}, ${ref.lon.toFixed(4)}) -> ${err.toFixed(4)} deg = ${(err * Math.PI / 180 * (b.name === 'moon' ? 1737.4 : 3389.5)).toFixed(2)} km on the surface`);
          expect(err).toBeLessThan(TOL[b.name]);
        }
      });
    }
  }
});

describe('named features land where the gazetteer says', () => {
  // the coordinates given in the task brief (planetocentric, east-positive)
  const FEATURES = [
    { body: 'moon' as const, name: 'Tycho', lat: -43.31, lon: -11.36 },
    { body: 'moon' as const, name: 'Apollo 11', lat: 0.674, lon: 23.473 },
    { body: 'mars' as const, name: 'Olympus Mons', lat: 18.65, lon: 226.2 },
    { body: 'mars' as const, name: 'Gale crater', lat: -5.4, lon: 137.8 },
  ];
  for (const ft of FEATURES) {
    it(`${ft.name}: round trip and great-circle distance from the Horizons sub-Earth point`, () => {
      const b = HZ.bodies.find((x) => x.name === ft.body)!;
      const r = b.rows[1]; // 2026-11-13
      const o = ours(ft.body, r.jd_tt, r.lt_min);
      const g = latLonToGal(o.f, ft.lat, ft.lon);
      expect(Math.hypot(...g)).toBeCloseTo(1, 12);
      // round trip through the Galactic frame
      const back = bodyToLatLon(galToBody(o.f, g));
      expect(back.lat).toBeCloseTo(ft.lat, 9);
      expect(((back.lon - ft.lon) % 360 + 540) % 360 - 180).toBeCloseTo(0, 9);
      // angular distance feature <-> sub-Earth point: in Galactic (our frame) vs on the sphere (Horizons' lat/lon)
      const sub = hzLatLon(b, r.obs_sub_lat, r.obs_sub_lon);
      const onSphere = angleDeg(latLonToBody(ft.lat, ft.lon), latLonToBody(sub.lat, sub.lon));
      const inGal = angleDeg(g, o.toEarth);
      report.push(`${ft.name}: Galactic (${g.map((v) => v.toFixed(6)).join(', ')}), ${inGal.toFixed(4)} deg from the sub-Earth point (Horizons lat/lon: ${onSphere.toFixed(4)})`);
      expect(Math.abs(inGal - onSphere)).toBeLessThan(0.05);
      // and it is on the near side of the Moon for Apollo 11 / Tycho (they face Earth)
      if (ft.body === 'moon') expect(inGal).toBeLessThan(60);
    });
  }

  it('bodyToGal and galToBody are inverse rotations', () => {
    const f = bodyFrame('mars', timeFromJdTdb(2461357.5));
    const v: Vec3 = [0.3, -0.5, 0.81];
    const w = galToBody(f, bodyToGal(f, v));
    for (let k = 0; k < 3; k++) expect(w[k]).toBeCloseTo(v[k], 14);
  });
});

describe('geographic tile pyramid', () => {
  it('level 0 is 2 x 1 tiles of 180 deg, rows from the north', () => {
    expect(tileDeg(0)).toBe(180);
    expect(tileBounds(0, 0, 0)).toEqual({ lon0: -180, lon1: 0, lat0: -90, lat1: 90 });
    expect(tileBounds(0, 1, 0)).toEqual({ lon0: 0, lon1: 180, lat0: -90, lat1: 90 });
    expect(tileBounds(3, 0, 0)).toEqual({ lon0: -180, lon1: -157.5, lat0: 67.5, lat1: 90 });
  });
  it('tileAt finds the tile under Tycho, Olympus Mons (lon > 180 E) and Gale', () => {
    for (const [lat, lon] of [[-43.31, -11.36], [18.65, 226.2], [-5.4, 137.8], [0.674, 23.473]]) {
      for (const z of [0, 4, 8, 12]) {
        const t = tileAt(z, lat, lon);
        const b = tileBounds(t.z, t.x, t.y);
        const lonW = ((lon + 180) % 360 + 360) % 360 - 180;
        expect(lonW).toBeGreaterThanOrEqual(b.lon0);
        expect(lonW).toBeLessThan(b.lon1);
        expect(lat).toBeGreaterThanOrEqual(b.lat0);
        expect(lat).toBeLessThan(b.lat1);
      }
    }
    // Gale at level 12: (90 + 5.4) / (180 / 4096) = 2170.9 -> row 2170; (137.8 + 180) / (180 / 4096) = 7231.9 -> col 7231
    expect(tileAt(12, -5.4, 137.8)).toEqual({ z: 12, x: 7231, y: 2170 });
  });
  it('subRect maps a child onto the right quarter of its parent (v up = north)', () => {
    // (1, 0, 0) is the north-west quarter of (0, 0, 0): u 0..0.5, v 0.5..1
    expect(subRect(1, 0, 0, 0)).toEqual({ off: [0, 0.5], scale: 0.5 });
    expect(subRect(1, 1, 1, 0)).toEqual({ off: [0.5, 0], scale: 0.5 });
    expect(ancestor(5, 21, 9, 2)).toEqual({ z: 2, x: 2, y: 1 });
    // a point's uv inside the child equals its uv inside the ancestor
    const lat = -43.31, lon = -11.36;
    const c = tileAt(6, lat, lon);
    const bc = tileBounds(c.z, c.x, c.y);
    const uvC = [(lon - bc.lon0) / (bc.lon1 - bc.lon0), (lat - bc.lat0) / (bc.lat1 - bc.lat0)];
    const a = ancestor(c.z, c.x, c.y, 2);
    const ba = tileBounds(a.z, a.x, a.y);
    const uvA = [(lon - ba.lon0) / (ba.lon1 - ba.lon0), (lat - ba.lat0) / (ba.lat1 - ba.lat0)];
    const s = subRect(c.z, c.x, c.y, 2);
    expect(s.off[0] + uvC[0] * s.scale).toBeCloseTo(uvA[0], 12);
    expect(s.off[1] + uvC[1] * s.scale).toBeCloseTo(uvA[1], 12);
    // and inside the global map
    const g = globalRect(c.z, c.x, c.y);
    expect(g.off[0] + uvC[0] * g.scale[0]).toBeCloseTo((lon + 180) / 360, 12);
    expect(g.off[1] + uvC[1] * g.scale[1]).toBeCloseTo((lat + 90) / 180, 12);
  });
});

describe('planet-features.json (scripts/build_planet_features.py)', () => {
  const rows = parseFeatures(JSON.parse(readFileSync(new URL('../../data/tiles/catalogs/planet-features.json', import.meta.url), 'utf8')));
  const find = (q: string) => rows.find((f) => f.name === q || f.alt.includes(q));
  it("has the brief's features, and their uz / ru search names", () => {
    expect(rows.length).toBeGreaterThan(500);
    const cases: [string, 'moon' | 'mars', number, number][] = [
      ['Tixo', 'moon', -43.31, 348.64], ['Тихо', 'moon', -43.31, 348.64], ['Apollo 11', 'moon', 0.674, 23.473],
      ['Olympus Mons', 'mars', 18.65, 226.2], ['Gale', 'mars', -5.4, 137.8],
    ];
    for (const [q, body, lat, lon] of cases) {
      const f = find(q);
      expect(f, q).toBeTruthy();
      expect(f!.body).toBe(body);
      // gazetteer centre vs the brief's rounded coordinates: within 0.2 deg
      expect(angleDeg(latLonToBody(f!.lat, f!.lon), latLonToBody(lat, lon))).toBeLessThan(0.2);
    }
    expect(find('Tycho')!.names.uz).toBe('Tixo');
    // Uzbek labels use U+02BB for oʻ / gʻ
    expect(find('Ulugh Beigh')!.names.uz).toBe('Ulugʻbek');
  });
});
