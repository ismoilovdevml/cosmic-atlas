/**
 * Point materials (TSL → WGSL on WebGPU, GLSL on three.js's WebGL2 fallback), one set per layer:
 *
 *   material      display: instanced screen-aligned quads (PointsNodeMaterial sprite path)
 *   pickMaterial  GPU picking: same geometry and visibility gate, writes (point index, node slot,
 *                 layer code) as floats into a 1×1 RGBA32F target; brightest point wins via depth
 *   uncMaterial   "distance uncertainty" mode: each point becomes a quad stretched along the
 *                 Sun→point line of sight from dist_lo to dist_hi, dimmed so its light is conserved
 *
 * plus one blob material (subtree aggregates, see streamer.ts).
 *
 * Each octree node is a Mesh whose InstancedBufferGeometry is a unit quad plus per-instance
 * attributes `inst` (xyz relative to the node centre, f32) and `rgbl` (sRGB r,g,b + lum, unorm8);
 * `unc` (dist_lo/d, dist_hi/d) is added once the node's pick records are loaded.
 *
 * Relative-to-eye (contract section 5): the camera sits at the origin; each node's
 * Object3D.position = centre − camera, computed in float64 on the CPU every frame.
 *
 * Colour is handled in LINEAR light: sRGB bytes are decoded here, summed in the half-float target,
 * tone-mapped and sRGB-encoded once in post.ts. Photometry: see brightness.ts (CPU twin).
 */

import * as THREE from 'three/webgpu';
import {
  Discard, Fn, If, attribute, cameraProjectionMatrix, cos, dot, exp, float, fract, instanceIndex, length, log, max,
  min, mix, modelViewMatrix, positionGeometry, pow, select, sin, smoothstep, uniform, uv, varying, vec2,
  vec3, vec4, viewportSize,
} from 'three/tsl';
import { maskFactor } from './galaxyMask';
import { BASE_PX, E4, GAL_MAX_PX, K_GAUSS, KNEE, REF_PX_PER_RAD, STAR_MAX_PX, type PointKind } from './brightness';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any; // TSL node (the bundled typings are too narrow for generic helpers)

export interface PointUniforms {
  mRef: { value: number };
  pxPerRad: { value: number };
  dpr: { value: number };
  opacity: { value: number };
  /** view-space position of the Sun (for line-of-sight elongation) */
  sunView: { value: THREE.Vector3 };
  /** 0 = flux photometry, 1 = galaxy density mode (fixed sprite, exposure from screen density) */
  densityMix: { value: number };
  /** density mode: peak intensity of one galaxy sprite (linear, set from the 98th-percentile density) */
  densityK: { value: number };
  /** density mode: sprite diameter, CSS px */
  fixedPx: { value: number };
  /** thin slab: view-space z of the plane through the focus, and its half-thickness (pc; huge = off) */
  slabZ: { value: number };
  slabHalf: { value: number };
}

/** density-mode sprite diameter, CSS px */
export const DENSITY_SPRITE_PX = 2.2;
export const SLAB_OFF = 1e30;

export function createPointUniforms(): PointUniforms {
  return {
    mRef: uniform(0), pxPerRad: uniform(1000), dpr: uniform(1), opacity: uniform(1),
    sunView: uniform(new THREE.Vector3()), densityMix: uniform(0), densityK: uniform(0.3),
    fixedPx: uniform(DENSITY_SPRITE_PX), slabZ: uniform(0), slabHalf: uniform(SLAB_OFF),
  } as unknown as PointUniforms;
}

/** soft-edged slab weight for a view-space z (1 inside, 0 outside, 15 % ramp at the faces) */
export function slabWeight(z: N, u: PointUniforms): N {
  const U = u as unknown as Record<string, N>;
  const dz = z.sub(U.slabZ).abs();
  return float(1.0).sub(smoothstep(U.slabHalf.mul(0.85), U.slabHalf, dz));
}

export interface LayerMaterials {
  material: THREE.PointsNodeMaterial;
  pickMaterial: THREE.PointsNodeMaterial;
  uncMaterial: THREE.MeshBasicNodeMaterial;
  uniforms: PointUniforms;
}

const LOG10 = Math.LN10;
/** visibility gate: below this peak (after per-node alpha) nothing is drawn */
export const DRAW_GATE = 2e-4;
/** a point must be at least this bright to take a click (same quantity as the draw gate) */
export const PICK_GATE = 0.01;
/** minimum pick footprint radius, CSS px */
export const PICK_MIN_RADIUS_PX = 3.5;

/** sRGB → linear (exact piecewise IEC 61966-2-1) */
export const srgbToLinearNode = (c: N): N =>
  select(c.lessThanEqual(0.04045), c.div(12.92), pow(c.add(0.055).div(1.055), 2.4));

/**
 * TSL photometry; see brightness.ts appearance() for the CPU twin.
 * Returns device-px drawn size, the linear peak (pre-knee) and the inside-a-galaxy fade.
 */
export function photometry(M: N, r: N, physRadiusPc: N | null, maxCssPx: number, u: PointUniforms) {
  const U = u as unknown as Record<string, N>;
  const m = M.add(log(r.div(10.0)).mul(5.0 / LOG10));
  const flux = pow(float(10.0), m.sub(U.mRef).mul(-0.4));
  const base = U.dpr.mul(BASE_PX);
  // the glow grows freely with flux; only the drawn size is capped (peak from the pre-ceiling size)
  const psf = base.mul(max(pow(flux, 0.25), 1.0));
  const trueSize = physRadiusPc ? max(psf, physRadiusPc.mul(2.0).div(r).mul(U.pxPerRad)) : psf;
  const rRef = trueSize.mul(0.5 * REF_PX_PER_RAD).div(U.pxPerRad);
  const peak = flux.div(rRef.mul(rRef).mul(K_GAUSS));
  const maxPx = U.dpr.mul(maxCssPx);
  const fade = physRadiusPc ? float(1.0).sub(smoothstep(maxPx, maxPx.mul(4.0), trueSize)) : float(1.0);
  return { size: min(trueSize, maxPx), peak, fade, flux, m };
}

/** rim-zeroed Gaussian of the squared normalised radius */
export const gaussProfile = (u2: N): N => exp(u2.mul(-4.0)).sub(E4).div(1.0 - E4);
/** hue-preserving knee, applied to the scalar before the colour tint */
export const kneeNode = (I: N): N => float(KNEE).mul(float(1.0).sub(exp(I.div(-KNEE))));

/** per-object uniforms read from Object3D.userData at draw time */
export const objectAlpha = () => uniform(1).onObjectUpdate(({ object }: any) => object?.userData?.alpha ?? 1);
const objectSlot = () => uniform(0).onObjectUpdate(({ object }: any) => object?.userData?.slot ?? 0);

export function createLayerMaterials(kind: PointKind, layerCode: number): LayerMaterials {
  const uniforms = createPointUniforms();
  const U = uniforms as unknown as Record<string, N>;
  const isGal = kind === 'galaxy';
  const alpha: N = objectAlpha();
  const slot: N = objectSlot();

  const inst = attribute('inst', 'vec3');
  const rgbl = attribute('rgbl', 'vec4');
  const mv = modelViewMatrix.mul(vec4(inst, 1.0));
  const r = max(length(mv.xyz), 1e-7);
  const code = rgbl.w.mul(255.0);
  const M = isGal ? float(-14.0).sub(code.div(20.0)) : float(20.0).sub(code.div(10.0));
  const phys = isGal ? float(1e4).mul(pow(float(10.0), M.add(21.0).mul(-0.12))) : null;
  const ph = photometry(M, r, phys, isGal ? GAL_MAX_PX : STAR_MAX_PX, uniforms);
  // galaxies at survey scales: fixed small sprite, intensity from the screen-density exposure with a
  // mild boost for apparently bright galaxies; resolved/nearby galaxies keep flux photometry
  const dm: N = isGal ? U.densityMix : float(0.0);
  const brightBoost = min(max(float(1.0).add(float(17.5).sub(ph.m).mul(0.25)), 1.0), 2.5);
  const dSize = max(U.dpr.mul(U.fixedPx), isGal ? min(ph.size, U.dpr.mul(GAL_MAX_PX)).mul(ph.fade) : float(0.0));
  const dPeak = U.densityK.mul(brightBoost).mul(U.dpr.mul(U.fixedPx).div(dSize).pow(2.0));
  const sizeMixed: N = mix(ph.size, dSize, dm);
  // galaxies drawn as an oriented disk / thumbnail (galaxyShapes.ts) hand their light over from
  // these points through the shared dot-weight mask
  const dotW: N = isGal ? maskFactor(mv.xyz, U.sunView) : float(1.0);
  const intensity: N = mix(ph.peak.mul(ph.fade), dPeak, dm).mul(U.opacity).mul(alpha).mul(slabWeight(mv.z, uniforms)).mul(dotW);
  const inFront: N = mv.z.lessThan(0.0);
  const drawKeep: N = intensity.greaterThan(DRAW_GATE).and(inFront);

  const vColor: N = varying(srgbToLinearNode(rgbl.xyz), 'vColor');
  const vI: N = varying(intensity, 'vI');
  // galaxies: ellipse orientation / axis ratio from a position hash; round below ~4 px (aliasing)
  const h1 = fract(sin(dot(inst, vec3(12.9898, 78.233, 37.719))).mul(43758.5453));
  const h2 = fract(sin(dot(inst.zxy, vec3(39.346, 11.135, 83.155))).mul(24634.6345));
  const axis = mix(1.0, mix(0.25, 1.0, h2), smoothstep(U.dpr.mul(3.0), U.dpr.mul(9.0), ph.size));
  const vShape: N = varying(vec3(cos(h1.mul(6.2831853)), sin(h1.mul(6.2831853)), axis), 'vShape');

  const shapeU2 = (p: N): N => {
    if (!isGal) return dot(p, p);
    const q = vec2(dot(p, vShape.xy), dot(p, vec2(vShape.y.negate(), vShape.x)).div(vShape.z));
    return dot(q, q);
  };

  // ---- display
  const material = new THREE.PointsNodeMaterial({
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: false,
  });
  material.positionNode = inst;
  material.sizeNode = select(drawKeep, sizeMixed.div(U.dpr), float(0.0));
  material.colorNode = Fn(() => {
    const u2 = shapeU2(uv().mul(2.0).sub(1.0));
    If(u2.greaterThan(1.0), () => {
      Discard();
    });
    return vColor.mul(kneeNode(vI.mul(gaussProfile(u2))));
  })();
  material.opacityNode = float(1.0);
  material.name = `points-${kind}`;

  // ---- pick: same gate quantity, minimum footprint, brightest wins (depth = 1/(1+I))
  const pickKeep: N = intensity.greaterThan(PICK_GATE).and(inFront);
  const pickSize = max(sizeMixed, U.dpr.mul(2 * PICK_MIN_RADIUS_PX));
  const vPickI: N = varying(intensity, 'vPickI');
  const vIdx: N = varying(float(instanceIndex), 'vIdx');
  const pickMaterial = new THREE.PointsNodeMaterial({
    transparent: false, depthTest: true, depthWrite: true, blending: THREE.NoBlending, sizeAttenuation: false,
  });
  pickMaterial.positionNode = inst;
  pickMaterial.sizeNode = select(pickKeep, pickSize.div(U.dpr), float(0.0));
  pickMaterial.colorNode = Fn(() => {
    const p = uv().mul(2.0).sub(1.0);
    If(dot(p, p).greaterThan(1.0), () => {
      Discard();
    });
    return vec3(vIdx, slot, float(layerCode));
  })();
  pickMaterial.opacityNode = float(1.0);
  pickMaterial.depthNode = float(1.0).div(vPickI.add(1.0));
  pickMaterial.name = `pick-${kind}`;

  // ---- distance-uncertainty quads along the Sun→point line of sight
  const unc = attribute('unc', 'vec2'); // dist_lo / d, dist_hi / d
  const S = U.sunView;
  const P = mv.xyz;
  const pLo = S.add(P.sub(S).mul(unc.x));
  const pHi = S.add(P.sub(S).mul(unc.y));
  const clipP = cameraProjectionMatrix.mul(vec4(P, 1.0));
  const clipLo = cameraProjectionMatrix.mul(vec4(pLo, 1.0));
  const clipHi = cameraProjectionMatrix.mul(vec4(pHi, 1.0));
  const halfVp = viewportSize.mul(0.5);
  const ndcP = clipP.xy.div(clipP.w);
  // endpoints behind the camera collapse onto the point
  const sLo = select(clipLo.w.greaterThan(0.0), clipLo.xy.div(clipLo.w).sub(ndcP).mul(halfVp), vec2(0.0));
  const sHi = select(clipHi.w.greaterThan(0.0), clipHi.xy.div(clipHi.w).sub(ndcP).mul(halfVp), vec2(0.0));
  const seg = sHi.sub(sLo);
  const segLen = length(seg);
  const dir = select(segLen.greaterThan(1e-3), seg.div(segLen), vec2(1.0, 0.0));
  const perp = vec2(dir.y.negate(), dir.x);
  const w = ph.size; // device px
  const along = positionGeometry.y.add(0.5); // 0 at the lo end, 1 at hi
  const offPx = sLo.add(seg.mul(along)).add(dir.mul(positionGeometry.y.mul(w))).add(perp.mul(positionGeometry.x.mul(w)));
  const uncKeep = drawKeep;
  const uncMaterial = new THREE.MeshBasicNodeMaterial({
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  uncMaterial.vertexNode = select(
    uncKeep,
    vec4(ndcP.add(offPx.div(halfVp)).mul(clipP.w), clipP.z, clipP.w),
    vec4(2.0, 2.0, 2.0, 1.0),
  );
  // light of the round sprite spread over the streak: peak × w / (len + w)
  const vUncI: N = varying(intensity.mul(w.div(segLen.add(w))), 'vUncI');
  const vUncC: N = varying(srgbToLinearNode(rgbl.xyz), 'vUncC');
  uncMaterial.colorNode = Fn(() => {
    const across = uv().x.mul(2.0).sub(1.0);
    const v = uv().y; // 0..1 along
    const ends = smoothstep(0.0, 0.18, v).mul(smoothstep(0.0, 0.18, float(1.0).sub(v)));
    return vUncC.mul(kneeNode(vUncI.mul(gaussProfile(across.mul(across))).mul(ends)));
  })();
  uncMaterial.opacityNode = float(1.0);
  uncMaterial.name = `unc-${kind}`;

  return { material, pickMaterial, uncMaterial, uniforms };
}

/** Blob material for subtree aggregates: a soft extended glow of total luminosity L. */
export function createBlobMaterial(u: PointUniforms): THREE.PointsNodeMaterial {
  const binst = attribute('binst', 'vec3'); // centroid − camera (pc), rewritten every frame
  const bcol = attribute('bcol', 'vec3'); // sRGB 0..1
  const bdat = attribute('bdat', 'vec2'); // (L · blobAlpha, RMS-based sprite radius pc)
  const bn = attribute('bn', 'float'); // galaxy count · blobAlpha (density mode)
  const U = u as unknown as Record<string, N>;
  const mv = modelViewMatrix.mul(vec4(binst, 1.0));
  const r = max(length(mv.xyz), 1e-6);
  const M = float(-2.5).mul(log(max(bdat.x, 1e-30)).div(LOG10));
  const ph = photometry(M, r, bdat.y, GAL_MAX_PX, u);
  // density mode: a blob is n galaxies' worth of fixed sprites, spread over its own footprint
  const fixedDev = U.dpr.mul(U.fixedPx);
  const bSize = max(ph.size, fixedDev);
  const dPeak = U.densityK.mul(bn).mul(fixedDev.div(bSize).pow(2.0));
  const I: N = mix(ph.peak.mul(ph.fade), dPeak, U.densityMix).mul(U.opacity).mul(slabWeight(mv.z, u));
  const keep: N = I.greaterThan(DRAW_GATE).and(mv.z.lessThan(0.0)).and(bdat.x.greaterThan(0.0));
  const vI: N = varying(I, 'vBlobI');
  const vC: N = varying(srgbToLinearNode(bcol), 'vBlobC');
  const mat = new THREE.PointsNodeMaterial({
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: false,
  });
  mat.positionNode = binst;
  mat.sizeNode = select(keep, mix(ph.size, bSize, U.densityMix).div(U.dpr), float(0.0));
  mat.colorNode = Fn(() => {
    const p = uv().mul(2.0).sub(1.0);
    const u2 = dot(p, p);
    If(u2.greaterThan(1.0), () => {
      Discard();
    });
    return vC.mul(kneeNode(vI.mul(gaussProfile(u2))));
  })();
  mat.opacityNode = float(1.0);
  mat.name = 'blobs';
  return mat;
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

