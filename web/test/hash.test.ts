import { describe, expect, it } from 'vitest';
import { formatHash, parseHash, type HashState } from '../src/state/hash';

describe('deep link', () => {
  it('round-trips view, layer visibility and a point selection by stable id', () => {
    const s: HashState = {
      view: { focus: [8275, -0.125, 12.5], dist: 70000, yawDeg: -90, pitchDeg: 80 },
      layers: { 'galaxies-desi': true, 'galaxies-cf4': false, 'milky-way-model': true },
      sel: { type: 'point', layer: 'galaxies-desi', id: '39627835576420141', xyz: [-123456789.123, 98765432.1, -5.5] },
    };
    const h = formatHash(s);
    expect(h).toContain('sel=galaxies-desi:39627835576420141@');
    expect(h).toContain('l=galaxies-desi,~galaxies-cf4,milky-way-model');
    const back = parseHash(h);
    expect(back.layers).toEqual(s.layers);
    expect(back.view!.dist).toBe(70000);
    expect(back.view!.focus).toEqual([8275, -0.125, 12.5]);
    expect(back.sel).toEqual({ ...s.sel, xyz: [-123456789.1, 98765432.1, -5.5] });
  });
  it('keeps a 64-bit Gaia source_id exactly (string, not a float)', () => {
    const id = '4472832130942575872';
    const back = parseHash(formatHash({ sel: { type: 'point', layer: 'stars-gaia', id, xyz: [1, 2, 3] } }));
    expect(back.sel).toMatchObject({ type: 'point', id });
    expect(BigInt((back.sel as { id: string }).id)).toBe(4472832130942575872n);
  });
  it('round-trips the star epoch in years and rejects values off the slider', () => {
    expect(parseHash(formatHash({ epochYr: -1e6 })).epochYr).toBe(-1e6);
    expect(parseHash(formatHash({ epochYr: 1293500 / 1.0 })).epochYr).toBeUndefined(); // > 1 Myr
    expect(parseHash(formatHash({ epochYr: 12345.678 })).epochYr).toBe(12350);
    expect(formatHash({ epochYr: 0 })).toBe('');
    expect(parseHash('#ty=abc').epochYr).toBeUndefined();
  });
  it('round-trips the thin-slab setting', () => {
    expect(parseHash(formatHash({ slab: 25 })).slab).toBe(25);
    expect(parseHash(formatHash({ slab: 0 })).slab).toBeUndefined();
  });
  it('round-trips catalogue selections with awkward names', () => {
    const back = parseHash(formatHash({ sel: { type: 'cat', name: 'Andromeda (M31) & co/α' } }));
    expect(back.sel).toEqual({ type: 'cat', name: 'Andromeda (M31) & co/α' });
  });
  it('still reads the round-1 link format and ignores junk', () => {
    expect(parseHash('#v=0,0,0,1,-150,18').view).toEqual({ focus: [0, 0, 0], dist: 1, yawDeg: -150, pitchDeg: 18 });
    expect(parseHash('#v=1,2,3,-5,0,0').view).toBeUndefined();
    expect(parseHash('#sel=stars-gaia:12x@1,2,3').sel).toBeUndefined();
  });
});
