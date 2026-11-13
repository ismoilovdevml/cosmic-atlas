import { describe, expect, it } from 'vitest';
import { ICRS_TO_GAL, galToLB, galToRadec, hammerUV, radecDistToGal } from '../src/math/frames';

// Reference values computed with astropy 8.0.2 (SkyCoord(...).galactic) in the repo .venv.
const CASES = [
  { name: 'Sirius', ra: 101.287155, dec: -16.716116, d: 2.64, l: 227.23029124650571, b: -8.890281554109121,
    xyz: [-1.7711633718746567, -1.9147119920769136, -0.4079930116147173] },
  { name: 'Proxima', ra: 217.42894, dec: -62.67949, d: 1.3012, l: 313.9398611717234, b: -1.9271485796533687,
    xyz: [0.9023958343071069, -0.9364232268380062, -0.04375772461492098] },
  { name: 'M31', ra: 10.6847, dec: 41.269, d: 765000, l: 121.17433209655876, b: -21.573058735976257,
    xyz: [-368257.6497064441, 608680.8817647226, -281280.7985035678] },
  { name: 'Sgr A*', ra: 266.41683, dec: -29.00781, d: 8178, l: 359.94425455775877, b: -0.04616220683918042,
    xyz: [8177.993475023, -7.956711831739937, -6.588870766690809] },
  { name: 'ra0dec0', ra: 0, dec: 0, d: 1, l: 96.33728336969006, b: -60.188551946914465,
    xyz: [-0.054875657712591654, 0.49410943719272676, -0.8676661375596576] },
  { name: 'ra180dec45', ra: 180, dec: 45, d: 100, l: 149.48053428322027, b: 69.38409924995268,
    xyz: [-30.332011183962653, 17.880803403526418, 93.59618564439678] },
];

describe('ICRS -> Galactic', () => {
  it('matrix is orthonormal', () => {
    const m = ICRS_TO_GAL;
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        const dot = m[i * 3] * m[j * 3] + m[i * 3 + 1] * m[j * 3 + 1] + m[i * 3 + 2] * m[j * 3 + 2];
        expect(dot).toBeCloseTo(i === j ? 1 : 0, 14);
      }
  });
  for (const c of CASES) {
    it(`${c.name}: xyz and l,b match astropy`, () => {
      const v = radecDistToGal(c.ra, c.dec, c.d);
      for (let k = 0; k < 3; k++) expect(Math.abs(v[k] - c.xyz[k])).toBeLessThan(1e-12 * Math.max(1, c.d));
      const lb = galToLB(v);
      expect(lb.l).toBeCloseTo(c.l, 9);
      expect(lb.b).toBeCloseTo(c.b, 9);
      expect(lb.dist).toBeCloseTo(c.d, 6);
    });
    it(`${c.name}: round trip back to ICRS`, () => {
      const r = galToRadec(radecDistToGal(c.ra, c.dec, c.d));
      expect(r.ra).toBeCloseTo(c.ra, 9);
      expect(r.dec).toBeCloseTo(c.dec, 9);
    });
  }
  it('Galactic Centre direction is +x', () => {
    const lb = galToLB([1, 0, 0]);
    expect(lb.l).toBe(0);
    expect(lb.b).toBe(0);
    expect(galToLB([0, 1, 0]).l).toBeCloseTo(90, 12);
    expect(galToLB([0, 0, 1]).b).toBeCloseTo(90, 12);
  });
});

describe('Hammer-Aitoff uv of the Gaia sky image', () => {
  const W = 4000, H = 2000;
  it('l=0,b=0 is the image centre', () => {
    const [u, v] = hammerUV(0, 0, W, H);
    expect(u).toBeCloseTo(0.5, 6);
    expect(v).toBeCloseTo(0.5, 6);
  });
  it('l increases to the left, north is up', () => {
    expect(hammerUV(90, 0, W, H)[0]).toBeLessThan(0.5);
    expect(hammerUV(270, 0, W, H)[0]).toBeGreaterThan(0.5);
    expect(hammerUV(0, 60, W, H)[1]).toBeGreaterThan(0.5);
  });
  it('LMC (l=280.47, b=-32.89) lands where the LMC is in the image (~col 2830, row 1430)', () => {
    // measured by eye on the 1200x600 preview: LMC blob at (850, 430) -> full res (2833, 1433)
    const [u, v] = hammerUV(280.47, -32.89, W, H);
    expect(Math.abs(u * W - 2833)).toBeLessThan(40);
    expect(Math.abs((1 - v) * H - 1433)).toBeLessThan(40);
  });
});
