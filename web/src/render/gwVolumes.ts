/**
 * Gravitational-wave localisation volumes: soft translucent ellipsoids.
 *
 * Input: the `loc` block of the gw_event entries of gw-events.json (scripts/build_gw.py): each event
 * is a few ellipsoids fitted to its 90 % credible comoving volume (weight, centre pc, semi-axes pc,
 * quaternion to Galactic). An event is drawn as these ellipsoids, never as a point: without a host
 * galaxy its position is only known to lie somewhere inside them.
 *
 * Shading: each ellipsoid is drawn from its back faces (so it also shows with the camera inside)
 * with the projected profile of the 3D Gaussian it was fitted from (the rim is its 90 % surface), a soft blob
 * that fades to nothing at its rim. Additive, no depth test, like the Milky Way model. Relative to
 * eye: mesh.position = centre − camera (float64 difference) every frame.
 */

import * as THREE from 'three/webgpu';
import { abs, dot, exp, float, max, normalize, normalView, positionView, uniform, vec3, vec4 } from 'three/tsl';
import type { CatalogEntry } from '../data/manifest';
import type { Vec3 } from '../math/frames';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

/** one ellipsoid of an event, [w, cx, cy, cz, a, b, c, qx, qy, qz, qw] in the catalogue */
export interface GwEllipsoid {
  w: number;
  c: Vec3;
  axes: Vec3;
  q: [number, number, number, number];
}

export interface GwEvent {
  entry: CatalogEntry;
  parts: GwEllipsoid[];
}

/** the `loc` block of a gw_event entry → its ellipsoids (malformed rows are skipped) */
export function parseLoc(e: CatalogEntry): GwEllipsoid[] {
  const loc = (e as unknown as { loc?: { e?: number[][] } }).loc;
  if (!loc || !Array.isArray(loc.e)) return [];
  const out: GwEllipsoid[] = [];
  for (const r of loc.e) {
    if (!Array.isArray(r) || r.length !== 11 || !r.every(Number.isFinite)) continue;
    const q: [number, number, number, number] = [r[7], r[8], r[9], r[10]];
    const n = Math.hypot(...q);
    if (!(n > 0) || !(r[4] > 0 && r[5] > 0 && r[6] > 0)) continue;
    out.push({ w: r[0], c: [r[1], r[2], r[3]], axes: [r[4], r[5], r[6]], q: q.map((x) => x / n) as typeof q });
  }
  return out;
}

/** tint by source type (facts.type): BBH blue, NSBH teal, BNS gold */
export function gwTint(type: unknown): [number, number, number] {
  const s = String(type ?? '');
  if (/neutron star–black|neutron star-black/.test(s)) return [0.45, 0.95, 0.85];
  if (/binary neutron/.test(s)) return [1.0, 0.82, 0.45];
  return [0.55, 0.7, 1.0];
}

/**
 * Peak intensity of one ellipsoid (linear light before the asinh tone map of post.ts, which lifts
 * faint values a lot): sqrt(weight) times a size factor, so the many Gpc-wide volumes stay a faint
 * haze and the few well-localised events stand out (a softened "probability per area":
 * (40 Mpc / R)² with R the geometric-mean semi-axis, clamped to [0.0015, 1]). The tone map turns
 * linear 0.001 into a visible grey and a 500 Mpc view looks through ~30 overlapping volumes.
 */
export function gwPeak(p: GwEllipsoid): number {
  const R = Math.cbrt(p.axes[0] * p.axes[1] * p.axes[2]);
  return 0.08 * Math.sqrt(p.w) * Math.min(1, Math.max(0.0015, (4e7 / R) ** 2));
}

/** volumes much larger than the view step back (×0.2 at 3× the camera distance); the overview shows them all */
export function scaleFactor(p: GwEllipsoid, viewDist: number): number {
  const R = Math.cbrt(p.axes[0] * p.axes[1] * p.axes[2]);
  const t = Math.min(1, Math.max(0, Math.log10(R / viewDist / 0.5) / Math.log10(6)));
  return 1 - 0.8 * t * t * (3 - 2 * t);
}

/** hide an ellipsoid the camera is inside (it would only wash out the screen): 0 within 0.8 radii → 1 beyond 1.8 */
export function insideFactor(cam: Vec3, p: GwEllipsoid): number {
  const inv = new THREE.Quaternion(p.q[0], p.q[1], p.q[2], p.q[3]).invert();
  const v = new THREE.Vector3(cam[0] - p.c[0], cam[1] - p.c[1], cam[2] - p.c[2]).applyQuaternion(inv);
  const d = Math.hypot(v.x / p.axes[0], v.y / p.axes[1], v.z / p.axes[2]);
  const t = Math.min(1, Math.max(0, (d - 0.8) / 1.0));
  return t * t * (3 - 2 * t);
}

/** fade-in with the camera's distance from the Sun: the volumes are Mpc to Gpc scale */
export function gwFade(camFromSunPc: number): number {
  const t = Math.min(1, Math.max(0, (Math.log10(Math.max(camFromSunPc, 1)) - 5.5) / 1.0));
  return t * t * (3 - 2 * t);
}

/** ray (origin o, unit direction d) against an ellipsoid: entry distance along the ray, or null */
export function rayEllipsoid(o: Vec3, d: Vec3, p: GwEllipsoid): number | null {
  // into the ellipsoid frame: rotate by the inverse quaternion, then scale by 1/axes
  const inv = new THREE.Quaternion(p.q[0], p.q[1], p.q[2], p.q[3]).invert();
  const ro = new THREE.Vector3(o[0] - p.c[0], o[1] - p.c[1], o[2] - p.c[2]).applyQuaternion(inv);
  const rd = new THREE.Vector3(d[0], d[1], d[2]).applyQuaternion(inv);
  ro.set(ro.x / p.axes[0], ro.y / p.axes[1], ro.z / p.axes[2]);
  rd.set(rd.x / p.axes[0], rd.y / p.axes[1], rd.z / p.axes[2]);
  const a = rd.dot(rd);
  const b = 2 * ro.dot(rd);
  const c = ro.dot(ro) - 1;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  const t0 = (-b - s) / (2 * a);
  const t1 = (-b + s) / (2 * a);
  if (t1 < 0) return null;
  return Math.max(t0, 0);
}

export class GwVolumes {
  readonly group = new THREE.Group();
  visible = true;
  opacity = 1;
  events: GwEvent[] = [];
  private meshes: { mesh: THREE.Mesh; part: GwEllipsoid; ev: GwEvent; u: { gain: N } }[] = [];
  private readonly uFade = uniform(1);
  private selected: string | null = null;
  private geo = new THREE.SphereGeometry(1, 48, 24);

  constructor() {
    this.group.name = 'gw-volumes';
    this.group.renderOrder = -1;
  }

  /** the gw_event entries of the loaded catalogue (call again after a reload) */
  setEntries(entries: CatalogEntry[]) {
    for (const m of this.meshes) {
      this.group.remove(m.mesh);
      (m.mesh.material as THREE.Material).dispose();
    }
    this.meshes = [];
    this.events = entries.filter((e) => e.kind === 'gw_event').map((entry) => ({ entry, parts: parseLoc(entry) })).filter((ev) => ev.parts.length);
    for (const ev of this.events) {
      const tint = gwTint(ev.entry.facts?.type);
      for (const part of ev.parts) {
        const gain = uniform(1);
        const mat = new THREE.MeshBasicNodeMaterial({
          transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
        });
        // projected 3D Gaussian: the rim (|n·v| = 0) is the 2.5-sigma (90 %) surface, so exp(-2.5²/2 (1 - (n·v)²)),
        // shifted so it reaches exactly 0 at the rim
        const nv = abs(dot(normalize(normalView), normalize(positionView)));
        const prof = max(exp(float(-3.125).mul(float(1).sub(nv.mul(nv)))).sub(0.0439).div(0.9561), 0.0);
        const I = (prof as N).mul(this.uFade).mul(gain).mul(float(gwPeak(part)));
        mat.colorNode = vec4(vec3(tint[0], tint[1], tint[2]).mul(I), float(1));
        const mesh = new THREE.Mesh(this.geo, mat);
        mesh.frustumCulled = false;
        mesh.scale.set(part.axes[0], part.axes[1], part.axes[2]);
        mesh.quaternion.set(part.q[0], part.q[1], part.q[2], part.q[3]);
        mesh.name = `gw:${ev.entry.name}`;
        this.group.add(mesh);
        this.meshes.push({ mesh, part, ev, u: { gain } });
      }
    }
  }

  /** brighten one event (its info card is open); null for none */
  highlight(name: string | null) {
    this.selected = name;
  }

  get highlighted(): string | null {
    return this.selected;
  }

  update(cam: Vec3, viewDist: number) {
    const fade = gwFade(Math.hypot(cam[0], cam[1], cam[2])) * this.opacity;
    this.uFade.value = fade;
    this.group.visible = this.visible && fade > 0.002 && this.meshes.length > 0;
    if (!this.group.visible) return;
    const sel = this.selected;
    for (const { mesh, part, ev, u } of this.meshes) {
      mesh.position.set(part.c[0] - cam[0], part.c[1] - cam[1], part.c[2] - cam[2]);
      // the selected event stands out (its own blobs at least clearly visible), the others step back
      const hl = sel === null ? 1 : ev.entry.name === sel ? Math.max(3, 0.08 / gwPeak(part)) : 0.35;
      u.gain.value = hl * insideFactor(cam, part) * (ev.entry.name === sel ? 1 : scaleFactor(part, viewDist));
    }
  }

  /** the event whose volume is under the cursor (nearest entry point along the ray), or null */
  pickAt(x: number, y: number, cam: Vec3, camera: THREE.PerspectiveCamera, W: number, H: number): CatalogEntry | null {
    if (!this.group.visible) return null;
    const ndc = new THREE.Vector3((x / W) * 2 - 1, -(y / H) * 2 + 1, 0.5);
    const dir = ndc.unproject(camera).sub(camera.position).normalize();
    const d: Vec3 = [dir.x, dir.y, dir.z];
    let best: { t: number; vol: number; e: CatalogEntry } | null = null;
    for (const ev of this.events) {
      for (const p of ev.parts) {
        const t = rayEllipsoid(cam, d, p);
        if (t === null) continue;
        const vol = p.axes[0] * p.axes[1] * p.axes[2];
        // smallest volume wins where they overlap (a compact event inside a big one stays clickable)
        if (!best || vol < best.vol) best = { t, vol, e: ev.entry };
      }
    }
    return best?.e ?? null;
  }
}
