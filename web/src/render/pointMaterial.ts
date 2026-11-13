/**
 * Point-cloud material for octree nodes, written in TSL so it compiles to WGSL (WebGPU) or
 * GLSL (three.js's WebGL2 fallback backend) from one source.
 *
 * Each octree node is a Mesh whose InstancedBufferGeometry is a unit quad plus two per-instance
 * attributes: `inst` (xyz relative to the node centre, float32) and `rgbl` (r, g, b, lum as
 * normalised uint8). WebGPU has no sized points, so PointsNodeMaterial's sprite path expands
 * each instance into a screen-aligned quad of `sizeNode` CSS pixels.
 *
 * Relative-to-eye (contract section 5): the camera sits at the world origin and each node's
 * Object3D.position = node centre - camera position, computed in float64 on the CPU every frame;
 * modelViewMatrix therefore carries a small translation for nearby nodes.
 *
 * The appearance model is documented in brightness.ts; keep the two in sync.
 */

import * as THREE from 'three/webgpu';
import {
  Discard, Fn, If, attribute, dot, exp, float, fract, length, log, max, min, mix, modelViewMatrix, pow, select,
  sin, smoothstep, uniform, uv, varying, vec2, vec3, vec4, cos,
} from 'three/tsl';
import { BASE_PX, GAL_MAX_PX, STAR_MAX_PX, type PointKind } from './brightness';

export interface PointUniforms {
  mRef: { value: number };
  pxPerRad: { value: number };
  dpr: { value: number };
  opacity: { value: number };
}

export interface PointMaterial {
  material: THREE.PointsNodeMaterial;
  uniforms: PointUniforms;
}

const LOG10 = Math.LN10;

export function createPointMaterial(kind: PointKind): PointMaterial {
  const mRef = uniform(0);
  const pxPerRad = uniform(1000); // device px per radian
  const dpr = uniform(1);
  const opacity = uniform(1);
  const isGal = kind === 'galaxy';

  const inst = attribute('inst', 'vec3');
  const rgbl = attribute('rgbl', 'vec4');

  // ---- vertex stage: apparent magnitude -> size (device px) and peak intensity
  const mv = modelViewMatrix.mul(vec4(inst, 1.0));
  const r = max(length(mv.xyz), 1e-7);
  const code = rgbl.w.mul(255.0);
  const M = isGal ? float(-14.0).sub(code.div(20.0)) : float(20.0).sub(code.div(10.0));
  const m = M.add(log(r.div(10.0)).mul(5.0 / LOG10));
  const flux = pow(float(10.0), m.sub(mRef).mul(-0.4));
  const base = dpr.mul(BASE_PX);
  const grow = min(max(pow(flux, 0.25), 1.0), STAR_MAX_PX / BASE_PX);
  const psfSize = base.mul(grow);
  const phys = float(1e4).mul(pow(float(10.0), M.add(21.0).mul(-0.12))).div(r).mul(pxPerRad).mul(2.0);
  const size = isGal ? max(psfSize, phys) : psfSize;
  // inside / right next to a galaxy: fade it out instead of filling the screen
  const fade = isGal ? float(1.0).sub(smoothstep(dpr.mul(GAL_MAX_PX), dpr.mul(GAL_MAX_PX * 4), size)) : float(1.0);
  const ratio = base.div(size);
  const intensity = min(flux.mul(ratio).mul(ratio), 4000.0).mul(fade).mul(opacity);
  const maxPx = dpr.mul(isGal ? GAL_MAX_PX : STAR_MAX_PX);
  const drawPx = min(size, maxPx);
  // invisible or behind the camera: collapse the quad
  const keep = intensity.greaterThan(2e-4).and(mv.z.lessThan(0.0));
  const sizeCss = select(keep, drawPx.div(dpr), float(0.0));

  const vColor = varying(rgbl.xyz, 'vColor');
  const vI = varying(intensity, 'vI');
  // galaxies: per-point ellipse orientation and axis ratio from a position hash
  const h1 = fract(sin(dot(inst, vec3(12.9898, 78.233, 37.719))).mul(43758.5453));
  const h2 = fract(sin(dot(inst.zxy, vec3(39.346, 11.135, 83.155))).mul(24634.6345));
  // below ~4 px an ellipse only aliases into dashes, so small galaxies stay round
  const axis = mix(1.0, mix(0.25, 1.0, h2), smoothstep(dpr.mul(3.0), dpr.mul(9.0), drawPx));
  const vShape = varying(vec3(cos(h1.mul(6.2831853)), sin(h1.mul(6.2831853)), axis), 'vShape');

  // ---- fragment stage: sprite profile
  const colorNode = Fn(() => {
    const p = uv().mul(2.0).sub(1.0);
    let a;
    if (!isGal) {
      // star: Gaussian core + faint wide wing, peak 1
      const r2 = dot(p, p);
      If(r2.greaterThan(1.0), () => {
        Discard();
      });
      a = exp(r2.mul(-6.0)).add(exp(r2.mul(-1.6)).mul(float(1.0).sub(r2)).mul(0.06));
    } else {
      // galaxy: exponential-disc ellipse
      const q = vec2(dot(p, vShape.xy), dot(p, vec2(vShape.y.negate(), vShape.x)).div(vShape.z));
      const rr = length(q);
      If(rr.greaterThan(1.0), () => {
        Discard();
      });
      a = exp(rr.mul(-4.2)).mul(float(1.0).sub(rr.mul(rr)));
    }
    return vColor.mul(vI).mul(a);
  })();

  const material = new THREE.PointsNodeMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: false,
  });
  material.positionNode = inst;
  material.sizeNode = sizeCss;
  material.colorNode = colorNode;
  material.opacityNode = float(1.0);
  material.name = `points-${kind}`;
  return { material, uniforms: { mRef, pxPerRad, dpr, opacity } as unknown as PointUniforms };
}

/** unit quad shared by all point meshes (positions in [-0.5, 0.5], uv in [0, 1]) */
export const QUAD = new THREE.PlaneGeometry(1, 1);

/** Instanced geometry for one octree node. */
export function makeNodeGeometry(positions: Float32Array, rgbl: Uint8Array, count: number, radius: number): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  // own copies of the 4-vertex quad, so disposing one node never frees another node's buffers
  g.setIndex(QUAD.index!.clone());
  g.setAttribute('position', QUAD.getAttribute('position').clone());
  g.setAttribute('uv', QUAD.getAttribute('uv').clone());
  g.setAttribute('inst', new THREE.InstancedBufferAttribute(positions, 3));
  g.setAttribute('rgbl', new THREE.InstancedBufferAttribute(rgbl, 4, true));
  g.instanceCount = count;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius);
  return g;
}
