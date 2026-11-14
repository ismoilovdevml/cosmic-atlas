/**
 * Volumetric dust (TSL -> WGSL / GLSL), drawn by PostPass's dust pipeline (enableDust).
 *
 * What the image already contains. The Gaia sky image and the star tiles are photometry taken
 * FROM THE SUN: their light already passed through the dust between the Sun and the source (Gaia
 * G magnitudes are not extinction-corrected, pipeline/build_tiles.py). Dimming them again by the
 * dust in front of the camera would count the dust twice; at the Sun it would darken the Great
 * Rift a second time. So the dust is applied as a RELATIVE extinction:
 *
 *   light_from_camera = light_from_Sun × 10^(−0.4 · k_c · (A_cam→P − A_Sun→P))
 *
 * per colour channel c (k = A_λ/A_V at 610 / 540 / 465 nm, CCM89 R_V = 3.1, meta.json), where P is
 * the source:
 *  - points: the pixel's light-weighted mean source position, from the dust pipeline's second
 *    scene target (post.ts, "ldepth": Σ w·log2 depth; Σ w is the luminance of the HDR light).
 *  - sky: the point where the Sun's ray in that direction leaves the map.
 * Both factors are capped at 1 (uCapPts, uCap: the layer only removes light). Lifting light that the
 * Sun saw through a cloud would be right for a star with Sun-side photometry, but it is wrong for
 * the layers that are not (the synthetic dev stars, the Milky Way model, subtree blobs), and for the
 * sky image, a photograph at infinity without parallax, it mostly amplifies the geometry error
 * (100 pc above the plane, looking along it, the camera misses the in-plane dust the Sun's ray
 * crossed but also the in-plane stars that make that part of the Milky Way). Measured before the cap,
 * from 3 kpc: distant galaxies and the Milky Way model came out up to 4× brighter in the pattern of
 * the dust as seen from the Sun. So a star the Sun saw behind a cloud stays as dim as observed.
 * At the Sun both factors are 1 (up to march noise): the layer adds nothing to the real sky.
 *
 * Two stages, like the black hole lens:
 *  1. TRACE (RTT, quarter resolution for Low, half for Medium and High): per texel, the ray's part inside
 *     sphere(R) ∩ slab(|z| ≤ Z) is marched with uSteps samples, jittered by interleaved gradient
 *     noise. A step reads the 6 pc grid while it is shorter than a voxel and the 12 pc grid when it
 *     is over two voxels long (blended in between), so long steps do not alias. A_Sun→P comes
 *     from the aux texture (build_dust.py marched it through the same decoded 6 pc field, 512
 *     steps). Output (A_cam→P − A_Sun→P for the points at the texel's mean point depth, the same for
 *     the sky, glow integral).
 *  2. COMPOSE (in the post pass, full resolution): one bilinear read of the trace, the factors and
 *     the glow.
 * Glow (a display aid, not emission): G = ∫ ρ 10^(−0.4 A(s)) ds in a warm brown, for views from
 * outside the map where nothing bright lies behind the clouds.
 *
 * Not modelled: the depth spread of the points in one pixel (one mean depth per trace texel, 2×2 or
 * 4×4 pixels); dust beyond the map (|z| > 402 pc or r > 1248 pc); scattering; the
 * lensed view near a black hole (the dust pipeline is off while the lens runs).
 */

import * as THREE from 'three/webgpu';
import {
  Break, Fn, If, Loop, abs, clamp, dot, exp2, float, fract, int, max, min, mix, rtt, screenCoordinate, screenUV, select,
  smoothstep, sqrt, texture3D, uniform, vec2, vec3, vec4,
} from 'three/tsl';
import { dataBounds, decodeLog, type DustGrid } from './grid';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

/** trace samples per ray and trace resolution by quality */
export const DUST_QUALITY = {
  low: { steps: 48, scale: 0.25 },
  medium: { steps: 64, scale: 0.5 },
  high: { steps: 128, scale: 0.5 },
} as const;
export type DustQuality = keyof typeof DUST_QUALITY;
/** largest factor on the points' light (1 = dimming only; see the header) */
export const DUST_CAP_PTS = 1;
/** 10^(-0.4 A) = 2^(-A * MAG2) */
const MAG2 = 0.4 * Math.LOG2E * Math.LN10;
/** glow colour, linear RGB (a warm brown) */
export const GLOW_RGB: [number, number, number] = [0.62, 0.33, 0.17];
/** "no points here" depth, pc (beyond everything) */
const FAR = 1e12;

export interface DustCtx {
  /** unit view direction in contract (world) axes for the current screenUV (works in both stages) */
  dirAt: () => N;
  /** camera forward, world axes */
  fwd: N;
  /** (Σ w·log2 depth, Σ w) of the scene light at a uv */
  ldAt: (uv: N) => N;
}

export interface DustOut {
  /** per-channel factor on the points' light */
  pts: N;
  /** per-channel factor on the sky */
  sky: N;
  /** added HDR light (glow) */
  glow: N;
}

export class DustShader {
  /** camera position relative to the Sun, pc */
  readonly uCam = uniform(new THREE.Vector3());
  /** layer strength: opacity × camera-distance fade */
  readonly uAmount = uniform(0);
  /** glow weight (0 inside the map, 1 outside; or forced by the mode) */
  readonly uGlow = uniform(0);
  readonly uGlowGain = uniform(0.08);
  readonly uSteps = uniform(DUST_QUALITY.medium.steps, 'int');
  readonly uCapPts = uniform(DUST_CAP_PTS);
  readonly fineTex: THREE.Data3DTexture;
  readonly coarseTex: THREE.Data3DTexture;
  readonly auxTex: THREE.Data3DTexture;
  traceTex: N = null;
  private scale: number = DUST_QUALITY.medium.scale;

  constructor(readonly grid: DustGrid) {
    const m = grid.meta;
    const mk = (data: Uint8Array | Uint16Array, d: [number, number, number], format: THREE.PixelFormat) => {
      const t = new THREE.Data3DTexture(data, d[0], d[1], d[2]);
      t.format = format;
      t.type = data instanceof Uint16Array ? THREE.HalfFloatType : THREE.UnsignedByteType;
      t.minFilter = THREE.LinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping;
      t.unpackAlignment = data instanceof Uint16Array ? 2 : 1;
      t.generateMipmaps = false;
      t.needsUpdate = true;
      return t;
    };
    // The march reads A_V per kpc as half floats, decoded once here through a 256-entry table:
    // no per-sample exp2, and the trilinear filter interpolates the density itself (as build_dust.py's
    // Sun-side march and grid.ts do). GPU memory 47 MB + 5.9 MB; the download stays 1 byte/voxel.
    const lut = new Uint16Array(256);
    for (let c = 0; c < 256; c++) lut[c] = THREE.DataUtils.toHalfFloat(decodeLog(c, m.mean.lo, m.mean.hi));
    const half = (codes: Uint8Array, stride = 1) => {
      const out = new Uint16Array(codes.length / stride);
      for (let i = 0; i < out.length; i++) out[i] = lut[codes[i * stride]];
      return out;
    };
    this.fineTex = mk(half(grid.fine), m.fine.dims, THREE.RedFormat);
    this.coarseTex = mk(half(grid.aux, 4), m.aux.dims, THREE.RedFormat);
    this.auxTex = mk(grid.aux, m.aux.dims, THREE.RGBAFormat);
  }

  setQuality(q: DustQuality) {
    this.uSteps.value = DUST_QUALITY[q].steps;
    this.scale = DUST_QUALITY[q].scale;
    this.traceTex?.setResolutionScale(this.scale);
  }

  private consts() {
    const m = this.grid.meta;
    const { R, Z } = dataBounds(m);
    return {
      R, Z, vox: m.fine.voxelPc, pad: m.aux.voxelPc * 0.5,
      org: vec3(...m.fine.origin),
      size: vec3(m.fine.dims[0] * m.fine.voxelPc, m.fine.dims[1] * m.fine.voxelPc, m.fine.dims[2] * m.fine.voxelPc),
    };
  }

  /** stage 1: the half- or full-resolution march into an RTT */
  private buildTrace(ctx: DustCtx) {
    const m = this.grid.meta;
    const { R, Z, vox, pad, org, size } = this.consts();
    const fineT = this.fineTex;
    const coarseT = this.coarseTex;
    const auxT = this.auxTex;
    const sunMax = m.sunAv.max;
    const sunAv = (p: N): N => {
      const a = texture3D(auxT, p.sub(org).div(size)).level(float(0));
      return a.b.mul(255 * 256).add(a.a.mul(255)).mul(sunMax / 65535);
    };
    /** p pulled back along the Sun→p ray to just inside the data (grid.ts clampToData) */
    const clampData = (p: N): N => {
      const r = max(sqrt(dot(p, p)), 1e-6);
      const kk = min(min(float(1.0), float(R - pad).div(r)), float(Z - pad).div(max(abs(p.z), float(1e-6))));
      return p.mul(kk);
    };
    const traceFn = Fn(() => {
      const C = this.uCam;
      const d = ctx.dirAt();
      // ray ∩ sphere(R) ∩ slab(|z| ≤ Z)
      const b = dot(C, d);
      const disc = b.mul(b).sub(dot(C, C).sub(R * R));
      const sq = sqrt(max(disc, 0.0));
      const dz = select(d.z.greaterThanEqual(0.0), max(d.z, 1e-6), min(d.z, -1e-6));
      const ta = float(-Z).sub(C.z).div(dz);
      const tb = float(Z).sub(C.z).div(dz);
      const t0 = max(max(b.negate().sub(sq), 0.0), min(ta, tb));
      const t1 = min(b.negate().add(sq), max(ta, tb));
      const valid = disc.greaterThan(0.0).and(t1.greaterThan(t0));
      // light-weighted mean source depth of this texel's pixels (view z -> distance along the ray)
      const ld = ctx.ldAt(screenUV);
      const has = ld.y.greaterThan(1e-9);
      const lg = select(has, ld.x.div(max(ld.y, 1e-20)), float(Math.log2(FAR)));
      const tP = exp2(lg).div(max(dot(d, ctx.fwd), 1e-3));

      const n = select(valid, this.uSteps, int(0));
      const dt = max(t1.sub(t0), 0.0).div(float(this.uSteps));
      const wc = smoothstep(vox, 2 * vox, dt);
      const jit = fract(float(52.9829189).mul(fract(dot(screenCoordinate.xy, vec2(0.06711056, 0.00583715)))));
      const A = float(0.0).toVar();
      const Ap = float(0.0).toVar();
      const G = float(0.0).toVar();
      Loop({ start: int(0), end: n, type: 'int', condition: '<' }, ({ i }: { i: N }) => {
        const s = t0.add(float(i).add(jit).mul(dt));
        If(A.greaterThan(25.0).and(s.greaterThan(tP)), () => {
          Break();
        });
        const q = C.add(d.mul(s)).sub(org).div(size);
        const rf = float(0.0).toVar();
        const rc = float(0.0).toVar();
        If(wc.lessThan(1.0), () => {
          rf.assign(texture3D(fineT, q).level(float(0)).r);
        });
        If(wc.greaterThan(0.0), () => {
          rc.assign(texture3D(coarseT, q).level(float(0)).r);
        });
        const dA = mix(rf, rc, wc).mul(dt).div(1000.0);
        Ap.addAssign(dA.mul(clamp(tP.sub(s.sub(dt.mul(0.5))).div(max(dt, 1e-6)), 0.0, 1.0)));
        G.addAssign(dA.mul(exp2(A.mul(-MAG2))));
        A.addAssign(dA);
      });
      // the Sun's side: A_V from the Sun to the source (points) and to where the Sun's ray leaves
      // the map (sky); stored as differences, so the compose stage reads one texel
      const AsPts = sunAv(clampData(C.add(d.mul(min(tP, 1e7)))));
      const tExit = min(float(R - pad), float(Z - pad).div(max(abs(d.z), float(1e-6))));
      const AsSky = sunAv(d.mul(tExit));
      return vec4(Ap.sub(AsPts), A.sub(AsSky), G, 0.0);
    });
    this.traceTex = rtt(traceFn(), null, null, {
      type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, depthBuffer: false,
    });
    this.traceTex.setResolutionScale(this.scale);
  }

  /** stage 2: call inside the post pass's Fn; returns the factors and the glow for this pixel */
  build(ctx: DustCtx): DustOut {
    if (!this.traceTex) this.buildTrace(ctx);
    const k = vec3(...this.grid.meta.rgbExtinctionRatio.ratioToAV);
    // (A_cam→P − A_Sun→P) for the points and the sky, and the glow integral, bilinear from the trace
    const tr = this.traceTex.sample(screenUV);
    const G = tr.z;
    const amt = this.uAmount;
    const fac = (dA: N, cap: N): N => min(exp2(k.mul(dA.mul(amt).mul(-MAG2))), vec3(cap));
    const pts = fac(tr.x, this.uCapPts);
    const sky = fac(tr.y, float(1.0));
    const glow = vec3(...GLOW_RGB).mul(G.mul(this.uGlowGain).mul(this.uGlow).mul(amt));
    return { pts, sky, glow };
  }
}
