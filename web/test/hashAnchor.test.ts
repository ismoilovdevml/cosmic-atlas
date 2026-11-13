import { describe, expect, it } from 'vitest';
import { formatHash, parseHash } from '../src/state/hash';

describe('short anchored deep links', () => {
  it('writes at= and d= instead of raw coordinates when anchored', () => {
    const h = formatHash({
      view: { focus: [9.16129128e-7, -0.00000222977939, -8.83310132e-7], dist: 0.000238653, yawDeg: -150, pitchDeg: 20 },
      at: 'Saturn',
      look: { dist: 0.000238653, yawDeg: -150, pitchDeg: 20 },
    });
    expect(h).toBe('#at=Saturn&d=0.0002387,-150.0,20.0');
    expect(h).not.toContain('v=');
  });

  it('round-trips names with spaces and symbols', () => {
    const h = formatHash({ at: 'Sgr A*', look: { dist: 1e-3, yawDeg: 12.34, pitchDeg: -5 }, view: { focus: [0, 0, 0], dist: 1, yawDeg: 0, pitchDeg: 0 } });
    const p = parseHash(h);
    expect(p.at).toBe('Sgr A*');
    expect(p.look).toEqual({ dist: 0.001, yawDeg: 12.3, pitchDeg: -5 });
    expect(p.view).toBeUndefined();
  });

  it('still writes v= without an anchor, and old v= links still parse', () => {
    const h = formatHash({ view: { focus: [1, 2, 3], dist: 4, yawDeg: 5, pitchDeg: 6 } });
    expect(h.startsWith('#v=1,2,3,4,')).toBe(true);
    expect(parseHash('#v=1,2,3,4,5,6').view?.dist).toBe(4);
  });

  it('omits l= when no layer differs from its default', () => {
    expect(formatHash({ view: { focus: [0, 0, 0], dist: 1, yawDeg: 0, pitchDeg: 0 }, layers: {} })).not.toContain('l=');
    expect(formatHash({ view: { focus: [0, 0, 0], dist: 1, yawDeg: 0, pitchDeg: 0 }, layers: { 'galaxies-cf4': true } })).toContain('l=galaxies-cf4');
  });

  it('rejects malformed d=', () => {
    expect(parseHash('#at=Mars&d=0,1,2').look).toBeUndefined();
    expect(parseHash('#at=Mars&d=abc').look).toBeUndefined();
  });
});
