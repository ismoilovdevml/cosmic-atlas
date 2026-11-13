/**
 * Blackbody colour table: linear sRGB of a Planck spectrum at temperature T, integrated through
 * the CIE 1931 2° colour-matching functions.
 *
 * CMFs: the multi-lobe Gaussian fit of Wyman, Sloan & Shirley 2013 (JCGT 2(2), 1), within about
 * 1 % of the tabulated CIE functions. XYZ -> linear sRGB with the IEC 61966-2-1 (D65) matrix.
 *
 * Why a table of absolute colours: a blackbody at T seen with redshift factor g is a blackbody at
 * g·T, because I_ν/ν³ is invariant (g³ B_ν(ν/g; T) = B_ν(ν; gT)). So the observed colour AND the
 * observed brightness of a disk element are the table entry at T_obs = g T_emit; integrated over
 * frequency this is the g⁴ law (σ(gT)⁴ = g⁴ σT⁴).
 */

const H = 6.62607015e-34;
const KB = 1.380649e-23;
const CL = 299_792_458;

const lobe = (l: number, mu: number, s1: number, s2: number) => {
  const t = (l - mu) / (l < mu ? s1 : s2);
  return Math.exp(-0.5 * t * t);
};

/** CIE 1931 2° x̄, ȳ, z̄ at wavelength l (nm), Wyman et al. 2013 multi-lobe fit */
export function cmf(l: number): [number, number, number] {
  const x = 1.056 * lobe(l, 599.8, 37.9, 31.0) + 0.362 * lobe(l, 442.0, 16.0, 26.7) - 0.065 * lobe(l, 501.1, 20.4, 26.2);
  const y = 0.821 * lobe(l, 568.8, 46.9, 40.5) + 0.286 * lobe(l, 530.9, 16.3, 31.1);
  const z = 1.217 * lobe(l, 437.0, 11.8, 36.0) + 0.681 * lobe(l, 459.0, 26.0, 13.8);
  return [x, y, z];
}

/** Planck spectral radiance per unit wavelength, B_λ(λ, T), λ in nm (SI units per m) */
export function planckLambda(lnm: number, T: number): number {
  const l = lnm * 1e-9;
  const a = (H * CL) / (l * KB * T);
  if (a > 700) return 0;
  return (2 * H * CL * CL) / (l ** 5 * Math.expm1(a));
}

/** Planck spectral radiance per unit frequency, B_ν(ν, T) */
export function planckNu(nu: number, T: number): number {
  const a = (H * nu) / (KB * T);
  if (a > 700) return 0;
  return (2 * H * nu ** 3) / (CL * CL * Math.expm1(a));
}

/** CIE XYZ of a blackbody at T (unnormalised) */
export function blackbodyXYZ(T: number): [number, number, number] {
  let X = 0;
  let Y = 0;
  let Z = 0;
  for (let l = 360; l <= 830; l += 2) {
    const b = planckLambda(l, T);
    const [x, y, z] = cmf(l);
    X += b * x;
    Y += b * y;
    Z += b * z;
  }
  return [X, Y, Z];
}

export function xyzToLinearSrgb([X, Y, Z]: [number, number, number]): [number, number, number] {
  return [
    3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z,
    -0.969266 * X + 1.8760108 * Y + 0.041556 * Z,
    0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z,
  ];
}

export const BB_T_MIN = 600;
export const BB_T_MAX = 100_000;
export const BB_N = 256;
/** colours are normalised to the luminance Y of a blackbody at this temperature */
export const BB_T_NORM = 6500;

/**
 * Table of linear sRGB (clamped >= 0) for log-spaced T in [BB_T_MIN, BB_T_MAX], each divided by
 * Y(BB_T_NORM). Entry i is at T = T_MIN (T_MAX/T_MIN)^(i/(N-1)). Also returns Y(T)/Y(T_NORM).
 */
export function blackbodyTable(): { rgb: Float32Array; lum: Float32Array } {
  const yn = blackbodyXYZ(BB_T_NORM)[1];
  const rgb = new Float32Array(BB_N * 4);
  const lum = new Float32Array(BB_N);
  for (let i = 0; i < BB_N; i++) {
    const T = BB_T_MIN * Math.pow(BB_T_MAX / BB_T_MIN, i / (BB_N - 1));
    const xyz = blackbodyXYZ(T);
    const c = xyzToLinearSrgb(xyz);
    for (let k = 0; k < 3; k++) rgb[i * 4 + k] = Math.max(0, c[k] / yn);
    rgb[i * 4 + 3] = 1;
    lum[i] = xyz[1] / yn;
  }
  return { rgb, lum };
}

/** relative luminance of a blackbody at T vs one at BB_T_NORM */
export function blackbodyLum(T: number): number {
  return blackbodyXYZ(T)[1] / blackbodyXYZ(BB_T_NORM)[1];
}
