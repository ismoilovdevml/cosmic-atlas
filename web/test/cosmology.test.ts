import { describe, expect, it } from 'vitest';
import { comovingDistancePc, lookbackTimeGyr, redshiftFromComoving, DH_PC, TH_GYR } from '../src/math/cosmology';

// astropy Planck18 values: DH, tH from astropy; distances by numpy-integrating Planck18.inv_efunc
// (200 001-point trapezoid; scipy is not installed in the .venv).
const REF: [number, number, number][] = [
  [0.003, 13283288.411136689, 0.043259450711724434],
  [0.01, 44205055.576618455, 0.1434620483589297],
  [0.1, 432565697.73835045, 1.3451981508948583],
  [0.5, 1946416634.7871387, 5.196239527326727],
  [1, 3395634471.1528325, 7.93554200211934],
  [2, 5308188883.89796, 10.510054917683373],
  [3, 6504003988.981786, 11.643131465070574],
];

describe('Planck18 cosmology', () => {
  it('Hubble distance and time match astropy', () => {
    expect(DH_PC / 4430866952.409104).toBeCloseTo(1, 9);
    expect(TH_GYR / 14.451555153425794).toBeCloseTo(1, 6);
  });
  for (const [z, dc, lb] of REF) {
    it(`z=${z}: comoving distance and lookback within 1e-4`, () => {
      expect(Math.abs(comovingDistancePc(z) / dc - 1)).toBeLessThan(1e-4);
      expect(Math.abs(lookbackTimeGyr(z) / lb - 1)).toBeLessThan(1e-4);
      expect(Math.abs(redshiftFromComoving(dc) - z) / z).toBeLessThan(2e-4);
    });
  }
});
