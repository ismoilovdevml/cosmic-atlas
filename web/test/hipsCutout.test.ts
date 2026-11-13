import { describe, expect, it } from 'vitest';
import { DSS2_COLOR, chooseOrder, hips2fitsUrl, tanToRadec, tilePixel, xy2nest } from '../src/data/hipsCutout';

// [ra, dec, tile order, Npix, column, row-from-top]: from the numpy implementation whose tile
// layout was checked by correlating reprojected DSS2-colour tiles (IRSA mirror) with Legacy
// Surveys cutouts of M81, NGC 253 and NGC 1566 (scratch probe, 2026-11-13).
const REFS: [number, number, number, number, number, number][] = [
  [148.888, 69.065, 6, 7606, 186, 79],
  [11.888, -25.288, 6, 16655, 21, 486],
  [65.0017, -54.9378, 6, 33958, 59, 54],
  [10.68471, 41.26875, 4, 169, 7, 417],
  [80.894, -69.756, 2, 129, 89, 280],
  [201.365, -43.019, 5, 10815, 423, 213],
  [0.1, 0.1, 3, 304, 0, 9],
  [359.9, 89.9, 7, 65535, 372, 511],
  [180.0, -89.5, 3, 640, 43, 0],
];

describe('HEALPix / HiPS tile addressing', () => {
  it('xy2nest interleaves ix into even bits', () => {
    expect(xy2nest(1, 0)).toBe(1);
    expect(xy2nest(0, 1)).toBe(2);
    expect(xy2nest(3, 3)).toBe(15);
    expect(xy2nest(511, 0)).toBe(0x15555);
  });
  for (const [ra, dec, k, npix, col, row] of REFS) {
    it(`(${ra}, ${dec}) order ${k} -> Npix ${npix} (${col}, ${row})`, () => {
      expect(tilePixel(k, ra, dec)).toEqual({ npix, col, row });
    });
  }
});

describe('TAN cutout geometry', () => {
  it('east is +xi, north is +eta', () => {
    const [ra1, dec1] = tanToRadec(10, 40, 0, 0.01);
    expect(ra1).toBeCloseTo(10, 9);
    expect(dec1).toBeGreaterThan(40);
    const [ra2] = tanToRadec(10, 40, 0.01, 0);
    expect(ra2).toBeGreaterThan(10);
  });
  it('order follows the pixel size and stays within the survey', () => {
    expect(chooseOrder(4.45, 512, 9)).toBe(4); // M31 cutout
    expect(chooseOrder(0.5, 512, 9)).toBe(7);
    expect(chooseOrder(0.01, 512, 9)).toBe(9);
  });
  it('hips2fits request', () => {
    const u = new URL(hips2fitsUrl(DSS2_COLOR, 10.68471, 41.26875, 4.45, 512));
    expect(u.host).toBe('alasky.cds.unistra.fr');
    expect(u.searchParams.get('hips')).toBe('CDS/P/DSS2/color');
    expect(u.searchParams.get('projection')).toBe('TAN');
    expect(u.searchParams.get('format')).toBe('jpg');
  });
});
