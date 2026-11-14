/**
 * GPU Kepler points: one instanced quad per orbiting object, its position solved in the vertex
 * shader from osculating elements for the time in a uniform. Shared by the asteroid/comet layer
 * (smallbodies.ts: heliocentric ecliptic AU, days) and the satellite layer (satellites.ts: TEME km,
 * seconds). The math is kepler.ts conicPosition(), step for step; test/smallbodies.test.ts checks
 * that twin against JPL Horizons, including a float32 emulation of this shader.
 *
 * Per instance: elA = (q, e, i, node), elB = (peri, tp, H, tag). Mesh-local units are the
 * elements' (AU or km); the mesh matrix rotates into the Galactic frame, scales to pc and
 * translates by (centre − camera), like every other relative-to-eye object in the Solar System
 * group (layer.ts header).
 *
 * Brightness is a map choice, not photometry: I = gain · clamp(10^(−0.4 (H − hBright)), floor, 1)
 * · clamp((D / r)², 0.25, 4), D = camera-to-focus distance, r = camera-to-object distance, so the
 * objects around the focus keep the same look whether that is the asteroid belt from 5 AU or the
 * Kuiper belt from 60 AU, and nearer objects stand out.
 */

import * as THREE from 'three/webgpu';
import {
  Discard, Fn, If, abs, attribute, clamp, cos, cosh, dot, exp, float, floor, log, max, min, mix, modelViewMatrix, pow,
  select, sign, sin, sinh, sqrt, uniform, uv, varying, vec3, vec4,
} from 'three/tsl';
import { QUAD } from '../render/pointMaterial';
import { SHADER_ITERS } from './kepler';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

export interface OrbitUniforms {
  /** time since the reference epoch, in the elements' time unit */
  dt: { value: number };
  mu: { value: number };
  gain: { value: number };
  hBright: { value: number };
  floor: { value: number };
  /** camera-to-focus distance in view (scene) units */
  focus: { value: number };
  dpr: { value: number };
  /** drawn size in CSS px for the brightest / faintest objects */
  sizeMax: { value: number };
  sizeMin: { value: number };
  color: { value: THREE.Vector3 };
  /** brightness of a 1-px dot relative to a quad of the same intensity */
  dotGain: { value: number };
}

export function orbitUniforms(color: THREE.Vector3, mu: number): OrbitUniforms {
  return {
    dt: uniform(0), mu: uniform(mu), gain: uniform(1), hBright: uniform(10), floor: uniform(0.1), focus: uniform(1),
    dpr: uniform(1), sizeMax: uniform(3), sizeMin: uniform(1.2), color: uniform(color), dotGain: uniform(0.6),
  } as unknown as OrbitUniforms;
}

/**
 * TSL twin of conicPosition(): position in the elements' plane frame.
 * `conics`: also handle parabolas and hyperbolas (comets); asteroids are all elliptic.
 */
export function keplerNode(elA: N, elB: N, U: OrbitUniforms, conics: boolean): N {
  const u = U as unknown as Record<string, N>;
  return Fn(() => {
    const q = elA.x;
    const e = elA.y;
    const t = u.dt.sub(elB.y).toVar();
    const x = float(0).toVar();
    const y = float(0).toVar();
    const ellipse = () => {
      const a = q.div(float(1).sub(e));
      const n = sqrt(u.mu.div(a.mul(a).mul(a)));
      const M0 = n.mul(t);
      const M: N = M0.sub(floor(M0.div(6.283185307179586).add(0.5)).mul(6.283185307179586)).toVar();
      const sM: N = sin(M);
      const E: N = M.add(e.mul(0.85).mul(select(sM.lessThan(0.0), float(-1.0), float(1.0)))).toVar();
      const iters = conics ? SHADER_ITERS.comet : SHADER_ITERS.asteroid;
      for (let k = 0; k < iters; k++) E.assign(E.sub(E.sub(e.mul(sin(E))).sub(M).div(float(1).sub(e.mul(cos(E))))));
      x.assign(a.mul(cos(E).sub(e)));
      y.assign(a.mul(sqrt(float(1).sub(e).mul(float(1).add(e)))).mul(sin(E)));
    };
    if (!conics) ellipse();
    else {
      If(e.lessThan(1.0), ellipse).ElseIf(e.sub(1.0).lessThan(1e-6), () => {
        // parabola (Barker): s = Y - 1/Y, Y = cbrt(1.5 B + sqrt(1 + 2.25 B²)), B = sqrt(mu / 2q³) t
        const B = sqrt(u.mu.div(q.mul(q).mul(q).mul(2.0))).mul(t);
        const w = B.mul(1.5);
        const Y = pow(w.add(sqrt(w.mul(w).add(1.0))), 1.0 / 3.0);
        const s = Y.sub(float(1.0).div(Y));
        x.assign(q.mul(float(1.0).sub(s.mul(s))));
        y.assign(q.mul(s).mul(2.0));
      }).Else(() => {
        const a = q.div(e.sub(1.0));
        const n = sqrt(u.mu.div(a.mul(a).mul(a)));
        const M = n.mul(t);
        const F = sign(M).mul(log(abs(M).mul(2.0).div(e).add(1.8))).toVar();
        for (let k = 0; k < SHADER_ITERS.comet; k++) F.assign(F.sub(e.mul(sinh(F)).sub(F).sub(M).div(e.mul(cosh(F)).sub(1.0))));
        x.assign(a.mul(e.sub(cosh(F))));
        y.assign(a.mul(sqrt(e.sub(1.0).mul(e.add(1.0)))).mul(sinh(F)));
      });
    }
    const cO = cos(elA.w);
    const sO = sin(elA.w);
    const cw = cos(elB.x);
    const sw = sin(elB.x);
    const ci = cos(elA.z);
    const si = sin(elA.z);
    const P = vec3(cw.mul(cO).sub(sw.mul(sO).mul(ci)), cw.mul(sO).add(sw.mul(cO).mul(ci)), sw.mul(si));
    const Q = vec3(sw.negate().mul(cO).sub(cw.mul(sO).mul(ci)), sw.negate().mul(sO).add(cw.mul(cO).mul(ci)), cw.mul(si));
    return P.mul(x).add(Q.mul(y));
  })();
}

export interface OrbitPoints {
  mesh: THREE.Mesh;
  geometry: THREE.InstancedBufferGeometry;
  material: THREE.PointsNodeMaterial;
  uniforms: OrbitUniforms;
  elA: THREE.InstancedBufferAttribute | THREE.InstancedInterleavedBuffer;
  /** objects [0, quadCount) are quads; the rest (if any) are 1-px dots */
  quadCount: number;
  dots?: THREE.Points;
}

/**
 * Instanced points over `data`: either the tiles' interleaved 7-float records (q, e, i, node,
 * peri, tp, H; `stride7`) or two vec4 arrays (satellites, updated in place).
 * `tagColor`: optional colours picked by elB.w (satellite groups), else the uniform colour.
 */
export function makeOrbitPoints(opts: {
  count: number;
  records?: Float32Array; // interleaved, 7 floats per object
  elA?: Float32Array; // 4 per object
  elB?: Float32Array; // 4 per object
  uniforms: OrbitUniforms;
  conics: boolean;
  tagColors?: THREE.Vector3[];
  name: string;
  /** records only: draw the first quadCount as quads, the rest as 1-px dots */
  quadCount?: number;
}): OrbitPoints {
  const g = new THREE.InstancedBufferGeometry();
  g.setIndex(QUAD.index!.clone());
  g.setAttribute('position', QUAD.getAttribute('position').clone());
  g.setAttribute('uv', QUAD.getAttribute('uv').clone());
  let elAttr: OrbitPoints['elA'];
  if (opts.records) {
    const ib = new THREE.InstancedInterleavedBuffer(opts.records, 7, 1);
    g.setAttribute('elA', new THREE.InterleavedBufferAttribute(ib, 4, 0));
    g.setAttribute('elB', new THREE.InterleavedBufferAttribute(ib, 3, 4));
    elAttr = ib;
  } else {
    const a = new THREE.InstancedBufferAttribute(opts.elA!, 4);
    const b = new THREE.InstancedBufferAttribute(opts.elB!, 4);
    a.setUsage(THREE.DynamicDrawUsage);
    b.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('elA', a);
    g.setAttribute('elB', b);
    elAttr = a;
  }
  g.instanceCount = opts.count;
  const U = opts.uniforms as unknown as Record<string, N>;
  const elA = attribute('elA', 'vec4');
  const elB = opts.records ? vec4(attribute('elB', 'vec3'), 0.0) : attribute('elB', 'vec4');
  const pos = keplerNode(elA, elB, opts.uniforms, opts.conics);
  const mv = modelViewMatrix.mul(vec4(pos, 1.0));
  const r = max(mv.xyz.length(), 1e-12);
  const H = elB.z;
  const hw = clamp(pow(float(10.0), H.sub(U.hBright).mul(-0.4)), U.floor, 1.0);
  const near = clamp(U.focus.div(r).pow(2.0), 0.25, 4.0);
  const I = U.gain.mul(hw).mul(near);
  // size grows with brightness (log), from sizeMin to sizeMax CSS px
  const sz = mix(U.sizeMin, U.sizeMax, clamp(float(1.0).add(log(hw).div(Math.log(10) * 1.6)), 0.0, 1.0)).mul(min(near, 1.6));
  let col: N = U.color;
  if (opts.tagColors?.length) {
    const tc = opts.tagColors.map((c) => vec3(c.x, c.y, c.z));
    col = tc[tc.length - 1];
    for (let k = tc.length - 2; k >= 0; k--) col = select(elB.w.lessThan(k + 0.5), tc[k], col);
  }
  const vC: N = varying(col, `vOrbC_${opts.name.replace(/\W/g, "_")}`);
  const vI: N = varying(I, `vOrbI_${opts.name.replace(/\W/g, "_")}`);
  const keep = I.greaterThan(1e-4).and(mv.z.lessThan(0.0));
  const material = new THREE.PointsNodeMaterial({
    transparent: true, depthTest: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: false,
  });
  material.positionNode = pos;
  material.sizeNode = select(keep, sz, float(0.0));
  material.colorNode = Fn(() => {
    const p = uv().mul(2.0).sub(1.0);
    const r2 = dot(p, p);
    If(r2.greaterThan(1.0), () => {
      Discard();
    });
    return vC.mul(vI.mul(exp(r2.mul(-3.0)).sub(0.0498).div(0.9502)));
  })();
  material.opacityNode = float(1.0);
  material.name = `orbit-points-${opts.name}`;
  const mesh = new THREE.Mesh(g, material);
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.renderOrder = 13;
  mesh.name = opts.name;
  const out: OrbitPoints = { mesh, geometry: g, material, uniforms: opts.uniforms, elA: elAttr, quadCount: opts.count };
  if (opts.records && opts.quadCount !== undefined && opts.quadCount < opts.count) {
    g.instanceCount = opts.quadCount;
    out.quadCount = opts.quadCount;
    out.dots = makeDots(opts.records, opts.quadCount, opts.count, opts.uniforms, opts.conics, opts.name);
  }
  return out;
}

/**
 * The faint tail (records [from, count)) as 1-px point primitives: one vertex per object, so the
 * Kepler solve runs once per object instead of four times, and no quad is rasterised. Measured on
 * an M4 Pro (scripts/perf_smallbodies.mjs) the layer was fill-bound with quads alone: 1.58 M
 * 1-4 px quads took 12 ms (inner system) to 29 ms (whole Kuiper belt in view) of GPU time.
 */
function makeDots(records: Float32Array, from: number, count: number, U0: OrbitUniforms, conics: boolean, name: string): THREE.Points {
  const g = new THREE.BufferGeometry();
  const ib = new THREE.InterleavedBuffer(records, 7);
  // 'position' only gives three the vertex count; the shader places the point
  g.setAttribute('position', new THREE.InterleavedBufferAttribute(ib, 3, 0));
  g.setAttribute('elA', new THREE.InterleavedBufferAttribute(ib, 4, 0));
  g.setAttribute('elB', new THREE.InterleavedBufferAttribute(ib, 3, 4));
  g.setDrawRange(from, count - from);
  const U = U0 as unknown as Record<string, N>;
  const elA = attribute('elA', 'vec4');
  const elB = vec4(attribute('elB', 'vec3'), 0.0);
  const pos = keplerNode(elA, elB, U0, conics);
  const mv = modelViewMatrix.mul(vec4(pos, 1.0));
  const r = max(mv.xyz.length(), 1e-12);
  const hw = clamp(pow(float(10.0), elB.z.sub(U.hBright).mul(-0.4)), U.floor, 1.0);
  const near = clamp(U.focus.div(r).pow(2.0), 0.25, 4.0);
  // a 1-px dot carries about the light of a ~1.2 px Gaussian quad of the same intensity
  const vI: N = varying(U.gain.mul(hw).mul(near).mul(U.dotGain), `vOrbD_${name.replace(/\W/g, '_')}`);
  const material = new THREE.PointsNodeMaterial({ transparent: true, depthTest: true, depthWrite: false, blending: THREE.AdditiveBlending });
  material.positionNode = pos;
  material.colorNode = U.color.mul(vI);
  material.opacityNode = float(1.0);
  material.name = `orbit-dots-${name}`;
  const pts = new THREE.Points(g, material);
  pts.frustumCulled = false;
  pts.matrixAutoUpdate = false;
  pts.renderOrder = 13;
  pts.name = `${name}-dots`;
  return pts;
}

/** draw at most `cap` objects (brightest first): quads first, then dots */
export function setOrbitCap(p: OrbitPoints, count: number, cap: number) {
  const n = Math.min(count, cap);
  p.geometry.instanceCount = Math.min(n, p.quadCount);
  if (p.dots) p.dots.geometry.setDrawRange(p.quadCount, Math.max(0, n - p.quadCount));
}

/** mesh matrix: rows of `rot` (row-major 3x3) scaled by `scale`, then translation `t` */
export function setFrameMatrix(m: THREE.Matrix4, rot: readonly number[], scale: number, t: [number, number, number]) {
  m.set(
    rot[0] * scale, rot[1] * scale, rot[2] * scale, t[0],
    rot[3] * scale, rot[4] * scale, rot[5] * scale, t[1],
    rot[6] * scale, rot[7] * scale, rot[8] * scale, t[2],
    0, 0, 0, 1,
  );
}
