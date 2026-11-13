/**
 * Galaxy thumbnails: a north-up, east-left TAN cutout of a colour HiPS around (ra, dec).
 *
 * 1. CDS hips2fits (alasky.cds.unistra.fr), which answers with Access-Control-Allow-Origin: *.
 * 2. If hips2fits fails (HTTP error, CORS block, not an image): the same HiPS is reprojected here,
 *    in the browser, from the tiles of a CORS-enabled mirror (IRSA, then ESA Sky). That is what
 *    hips2fits does server-side, with nearest-neighbour sampling.
 * 3. If both fail, the caller keeps the procedural disk.
 *
 * HiPS tile layout (checked against Legacy Surveys cutouts of M81, NGC 253 and NGC 1566, north
 * polar cap, equatorial zone and south polar cap; correlation 0.80 / 0.91 / 0.76, every other
 * orientation < 0.45): the HEALPix cell (ix, iy) of order k + 9 (face coordinates, NESTED) sits in
 * tile Npix = face·4^k + xy2nest(ix >> 9, iy >> 9) at image column (iy & 511), row from the top
 * (ix & 511).
 */

export interface HipsSurvey {
  id: string;
  title: string;
  credit: string;
  /** tile mirrors with CORS, in order of preference */
  mirrors: string[];
  maxOrder: number;
  tileFormat: 'jpg' | 'png';
}

export const DSS2_COLOR: HipsSurvey = {
  id: 'CDS/P/DSS2/color',
  title: 'DSS2 colour',
  credit: 'Digitized Sky Survey (STScI/NASA; POSS-II, UK Schmidt), coloured and HiPS by CDS (CDS/P/DSS2/color)',
  mirrors: ['https://irsa.ipac.caltech.edu/data/hips/CDS/DSS2/color', 'https://skies.esac.esa.int/DSSColor'],
  maxOrder: 9,
  tileFormat: 'jpg',
};

export const HIPS2FITS = 'https://alasky.cds.unistra.fr/hips-image-services/hips2fits';

export interface Cutout {
  /** RGBA bytes, row 0 = top (north) */
  rgba: Uint8ClampedArray;
  size: number;
  /** 'hips2fits' or the mirror base URL the tiles came from */
  via: string;
}

const DEG = Math.PI / 180;

/** interleave: ix in the even bits, iy in the odd bits (both < 2^15) */
export function xy2nest(ix: number, iy: number): number {
  let r = 0;
  for (let b = 0; b < 15; b++) r += (((ix >> b) & 1) << (2 * b)) + (((iy >> b) & 1) << (2 * b + 1));
  return r >>> 0;
}

/** HEALPix (z = cos θ = sin dec, φ = ra) → face and face coordinates at `order` (≤ 20) */
export function ang2xyf(order: number, z: number, phi: number): { face: number; ix: number; iy: number } {
  const ns = 2 ** order;
  const za = Math.abs(z);
  let tt = (phi / (Math.PI / 2)) % 4;
  if (tt < 0) tt += 4;
  if (za <= 2 / 3) {
    const t1 = ns * (0.5 + tt);
    const t2 = ns * z * 0.75;
    const jp = Math.floor(t1 - t2);
    const jm = Math.floor(t1 + t2);
    const ifp = Math.floor(jp / ns);
    const ifm = Math.floor(jm / ns);
    const face = ifp === ifm ? (ifp | 4) : ifp < ifm ? ifp : ifm + 8;
    return { face, ix: jm % ns, iy: ns - (jp % ns) - 1 };
  }
  const ntt = Math.min(3, Math.floor(tt));
  const tp = tt - ntt;
  const tmp = ns * Math.sqrt(3 * (1 - za));
  const jp = Math.min(Math.floor(tp * tmp), ns - 1);
  const jm = Math.min(Math.floor((1 - tp) * tmp), ns - 1);
  return z >= 0 ? { face: ntt, ix: ns - jm - 1, iy: ns - jp - 1 } : { face: ntt + 8, ix: jp, iy: jm };
}

/** which tile (order k, 512² pixels) holds (ra, dec), and where inside it */
export function tilePixel(k: number, raDeg: number, decDeg: number): { npix: number; col: number; row: number } {
  const { face, ix, iy } = ang2xyf(k + 9, Math.sin(decDeg * DEG), raDeg * DEG);
  return { npix: face * 4 ** k + xy2nest(ix >> 9, iy >> 9), col: iy & 511, row: ix & 511 };
}

/** gnomonic (TAN) inverse: tangent-plane coordinates (xi east, eta north) about (ra0, dec0) → ra, dec degrees */
export function tanToRadec(ra0: number, dec0: number, xi: number, eta: number): [number, number] {
  const d0 = dec0 * DEG;
  const rho = Math.hypot(xi, eta);
  if (rho === 0) return [ra0, dec0];
  const c = Math.atan(rho);
  const dec = Math.asin(Math.cos(c) * Math.sin(d0) + (eta * Math.sin(c) * Math.cos(d0)) / rho);
  const ra = ra0 * DEG + Math.atan2(xi * Math.sin(c), rho * Math.cos(d0) * Math.cos(c) - eta * Math.sin(d0) * Math.sin(c));
  let r = ra / DEG;
  r = ((r % 360) + 360) % 360;
  return [r, dec / DEG];
}

/** tile order whose pixels best match the cutout's pixel size */
export function chooseOrder(fovDeg: number, size: number, maxOrder: number): number {
  const pixDeg = fovDeg / size;
  // HEALPix pixel at order K ≈ 58.63° / 2^K
  const K = Math.round(Math.log2(58.63 / pixDeg));
  return Math.max(0, Math.min(maxOrder, K - 9));
}

export function hips2fitsUrl(s: HipsSurvey, ra: number, dec: number, fovDeg: number, size: number): string {
  const q = new URLSearchParams({
    hips: s.id, width: String(size), height: String(size), fov: fovDeg.toPrecision(6), projection: 'TAN',
    coordsys: 'icrs', rotation_angle: '0', ra: ra.toFixed(6), dec: dec.toFixed(6), format: 'jpg',
  });
  return `${HIPS2FITS}?${q}`;
}

async function decode(blob: Blob, size: number): Promise<Uint8ClampedArray> {
  const bmp = await createImageBitmap(blob);
  const cv = new OffscreenCanvas(size, size);
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, size, size);
  bmp.close();
  return ctx.getImageData(0, 0, size, size).data;
}

async function fetchImage(url: string, signal?: AbortSignal): Promise<Blob> {
  const r = await fetch(url, { mode: 'cors', signal });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const t = r.headers.get('content-type') ?? '';
  if (!t.startsWith('image/')) throw new Error(`not an image (${t || 'no content type'})`);
  return r.blob();
}

/** reproject HiPS tiles from one mirror into a TAN cutout (nearest neighbour) */
export async function reprojectFromTiles(base: string, s: HipsSurvey, ra: number, dec: number, fovDeg: number, size: number,
  signal?: AbortSignal): Promise<Uint8ClampedArray> {
  const k = chooseOrder(fovDeg, size, s.maxOrder);
  const n = size;
  const scale = (fovDeg * DEG) / n;
  const npix = new Int32Array(n * n);
  const off = new Int32Array(n * n);
  const tiles = new Map<number, Uint8ClampedArray | null>();
  for (let row = 0; row < n; row++) {
    const eta = ((n - 1) / 2 - row) * scale;
    for (let col = 0; col < n; col++) {
      const xi = ((n - 1) / 2 - col) * scale; // east to the left
      const [rr, dd] = tanToRadec(ra, dec, xi, eta);
      const t = tilePixel(k, rr, dd);
      npix[row * n + col] = t.npix;
      off[row * n + col] = t.row * 512 + t.col;
      tiles.set(t.npix, null);
    }
  }
  if (tiles.size > 40) throw new Error(`too many tiles (${tiles.size})`);
  await Promise.all([...tiles.keys()].map(async (p) => {
    const dir = Math.floor(p / 10000) * 10000;
    const blob = await fetchImage(`${base}/Norder${k}/Dir${dir}/Npix${p}.${s.tileFormat}`, signal);
    tiles.set(p, await decode(blob, 512));
  }));
  const out = new Uint8ClampedArray(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    const t = tiles.get(npix[i])!;
    const o = off[i] * 4;
    out[i * 4] = t[o];
    out[i * 4 + 1] = t[o + 1];
    out[i * 4 + 2] = t[o + 2];
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** after a hips2fits failure, go straight to the mirrors for this long (no request storm, no console spam) */
const HIPS2FITS_BACKOFF_MS = 10 * 60 * 1000;
let hips2fitsDownUntil = 0;

/** hips2fits first, then in-browser reprojection from each mirror; throws when all fail */
export async function fetchCutout(s: HipsSurvey, ra: number, dec: number, fovDeg: number, size: number,
  signal?: AbortSignal): Promise<Cutout> {
  const errors: string[] = [];
  if (Date.now() >= hips2fitsDownUntil) {
    try {
      const blob = await fetchImage(hips2fitsUrl(s, ra, dec, fovDeg, size), signal);
      return { rgba: await decode(blob, size), size, via: 'hips2fits' };
    } catch (e) {
      // a CORS block surfaces as a TypeError from fetch, an outage as an HTTP error
      hips2fitsDownUntil = Date.now() + HIPS2FITS_BACKOFF_MS;
      errors.push(`hips2fits: ${(e as Error).message}`);
    }
  } else errors.push('hips2fits: skipped after a recent failure');
  for (const m of s.mirrors) {
    try {
      return { rgba: await reprojectFromTiles(m, s, ra, dec, fovDeg, size, signal), size, via: m };
    } catch (e) {
      errors.push(`${new URL(m).host}: ${(e as Error).message}`);
    }
  }
  throw new Error(errors.join('; '));
}
