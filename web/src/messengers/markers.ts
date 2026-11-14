/**
 * Markers of the multi-messenger layers (FRBs, neutrinos), in two families:
 *
 *  - SKY markers: a direction only (no distance). Drawn on a camera-centred sphere of radius
 *    SKY_R pc (the camera sits at the world origin, src/nav/controller.ts), i.e. at infinity, like
 *    the all-sky image, and fade with it (gone beyond ~2.5 kpc from the Sun, where a direction from
 *    the Sun no longer is one from the camera). Neutrino alerts also get their 90 % error region
 *    as an outline.
 *  - 3D markers: catalogue entries with a real position (FRB hosts with a redshift, the two
 *    identified neutrino sources), re-centred on the camera every frame in float64.
 *
 * Glyphs (fragment shader on an instanced quad, additive into the HDR scene light): ring = FRB,
 * four-point star = neutrino, ring + star = identified neutrino source, ring + dot = FRB host.
 * Picking is on the CPU (a few thousand projections per click).
 */

import * as THREE from 'three/webgpu';
import { Discard, Fn, If, abs, attribute, float, length, max, select, smoothstep, uniform, uv, varying, vec4 } from 'three/tsl';
import { QUAD, srgbToLinearNode } from '../render/pointMaterial';
import type { CatalogEntry } from '../data/manifest';
import type { Vec3 } from '../math/frames';
import type { SkyItem } from './data';

/** radius (pc) of the camera-centred sphere the sky markers sit on: inside the far plane (>= 1e11) */
export const SKY_R = 1e10;

export const GLYPH = { ring: 0, star: 1, source: 2, host: 3 } as const;

export interface Marker3D {
  entry: CatalogEntry;
  xyz: Vec3;
  glyph: number;
  sizePx: number;
  weight: number;
}

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function glyphMaterial(fade: any): THREE.PointsNodeMaterial {
  const m = new THREE.PointsNodeMaterial({
    transparent: true, depthTest: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: false,
  });
  const aux = attribute('aux', 'vec3'); // size css px, glyph, weight
  const vCol: any = varying(srgbToLinearNode(attribute('col', 'vec3')), 'vMkCol');
  const vAux: any = varying(aux, 'vMkAux');
  m.positionNode = attribute('inst', 'vec3');
  m.sizeNode = aux.x;
  m.colorNode = Fn(() => {
    const p = uv().mul(2.0).sub(1.0);
    const r = length(p);
    If(r.greaterThan(1.0), () => {
      Discard();
    });
    const g = vAux.y;
    const ring = smoothstep(0.5, 0.66, r).mul(float(1.0).sub(smoothstep(0.8, 0.98, r)));
    const ax = abs(p.x);
    const ay = abs(p.y);
    const star = max(float(1.0).sub(smoothstep(0.0, 0.16, ax)).mul(float(1.0).sub(ay)), float(1.0).sub(smoothstep(0.0, 0.16, ay)).mul(float(1.0).sub(ax)));
    const dot = float(1.0).sub(smoothstep(0.12, 0.3, r));
    // glyph 0 ring, 1 star, 2 ring + star, 3 ring + dot
    const a = select(g.lessThan(0.5), ring, select(g.lessThan(1.5), star, select(g.lessThan(2.5), max(ring, star.mul(0.9)), max(ring, dot))));
    const I = a.mul(vAux.z).mul(fade);
    If(I.lessThan(0.002), () => {
      Discard();
    });
    return vec4(vCol.mul(I).mul(0.9), 1.0);
  })();
  m.opacityNode = float(1.0);
  return m;
}

function spriteGeometry(n: number): { g: THREE.InstancedBufferGeometry; inst: THREE.InstancedBufferAttribute; col: THREE.InstancedBufferAttribute; aux: THREE.InstancedBufferAttribute } {
  const g = new THREE.InstancedBufferGeometry();
  g.setIndex(QUAD.index!.clone());
  g.setAttribute('position', QUAD.getAttribute('position').clone());
  g.setAttribute('uv', QUAD.getAttribute('uv').clone());
  const inst = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 3), 3);
  const col = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 3), 3);
  const aux = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 3), 3);
  inst.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('inst', inst);
  g.setAttribute('col', col);
  g.setAttribute('aux', aux);
  g.instanceCount = n;
  return { g, inst, col, aux };
}

/** one layer's markers: sky items (static, at infinity) + 3D items (re-centred per frame) + region outlines */
export class MarkerSet {
  readonly group = new THREE.Group();
  private readonly uSkyFade = uniform(1);
  private readonly u3dFade = uniform(1);
  private readonly uLineFade = uniform(1);
  private sky: SkyItem[] = [];
  private m3d: Marker3D[] = [];
  private skyMesh: THREE.Mesh | null = null;
  private lines: THREE.LineSegments | null = null;
  private mesh3d: THREE.Mesh | null = null;
  private inst3d: THREE.InstancedBufferAttribute | null = null;
  private readonly rgb: [number, number, number];
  visible = true;
  opacity = 1;
  /** last frame's fades, for picking */
  private fades = { sky: 0, d3: 0 };

  constructor(readonly id: string, color: string) {
    this.rgb = hexRgb(color);
    this.group.name = `messenger-${id}`;
    this.group.frustumCulled = false;
  }

  setSky(items: SkyItem[]) {
    this.sky = items;
    if (this.skyMesh) this.group.remove(this.skyMesh);
    if (this.lines) this.group.remove(this.lines);
    const { g, inst, col, aux } = spriteGeometry(items.length);
    items.forEach((it, i) => {
      inst.array.set(it.dir, i * 3);
      col.array.set(this.rgb, i * 3);
      aux.array.set([it.big ? (it.glyph === GLYPH.star ? 18 : 11) : it.glyph === GLYPH.star ? 12 : 7, it.glyph, it.weight], i * 3);
    });
    this.skyMesh = new THREE.Mesh(g, glyphMaterial(this.uSkyFade));
    this.skyMesh.scale.setScalar(SKY_R);
    this.skyMesh.frustumCulled = false;
    this.skyMesh.renderOrder = 2;
    this.group.add(this.skyMesh);
    // error regions: closed loops as line segments (unit vectors; the mesh scale puts them at SKY_R)
    const seg: number[] = [];
    const segCol: number[] = [];
    for (const it of items) {
      if (!it.region) continue;
      const w = 0.12 + 0.5 * it.weight;
      const c = this.rgb.map((v) => v * w);
      for (let k = 0; k < it.region.length; k++) {
        const a = it.region[k];
        const b = it.region[(k + 1) % it.region.length];
        seg.push(...a, ...b);
        segCol.push(...c, ...c);
      }
    }
    if (seg.length) {
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
      lg.setAttribute('color', new THREE.Float32BufferAttribute(segCol, 3));
      const lm = new THREE.LineBasicNodeMaterial({ transparent: true, depthTest: true, depthWrite: false, blending: THREE.AdditiveBlending });
      lm.colorNode = vec4(srgbToLinearNode(attribute('color', 'vec3')).mul(this.uLineFade), 1.0);
      lm.opacityNode = float(1.0);
      this.lines = new THREE.LineSegments(lg, lm);
      this.lines.scale.setScalar(SKY_R);
      this.lines.frustumCulled = false;
      this.lines.renderOrder = 1;
      this.group.add(this.lines);
    }
  }

  set3D(items: Marker3D[]) {
    this.m3d = items;
    if (this.mesh3d) this.group.remove(this.mesh3d);
    const { g, inst, col, aux } = spriteGeometry(items.length);
    items.forEach((it, i) => {
      col.array.set(this.rgb, i * 3);
      aux.array.set([it.sizePx, it.glyph, it.weight], i * 3);
    });
    this.inst3d = inst;
    this.mesh3d = new THREE.Mesh(g, glyphMaterial(this.u3dFade));
    this.mesh3d.frustumCulled = false;
    this.mesh3d.renderOrder = 3;
    this.group.add(this.mesh3d);
  }

  get skyItems(): readonly SkyItem[] {
    return this.sky;
  }

  /** skyFade: the all-sky image's distance fade (1 near the Sun) */
  update(cam: Vec3, skyFade: number) {
    const on = this.visible ? this.opacity : 0;
    this.fades = { sky: on * skyFade, d3: on };
    this.uSkyFade.value = this.fades.sky;
    this.uLineFade.value = this.fades.sky;
    this.u3dFade.value = this.fades.d3;
    if (this.skyMesh) this.skyMesh.visible = this.fades.sky > 0.002;
    if (this.lines) this.lines.visible = this.fades.sky > 0.002;
    if (this.mesh3d && this.inst3d) {
      this.mesh3d.visible = this.fades.d3 > 0.002 && this.m3d.length > 0;
      const a = this.inst3d.array as Float32Array;
      this.m3d.forEach((m, i) => {
        a[i * 3] = m.xyz[0] - cam[0];
        a[i * 3 + 1] = m.xyz[1] - cam[1];
        a[i * 3 + 2] = m.xyz[2] - cam[2];
      });
      this.inst3d.needsUpdate = true;
    }
  }

  /** nearest marker within `radiusPx` CSS px of (x, y): 3D markers first, then sky markers */
  pickAt(x: number, y: number, cam: Vec3, camera: THREE.PerspectiveCamera, w: number, h: number, radiusPx = 10): { entry: CatalogEntry; d: number } | null {
    const v = new THREE.Vector3();
    let best: { entry: CatalogEntry; d: number } | null = null;
    const test = (px: number, py: number, pz: number, entry: CatalogEntry, r: number) => {
      v.set(px, py, pz).applyMatrix4(camera.matrixWorldInverse);
      if (v.z >= 0) return;
      v.applyMatrix4(camera.projectionMatrix);
      const sx = (v.x * 0.5 + 0.5) * w;
      const sy = (-v.y * 0.5 + 0.5) * h;
      const d = Math.hypot(sx - x, sy - y);
      if (d <= r && (!best || d < best.d)) best = { entry, d };
    };
    if (this.fades.d3 > 0.05) for (const m of this.m3d) test(m.xyz[0] - cam[0], m.xyz[1] - cam[1], m.xyz[2] - cam[2], m.entry, radiusPx + 3);
    if (best) return best;
    if (this.fades.sky > 0.05) for (const s of this.sky) test(s.dir[0], s.dir[1], s.dir[2], s.entry, radiusPx);
    return best;
  }

  /** screen positions of the visible markers (tests and captures) */
  count() {
    return { sky: this.sky.length, d3: this.m3d.length, regions: this.sky.filter((s) => s.region).length, fades: { ...this.fades } };
  }
}

/** marker size (CSS px) of a 3D item: identified neutrino sources stand out */
export function size3d(glyph: number): number {
  return glyph === GLYPH.source ? 22 : 10;
}
