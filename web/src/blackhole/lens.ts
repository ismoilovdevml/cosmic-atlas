/**
 * Gravitational lens pass (TSL -> WGSL / GLSL): per-pixel null geodesics in the Schwarzschild
 * metric around the active black hole, plus an optional thin accretion disk.
 *
 * Two stages, so that screen-space derivatives stay in uniform control flow:
 *   1. TRACE (RTT, rgba32f, full or half resolution): for each texel, the RK4 orbit integration of
 *      geodesic.ts (same constants, same shortcuts, same order of tests; geodesic.ts is the tested
 *      CPU twin). Output (δ, status, T_obs, g): status 0 = escaped with deflection δ = φ∞ − ψ, the
 *      ray arriving from cos φ∞ e1 + sin φ∞ e2; 1 = captured (shadow); 2 = disk hit with observed
 *      colour temperature T_obs.
 *   2. COMPOSE (inside PostPass, full resolution): a status-masked bilinear filter of the 4 nearest
 *      trace texels (δ averaged over escaped texels, T_obs over disk texels, their coverages fading
 *      the edges); δ is added to each pixel's own ψ, so a half-resolution trace stays smooth and the
 *      shadow and disk rims are anti-aliased. Then rebuild the
 *      bent sky direction, sample the Gaia sky there (mip
 *      level from fwidth of the BENT direction, so the Einstein ring is not aliased), sample the
 *      rendered scene where the bent direction is inside the frame, or the disk's blackbody colour.
 *
 * Physics (all in r_s = 1 units, static observer at the camera):
 *   orbit:   d²u/dφ² = −u + (3/2) u²    (Luminet 1979, A&A 75, 228, eq. 1; Chandrasekhar 1983 §20)
 *   camera:  u'(0) = −u0 sqrt(1 − u0) cot ψ,  b = r0 sin ψ / sqrt(1 − u0)
 *   disk:    Novikov–Thorne flux, T ∝ F^1/4, r_in = ISCO = 3 r_s (Page & Thorne 1974)
 *   colour:  g = sqrt(1 − 1.5/r) / ( sqrt(1 − 1/r0) (1 − Ω b_z) ), Ω = sqrt(0.5/r³)
 *            (Luminet 1979 §4; James et al. 2015, CQG 32, 065001, appendix A)
 *            observed spectrum = blackbody at g·T (I_ν/ν³ invariant), so I_bol ∝ g⁴
 *   background: blueshift 1/sqrt(1 − 1/r0) for the static observer, intensity × g_bg⁴ (no colour
 *            shift of the RGB sky/scene: they carry no spectra).
 * Not modelled: Kerr spin, disk thickness, limb darkening, light travel time, the observer's own
 * motion (the camera hovers), lensing of the scene by more than one hole at a time.
 */

import * as THREE from 'three/webgpu';
import {
  Break, Fn, If, Loop, abs, asin, atan, ceil, clamp, cos, cross, dot, float, fwidth, int, length, log, log2, max, min, normalize,
  cubeTexture, floor, mix, pow, rtt, screenUV, select, sin, smoothstep, sqrt, texture, textureSize, transpose, uniform, vec2, vec3, vec4,
} from 'three/tsl';
import { BB_N, BB_T_MAX, BB_T_MIN, blackbodyTable } from './blackbody';
import { EXIT_Q, U_EXIT, U_FAR, W_FAR } from './geodesic';
import { NT_PEAK } from './physics';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

export interface ComposeCtx {
  /** scene HDR texture node (pass output) */
  hdrTex: N;
  /** linear sky colour for a world direction at a mip level (gain, haze and on/off applied) */
  skyAt: (dir: N, lod: N) => N;
  /** sky image width in px (uniform node) */
  skyWidth: N;
}

const S3 = Math.sqrt(3);
const S6 = Math.sqrt(6);

export class LensShader {
  /** camera position relative to the hole, in r_s, contract (world) axes */
  readonly uCamR = uniform(new THREE.Vector3(0, 0, 100));
  readonly uCamRot = uniform(new THREE.Matrix3());
  readonly uTanHalf = uniform(new THREE.Vector2(1, 1));
  readonly uDiskOn = uniform(0);
  readonly uDiskN = uniform(new THREE.Vector3(0, 0, 1));
  readonly uRin = uniform(3);
  readonly uRout = uniform(12);
  readonly uTpeak = uniform(6500);
  readonly uDiskGain = uniform(1);
  readonly uH = uniform((2 * Math.PI) / 96);
  readonly uCh = uniform(Math.cos((2 * Math.PI) / 96));
  readonly uSh = uniform(Math.sin((2 * Math.PI) / 96));
  readonly uMaxSteps = uniform(240, 'int');
  /** background intensity factor g_bg⁴ = (1 − 1/r0)^-2 */
  readonly uBgGain = uniform(1);
  /** debug: 1 = take the scene only from the environment cube */
  readonly uEnvOnly = uniform(0);
  private readonly bbTex: THREE.DataTexture;
  private envTex: THREE.CubeTexture | null = null;
  traceTex: N = null;
  private scale = 1;

  constructor() {
    const { rgb } = blackbodyTable();
    const half = new Uint16Array(rgb.length);
    for (let i = 0; i < rgb.length; i++) half[i] = THREE.DataUtils.toHalfFloat(Math.min(rgb[i], 65000));
    this.bbTex = new THREE.DataTexture(half, BB_N, 1, THREE.RGBAFormat, THREE.HalfFloatType);
    this.bbTex.minFilter = THREE.LinearFilter;
    this.bbTex.magFilter = THREE.LinearFilter;
    this.bbTex.wrapS = THREE.ClampToEdgeWrapping;
    this.bbTex.needsUpdate = true;
  }

  /** environment cube of the scene (BlackHoleFeature.captureEnv), used where bent rays leave the frame */
  setEnv(tex: THREE.Texture) {
    this.envTex = tex as THREE.CubeTexture;
  }

  /** trace resolution relative to the drawing buffer (1 or 0.5) */
  setScale(s: number) {
    this.scale = s;
    this.traceTex?.setResolutionScale(s);
  }

  setSteps(stepsPerTurn: number, turns = 2.5) {
    const h = (2 * Math.PI) / stepsPerTurn;
    this.uH.value = h;
    this.uCh.value = Math.cos(h);
    this.uSh.value = Math.sin(h);
    this.uMaxSteps.value = Math.round(turns * stepsPerTurn);
  }

  /** pixel ray in world axes and its orbit-plane frame (shared by both stages) */
  private frame() {
    const ndc = vec2(screenUV.x.mul(2.0).sub(1.0), float(1.0).sub(screenUV.y.mul(2.0)));
    const d = normalize(this.uCamRot.mul(vec3(ndc.mul(this.uTanHalf), -1.0)));
    const r0 = length(this.uCamR);
    const e1 = this.uCamR.div(r0);
    const cp = dot(d, e1);
    const tv = d.sub(e1.mul(cp));
    const sp = max(length(tv), 1e-7);
    const e2 = tv.div(sp);
    return { d, r0, e1, e2, cp, sp };
  }

  /** stage 1: the RTT holding (φ∞, status, T_obs, g) per pixel */
  buildTrace(): N {
    const U = this;
    const traceFn = Fn(() => {
      const { r0, e1, e2, cp, sp } = U.frame();
      const u0 = float(1.0).div(r0);
      const sf = sqrt(float(1.0).sub(u0));
      const w = sf.div(r0.mul(sp));
      const u = u0.toVar();
      const v = u0.mul(sf).mul(cp).div(sp).negate().toVar();
      const phi = float(0).toVar();
      const cs = float(1).toVar();
      const sn = float(0).toVar();
      const status = float(1).toVar();
      const phiInf = float(0).toVar();
      const tObs = float(0).toVar();
      const gOut = float(0).toVar();
      const A = dot(U.uDiskN, e1);
      const B = dot(U.uDiskN, e2);
      const h = U.uH;
      // an outgoing ray past r_out never returns to the disk: the tail may start only beyond it (geodesic.ts)
      const uExit = select(U.uDiskOn.greaterThan(0.5), min(float(U_EXIT), float(1.0).div(U.uRout)), float(U_EXIT));
      // remaining sweep of an outgoing ray, second order (geodesic.ts exitTail)
      const tail = (uu: N, ww: N) => {
        const q = min(uu.div(ww), 1.0);
        const c = sqrt(max(float(1.0).sub(q.mul(q)), 1e-6));
        const th = asin(q);
        const t = q.div(c);
        const i2 = t.mul(-2.0).add(t.mul(t).mul(t).div(3.0)).add(th.mul(2.5)).sub(sin(th.mul(2.0)).mul(0.25));
        return th.sub(ww.mul(0.5).mul(float(1.0).sub(c).mul(float(1.0).sub(c))).div(c)).add(ww.mul(ww).mul(0.375).mul(i2));
      };
      const acc = (uu: N) => uu.negate().add(uu.mul(uu).mul(1.5));
      const herm = (a0: N, b0: N, a1: N, b1: N, t: N) => {
        const t2 = t.mul(t);
        const t3 = t2.mul(t);
        return t3.mul(2).sub(t2.mul(3)).add(1).mul(a0)
          .add(t3.sub(t2.mul(2)).add(t).mul(h).mul(b0))
          .add(t2.mul(3).sub(t3.mul(2)).mul(a1))
          .add(t3.sub(t2).mul(h).mul(b1));
      };
      const hermD = (a0: N, b0: N, a1: N, b1: N, t: N) => {
        const t2 = t.mul(t);
        return t2.mul(6).sub(t.mul(6)).mul(a0)
          .add(t2.mul(3).sub(t.mul(4)).add(1).mul(h).mul(b0))
          .add(t.mul(6).sub(t2.mul(6)).mul(a1))
          .add(t2.mul(3).sub(t.mul(2)).mul(h).mul(b1));
      };

      If(u0.lessThan(U_FAR).and(w.lessThan(W_FAR)), () => {
        // far camera, far ray: first-order orbit (geodesic.ts farRayPhi / exitTail)
        status.assign(0);
        If(v.lessThanEqual(0), () => {
          phiInf.assign(tail(u0, w));
        }).Else(() => {
          const s0 = u0.div(w);
          const s1 = u0.sub(w.mul(w).mul(0.5).mul(float(2.0).sub(s0.mul(s0)))).div(w);
          phiInf.assign(float(Math.PI).add(w).sub(asin(clamp(s1, -1.0, 1.0))));
        });
      }).Else(() => {
        Loop({ start: int(0), end: U.uMaxSteps, type: 'int', condition: '<' }, () => {
          If(v.lessThan(0).and(u.lessThan(uExit)).and(u.lessThan(w.mul(EXIT_Q))), () => {
            phiInf.assign(phi.add(tail(u, w)));
            status.assign(0);
            Break();
          });
          If(u.greaterThan(1.0).or(u.greaterThan(2.0 / 3.0).and(v.greaterThan(0))), () => {
            status.assign(1);
            Break();
          });
          // RK4 on (u, v)
          const k1u = v;
          const k1v = acc(u);
          const k2u = v.add(h.mul(0.5).mul(k1v)).toVar();
          const k2v = acc(u.add(h.mul(0.5).mul(k1u))).toVar();
          const k3u = v.add(h.mul(0.5).mul(k2v)).toVar();
          const k3v = acc(u.add(h.mul(0.5).mul(k2u))).toVar();
          const k4u = v.add(h.mul(k3v)).toVar();
          const k4v = acc(u.add(h.mul(k3u))).toVar();
          const u1 = u.add(h.div(6.0).mul(k1u.add(k2u.mul(2)).add(k3u.mul(2)).add(k4u))).toVar();
          const v1 = v.add(h.div(6.0).mul(k1v.add(k2v.mul(2)).add(k3v.mul(2)).add(k4v))).toVar();
          const cs1 = cs.mul(U.uCh).sub(sn.mul(U.uSh)).toVar();
          const sn1 = sn.mul(U.uCh).add(cs.mul(U.uSh)).toVar();
          If(U.uDiskOn.greaterThan(0.5), () => {
            const s0 = A.mul(cs).add(B.mul(sn));
            const s1 = A.mul(cs1).add(B.mul(sn1));
            If(s0.notEqual(0).and(s0.mul(s1).lessThanEqual(0)), () => {
              const base = atan(B, A).add(Math.PI / 2);
              const phiZ = base.add(ceil(phi.sub(base).div(Math.PI)).mul(Math.PI));
              const t = clamp(phiZ.sub(phi).div(h), 0.0, 1.0);
              const uc = herm(u, v, u1, v1, t).toVar();
              If(uc.greaterThan(0), () => {
                const rc = float(1.0).div(uc).toVar();
                If(rc.greaterThanEqual(U.uRin).and(rc.lessThanEqual(U.uRout)), () => {
                  // Novikov–Thorne temperature, physics.ts ntFlux (x = r/M = 2 r)
                  const x = rc.mul(2.0);
                  const s = sqrt(x);
                  const lg = log(s.add(S3).mul(S6 - S3).div(s.sub(S3).mul(S6 + S3)));
                  const F = s.sub(S6).add(lg.mul(S3 / 2)).div(x.sub(3.0).mul(pow(x, 2.5)));
                  const Te = U.uTpeak.mul(pow(max(F.div(NT_PEAK.F), 0.0), 0.25));
                  // redshift factor (physics.ts diskRedshift), b_z = −b n·(e1 × e2)
                  const bz = dot(U.uDiskN, cross(e1, e2)).negate().div(w);
                  const om = sqrt(float(0.5).div(rc.mul(rc).mul(rc)));
                  const g = sqrt(float(1.0).sub(float(1.5).div(rc))).div(sf.mul(float(1.0).sub(om.mul(bz))));
                  tObs.assign(Te.mul(g));
                  gOut.assign(g);
                  status.assign(2);
                  Break();
                });
              });
            });
          });
          If(u1.lessThanEqual(0), () => {
            // escape inside this step: root of the Hermite interpolant (3 Newton steps)
            const t = u.div(u.sub(u1)).toVar();
            for (let k = 0; k < 3; k++) {
              const fd = hermD(u, v, u1, v1, t);
              t.assign(clamp(t.sub(herm(u, v, u1, v1, t).div(select(abs(fd).greaterThan(1e-9), fd, float(1e-9)))), 0.0, 1.0));
            }
            phiInf.assign(phi.add(h.mul(t)));
            status.assign(0);
            Break();
          });
          phi.addAssign(h);
          u.assign(u1);
          v.assign(v1);
          cs.assign(cs1);
          sn.assign(sn1);
        });
      });
      // deflection relative to the pixel's own direction (ψ = angle from the outward radial)
      return vec4(phiInf.sub(atan(sp, cp)), status, tObs, gOut);
    });
    this.traceTex = rtt(traceFn(), null, null, {
      type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false, depthBuffer: false,
    });
    this.traceTex.setResolutionScale(this.scale);
    return this.traceTex;
  }

  /** stage 2 (inside PostPass): HDR scene light and linear sky along the bent rays */
  compose(ctx: ComposeCtx): { hdr: N; sky: N } {
    if (!this.traceTex) this.buildTrace();
    // status-masked bilinear filter of the 4 nearest trace texels: δ is averaged over the escaped
    // texels only, T_obs over the disk texels only, and the two coverages fade the edges (anti-aliased
    // shadow and disk rims, also when the trace runs at half resolution)
    const T = this.traceTex;
    const size = vec2(textureSize(T, int(0)) as N);
    const tc = screenUV.mul(size).sub(0.5);
    const i0 = floor(tc);
    const f = tc.sub(i0);
    let wEsc: N = float(0);
    let sEsc: N = float(0);
    let wDsk: N = float(0);
    let sT: N = float(0);
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const Li = T.sample(i0.add(vec2(dx, dy)).add(0.5).div(size));
      const wi = (dx ? f.x : float(1.0).sub(f.x)).mul(dy ? f.y : float(1.0).sub(f.y));
      const e = wi.mul(select(Li.y.lessThan(0.5), float(1.0), float(0.0)));
      const k = wi.mul(select(Li.y.greaterThan(1.5), float(1.0), float(0.0)));
      wEsc = wEsc.add(e);
      sEsc = sEsc.add(e.mul(Li.x));
      wDsk = wDsk.add(k);
      sT = sT.add(k.mul(Li.z));
    }
    const delta = sEsc.div(max(wEsc, 1e-6));
    const tDisk = sT.div(max(wDsk, 1e-6));
    const { e1, e2, cp, sp } = this.frame();
    const phiInf = atan(sp, cp).add(delta);
    const dB = normalize(e1.mul(cos(phiInf)).add(e2.mul(sin(phiInf))));
    const escaped = wEsc;
    const onDisk = wDsk;

    // sky along the bent ray; mip from the bent direction's screen derivative (uniform control flow)
    const ang = length(fwidth(dB));
    const lod = min(log2(max(ang.mul(ctx.skyWidth).mul(0.25), 1.0)), 9.0);
    const sky = ctx.skyAt(dB, lod).mul(this.uBgGain).mul(escaped);

    // rendered scene along the bent ray, where it lands inside the frame
    const vv = transpose(this.uCamRot).mul(dB);
    const vz = max(vv.z.negate(), 1e-6);
    const ndcB = vec2(vv.x, vv.y).div(vz.mul(this.uTanHalf));
    const uvB = vec2(ndcB.x.mul(0.5).add(0.5), float(0.5).sub(ndcB.y.mul(0.5)));
    const edge = max(abs(ndcB.x), abs(ndcB.y));
    const inFrame = select(vv.z.lessThan(0), float(1.0), float(0.0)).mul(float(1.0).sub(smoothstep(0.97, 1.0, edge)));
    const frameLight = ctx.hdrTex.sample(clamp(uvB, 0.0, 1.0)).rgb;
    const envLight = this.envTex ? cubeTexture(this.envTex, dB).level(float(0)).rgb : vec3(0.0);
    const w = inFrame.mul(float(1.0).sub(this.uEnvOnly));
    const scene = mix(envLight, frameLight, w).mul(this.uBgGain).mul(escaped);

    // disk: blackbody at T_obs from the table (log T axis, texel centres)
    const sLog = clamp(log(max(tDisk, 1.0)).sub(Math.log(BB_T_MIN)).div(Math.log(BB_T_MAX / BB_T_MIN)), 0.0, 1.0);
    const bb = texture(this.bbTex, vec2(sLog.mul(BB_N - 1).add(0.5).div(BB_N), 0.5)).level(float(0)).rgb;
    const disk = bb.mul(this.uDiskGain).mul(onDisk).mul(select(tDisk.greaterThan(BB_T_MIN), float(1.0), float(0.0)));
    return { hdr: scene.add(disk), sky };
  }
}
