import { readFileSync } from 'node:fs';
import { json2satrec, type OMMJsonObject } from '../src/solar/satellitejs';
import { describe, expect, it } from 'vitest';
import { ICRS_TO_GAL, mulMat3, type Vec3 } from '../src/math/frames';
import { MU_EARTH, conicPosition, elementsFromState } from '../src/solar/kepler';
import { mat3Apply, satGeocentricGalKm, sgp4Teme, temeToGal } from '../src/solar/sgp4frame';

/**
 * The ISS from its CelesTrak GP element set (satellite.js SGP4 -> TEME -> Galactic via GMST and
 * the Earth frame) against JPL Horizons' geocentric ICRF vectors for the same UT instants
 * (fixture: scripts/fetch_horizons_fixtures.py). Horizons' ISS trajectory is itself TLE-based,
 * so near the epoch this mostly checks the frame chain and the time scales.
 */
const FX = JSON.parse(readFileSync(new URL('./fixtures/horizons_iss.json', import.meta.url), 'utf8')) as {
  omm: OMMJsonObject;
  hours_after_epoch: number[];
  vectors: { jd_ut: number; xyz_km: Vec3; vel_kms: Vec3 }[];
};
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const msOf = (jdUt: number) => (jdUt - 2440587.5) * 86400000;
const report: string[] = [];

describe('ISS: SGP4 + frame chain vs JPL Horizons', () => {
  const rec = json2satrec(FX.omm);
  FX.vectors.forEach((v, k) => {
    const h = FX.hours_after_epoch[k];
    it(`${h} h after the element epoch`, () => {
      const ms = msOf(v.jd_ut);
      const ours = satGeocentricGalKm(rec, ms)!;
      const ref = mulMat3(ICRS_TO_GAL, v.xyz_km);
      const d = len(sub(ours, ref));
      report.push(`ISS +${String(h).padStart(2)} h: |r| ${len(ref).toFixed(1)} km, |ours - Horizons| = ${d.toFixed(3)} km`);
      // "within a few km" near the epoch; SGP4 drift from drag mismodelling grows with element age
      expect(d).toBeLessThan(h <= 6 ? 3 : h <= 24 ? 10 : 40);
    });
  });
  it('the GPU path: two-body from an SGP4 state stays within 0.1 km over 2 s (one refresh cycle at x1)', () => {
    const ms = msOf(FX.vectors[0].jd_ut);
    const s = sgp4Teme(rec, ms)!;
    const el = elementsFromState(s.r, s.v, MU_EARTH);
    for (const dt of [0.5, 2]) {
      const kep = mat3Apply(temeToGal(ms + dt * 1000), conicPosition(el, dt, MU_EARTH));
      const sg = satGeocentricGalKm(rec, ms + dt * 1000)!;
      const d = len(sub(kep, sg));
      report.push(`ISS two-body from SGP4 state, +${dt} s: ${(d * 1000).toFixed(1)} m from SGP4`);
      expect(d).toBeLessThan(0.1);
    }
    // and how far it drifts over 10 minutes (what x1e4 time speed would show between refreshes)
    const kep = mat3Apply(temeToGal(ms + 600e3), conicPosition(el, 600, MU_EARTH));
    report.push(`ISS two-body from SGP4 state, +600 s: ${len(sub(kep, satGeocentricGalKm(rec, ms + 600e3)!)).toFixed(2)} km from SGP4`);
  });
  it('GP (SGP4) vs CelesTrak SupGP fitted to the ISS operator ephemeris: within a few km near the epoch', () => {
    // an independent source: SupGP segments are fitted to NASA's ISS ephemeris (RMS 0.07-0.2 km),
    // so their difference from the public GP set is the GP element error plus the segment fit
    const SUP = JSON.parse(readFileSync(new URL('./fixtures/celestrak_supgp_iss.json', import.meta.url), 'utf8')) as { segments: OMMJsonObject[] };
    const segs = SUP.segments.map((o) => ({ ms: Date.parse(`${o.EPOCH}Z`), rec: json2satrec(o) }));
    const ep = Date.parse(`${FX.omm.EPOCH}Z`);
    for (const h of [0, 1, 6, 24, 72]) {
      const ms = ep + h * 3600e3;
      // the latest segment that starts before ms (each segment covers the hours after its epoch)
      const seg = segs.filter((s) => s.ms <= ms).sort((a, b) => b.ms - a.ms)[0];
      const d = len(sub(satGeocentricGalKm(rec, ms)!, satGeocentricGalKm(seg.rec, ms)!));
      report.push(`ISS GP vs SupGP +${String(h).padStart(2)} h (segment ${new Date(seg.ms).toISOString().slice(0, 16)}): ${d.toFixed(2)} km`);
      if (h <= 6) expect(d).toBeLessThan(5);
    }
  });
  it('report', () => console.log(report.join('\n')));
});
