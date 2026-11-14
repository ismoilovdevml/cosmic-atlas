import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PC_PER_KMS_MYR, VEL_Q, closestApproach, halfToFloat, movedPosition, parseMeta, parseRenderRecords, parseVelocityRecords,
  readExtRecord,
} from '../src/tiles/format';
import {
  EPOCH_TICKS, MAX_YR, MIN_YR, RV_FADE_MIN, SLIDER_DEAD, SLIDER_MAX, StarEpoch, clampMyr, epochParts, myrToSlider, rvFade,
  sliderToMyr,
} from '../src/solar/epoch';

// three Gaia DR3 stars written by pipeline/build_tiles.py (Gl 710, Barnard's Star, and Barnard's
// astrometry without its RV as id 1); see tests/fixtures/gaia_dr3_gj710_barnard.json
const FIX = resolve(__dirname, 'fixtures/velocity');
const buf = (p: string) => {
  const b = readFileSync(resolve(FIX, p));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

describe('velocity stream (.vel.bin)', () => {
  it('decodes binary16 exactly', () => {
    expect(halfToFloat(0x3c00)).toBe(1);
    expect(halfToFloat(0xc000)).toBe(-2);
    expect(halfToFloat(0x7bff)).toBe(65504);
    expect(halfToFloat(0x0001)).toBe(2 ** -24);
    expect(halfToFloat(0x7c00)).toBe(Infinity);
    expect(halfToFloat(0x7e00)).toBeNaN();
    expect(halfToFloat(0x8000)).toBe(-0);
  });

  it('parses the meta.json velocity block and rejects unknown encodings', () => {
    const meta = parseMeta(JSON.parse(readFileSync(resolve(FIX, 'meta.json'), 'utf8')));
    expect(meta.velocity?.encoding).toBe('vx_vy_vz_q_f16');
    expect(meta.velocity?.sunVelocity).toEqual([0, 0, 0]);
    expect(meta.nodes[0].vmax).toBeGreaterThan(140);
    const bad = JSON.parse(readFileSync(resolve(FIX, 'meta.json'), 'utf8'));
    bad.velocity.encoding = 'vx_vy_vz_i16';
    expect(() => parseMeta(bad)).toThrow(/velocity encoding/);
    expect(() => parseVelocityRecords(new ArrayBuffer(12))).toThrow(/multiple of 8/);
    expect(() => parseVelocityRecords(new ArrayBuffer(16), 3)).toThrow(/3/);
  });

  it('reproduces the Gliese 710 close approach and Barnard\'s Star from the pipeline output', () => {
    const meta = parseMeta(JSON.parse(readFileSync(resolve(FIX, 'meta.json'), 'utf8')));
    const nd = meta.nodes[0];
    const rec = parseRenderRecords(buf('n/r.bin'), nd.count);
    const vel = parseVelocityRecords(buf('n/r.vel.bin'), nd.count);
    const ext = buf('n/r.ext.bin');
    const byId = new Map<string, number>();
    for (let i = 0; i < nd.count; i++) byId.set(readExtRecord(ext, i, meta.extBytesPerPoint).id.toString(), i);

    const g = byId.get('4270814637616488064')!;
    expect(vel[g * 4 + 3]).toBe(VEL_Q.full);
    const x0 = movedPosition(nd.center, rec.positions, vel, g, 0);
    const ca = closestApproach(x0, [vel[g * 4], vel[g * 4 + 1], vel[g * 4 + 2]]);
    // literature (DR3, orbit integration): 1.324 ± 0.026 Myr, 0.052 ± 0.002 pc (Bobylev & Bajkova 2022)
    expect(ca.tMyr).toBeGreaterThan(1.25);
    expect(ca.tMyr).toBeLessThan(1.4);
    expect(ca.dPc).toBeLessThan(0.08);
    const at = movedPosition(nd.center, rec.positions, vel, g, ca.tMyr);
    expect(Math.hypot(...at)).toBeCloseTo(ca.dPc, 6);

    // Barnard's Star: 110 km/s toward us, distance after 10 kyr; the RV-less copy is tangential-only
    const b = byId.get('4472832130942575872')!;
    const b10 = movedPosition(nd.center, rec.positions, vel, b, 0.01);
    expect(Math.hypot(...b10)).toBeGreaterThan(1.1);
    expect(Math.hypot(...b10)).toBeLessThan(1.2);
    const t = byId.get('1')!;
    expect(vel[t * 4 + 3]).toBe(VEL_Q.tangential);
    const p0 = movedPosition(nd.center, rec.positions, vel, t, 0);
    const v = [vel[t * 4], vel[t * 4 + 1], vel[t * 4 + 2]];
    const d0 = Math.hypot(...p0);
    expect(Math.abs((p0[0] * v[0] + p0[1] * v[1] + p0[2] * v[2]) / d0)).toBeLessThan(0.05); // no radial part (f16 rounding)
  });

  it('subtracts the Sun\'s velocity for LSR streams', () => {
    const pos = new Float32Array([10, 0, 0]);
    const vel = new Float32Array([11.1, 12.24, 7.25, 1]);
    // the stream is float32 here, the Sun's velocity float64: equal to ~1e-6 km/s
    movedPosition([0, 0, 0], pos, vel, 0, 1, [11.1, 12.24, 7.25]).forEach((c, k) => expect(c).toBeCloseTo([10, 0, 0][k], 5));
    const p = movedPosition([5, 0, 0], pos, vel, 0, 2);
    expect(p[1]).toBeCloseTo(12.24 * 2 * PC_PER_KMS_MYR, 5);
    expect(movedPosition([0, 0, 0], pos, null, 0, 1)).toEqual([10, 0, 0]);
  });
});

describe('star epoch slider', () => {
  it('has a "now" dead zone and spans 100 yr … 1 Myr logarithmically on both sides', () => {
    expect(sliderToMyr(0)).toBe(0);
    expect(sliderToMyr(SLIDER_DEAD)).toBe(0);
    expect(sliderToMyr(SLIDER_MAX)).toBeCloseTo(1, 12);
    expect(sliderToMyr(-SLIDER_MAX)).toBeCloseTo(-1, 12);
    expect(sliderToMyr(SLIDER_DEAD + 1e-9) * 1e6).toBeCloseTo(MIN_YR, 3);
    // equal steps per decade
    const mid = (SLIDER_DEAD + SLIDER_MAX) / 2;
    expect(sliderToMyr(mid) * 1e6).toBeCloseTo(Math.sqrt(MIN_YR * MAX_YR), 3);
    for (const yr of EPOCH_TICKS) if (yr) expect(sliderToMyr(myrToSlider(yr / 1e6)) * 1e6).toBeCloseTo(yr, 3);
    expect(myrToSlider(0)).toBe(0);
    expect(myrToSlider(5)).toBe(SLIDER_MAX);
    expect(clampMyr(-7)).toBe(-1);
    expect(clampMyr(NaN)).toBe(0);
  });

  it('formats Δt in yr / kyr / Myr with 3 significant digits', () => {
    expect(epochParts(0)).toEqual({ sign: 0, value: 0, unit: 'yr' });
    expect(epochParts(250e-6)).toEqual({ sign: 1, value: 250, unit: 'yr' });
    expect(epochParts(-0.0123)).toEqual({ sign: -1, value: 12.3, unit: 'kyr' });
    expect(epochParts(1.2935)).toEqual({ sign: 1, value: 1.29, unit: 'Myr' });
    expect(epochParts(0.9999)).toEqual({ sign: 1, value: 1, unit: 'Myr' });
  });

  it('notifies on change, clamps, and fades RV-less stars with |Δt| / d', () => {
    const e = new StarEpoch();
    let n = 0;
    e.onChange(() => n++);
    e.set(0.5);
    e.set(0.5);
    e.set(3);
    expect(n).toBe(2);
    expect(e.myr).toBe(1);
    expect(e.active).toBe(true);
    expect(rvFade(0, 10)).toBe(1);
    expect(rvFade(0.001, 100)).toBeGreaterThan(0.99);
    expect(rvFade(1, 10)).toBe(RV_FADE_MIN);
    expect(rvFade(0.1, 50)).toBeLessThan(rvFade(0.1, 100));
  });
});
