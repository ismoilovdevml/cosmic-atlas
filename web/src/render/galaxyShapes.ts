/**
 * Resolved nearby galaxies: dot → oriented procedural disk → real image thumbnail.
 *
 * Input: data/tiles/catalogs/galaxy-shapes.json (scripts/build_galaxy_shapes.py: D25 axes, PA,
 * inclination, morphology, with sources) joined to the loaded catalogue entries by name/alias.
 * The physical size is the apparent D25 diameter at the catalogue distance of the entry the viewer
 * labels, so the disk sits where the label is.
 *
 * LOD (galaxyGeom.ts lodWeights, after skymap's ladder, MIT, Copyright (c) 2026 Alexander
 * Rulkens; re-implemented): by projected D25 diameter, 8→14 px dot→disk, 24→40 px disk→thumbnail
 * once its image has arrived. Weights sum to one. The dot is the galaxy's tile point(s), dimmed
 * through galaxyMask.ts.
 *
 * Geometry: disks are a thin plane through the catalogue position, tilted by the inclination
 * about the sky major axis at the PA (galaxyGeom.ts diskAxes), plus a small camera-facing bulge.
 * E/dE/dSph systems are a camera-facing ellipse with the catalogue axis ratio, its major axis
 * along the projected sky major axis. Thumbnails are images seen from Earth, painted on that same
 * plane (or ellipse) with texture coordinates from each point's sky offset as seen from the Sun:
 * exact from the Sun, approximate from elsewhere (it is still the Earth view, tilted).
 *
 * Light: at the dot→disk crossfade the disk carries exactly the dot's flux (same photometry as
 * the points: flux per unit solid angle at REF_PX_PER_RAD). Beyond that the point auto-exposure
 * would make any resolved galaxy invisible (surface brightness is distance-independent, the
 * exposure is not), so between 14 and 80 px the mean intensity over D25 ramps (in log space) to a
 * display level set by the galaxy's mean surface brightness (galaxyGeom.ts displayIntensity).
 * The thumbnail is normalised to the same mean over D25 after subtracting its border median.
 */

import * as THREE from 'three/webgpu';
import {
  Fn, attribute, exp, float, length, max, select, smoothstep, sqrt, texture, uniform, varying, vec2, vec3,
} from 'three/tsl';
import { DSS2_COLOR, type HipsSurvey } from '../data/hipsSurvey';
import { catalogKey, type CatalogEntry } from '../data/manifest';
import { type Vec3 } from '../math/frames';
import { REF_PX_PER_RAD, KNEE, srgbToLinear } from './brightness';
import {
  ARCMIN, BULGE_QUAD, BULGE_RE, DISK_FADE, DISK_H, DISPLAY_RAMP, QUAD_R, SPHEROID_RE, THUMB_REQUEST_PX, bulgeFraction,
  diskAxes, displayIntensity, lodWeights, meanSurfaceBrightness, peakIntensities, planeCos, smoothstep as ss,
  type DiskAxes, type LodWeights,
} from './galaxyGeom';
import { MAX_MASKS, galaxyMask } from './galaxyMask';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

export interface GalaxyShape {
  name: string;
  keys: string[];
  ra: number;
  dec: number;
  pgc?: number;
  major_arcmin?: number;
  minor_arcmin?: number | null;
  axes_src?: string;
  axes_def?: string;
  pa_deg?: number;
  pa_src?: string;
  incl_deg?: number;
  incl_src?: string;
  morph?: string | null;
  t?: number | null;
  morph_src?: string;
  shape: 'disk' | 'spheroid';
  mag?: number;
  mag_band?: string;
  flags?: string[];
}

export interface GalaxyShapesDoc {
  sources: Record<string, { ref: string; doi?: string; url?: string }>;
  galaxies: GalaxyShape[];
}

interface Thumb {
  tex: THREE.DataTexture;
  bg: [number, number, number];
  meanIn: number;
  via: string;
  lastUse: number;
}

export interface ShapeItem {
  entry: CatalogEntry;
  shape: GalaxyShape;
  xyz: Vec3;
  distPc: number;
  /** D25 radius, pc */
  R: number;
  q: number;
  spheroid: boolean;
  axes: DiskAxes;
  /** cos of the drawn plane tilt (disks) or b/a (spheroids) */
  c: number;
  pa: number;
  fb: number;
  M: number | null;
  mu: number;
  colDisk: [number, number, number];
  colBulge: [number, number, number];
  /** cutout field of view, degrees (1.5 × major axis) */
  fovDeg: number;
  // per frame
  px: number;
  w: LodWeights;
  thumbAlpha: number;
  thumbState: 'none' | 'loading' | 'ready' | 'failed';
  thumbError?: string;
  slot: number;
}

const MAX_SLOTS = MAX_MASKS;
const THUMB_SIZE = 512;
const THUMB_CACHE = 12;
const MAX_THUMB_FETCH = 2;
const FADE_S = 0.35;

const lin3 = (r: number, g: number, b: number): [number, number, number] => [srgbToLinear(r / 255), srgbToLinear(g / 255), srgbToLinear(b / 255)];

function diskColour(t: number | null | undefined): [number, number, number] {
  if (t === null || t === undefined || !Number.isFinite(t)) return lin3(220, 224, 240);
  if (t >= 9) return lin3(185, 205, 255);
  if (t >= 6) return lin3(195, 212, 255);
  if (t >= 3) return lin3(215, 222, 245);
  return lin3(240, 228, 212);
}

const kneeN = (I: N): N => float(KNEE).mul(float(1.0).sub(exp(I.div(-KNEE))));
/** hue-preserving knee on a linear colour (by its mean channel) */
const kneeColour = (c: N): N => {
  const Y = c.x.add(c.y).add(c.z).div(3.0);
  return c.mul(kneeN(Y).div(max(Y, 1e-6)));
};

class Slot {
  readonly mesh: THREE.Mesh;
  readonly u = {
    A: uniform(new THREE.Vector3()), B: uniform(new THREE.Vector3()),
    Bx: uniform(new THREE.Vector3()), By: uniform(new THREE.Vector3()),
    /** x = disk peak, y = bulge peak, z = thumbnail scale (target / meanIn), w = spheroid flag */
    I: uniform(new THREE.Vector4()),
    /** x = wDisk, y = wThumb, z = c (plane cos or b/a), w = q (b/a) */
    W: uniform(new THREE.Vector4()),
    /** sin PA, cos PA */
    P: uniform(new THREE.Vector2()),
    colD: uniform(new THREE.Vector3()), colB: uniform(new THREE.Vector3()), bg: uniform(new THREE.Vector3()),
  };
  readonly texNode: N;
  item: ShapeItem | null = null;

  constructor(geometry: THREE.BufferGeometry, placeholder: THREE.Texture) {
    const u = this.u as Record<string, N>;
    this.texNode = texture(placeholder);
    const q = attribute('gq', 'vec2');
    const part = attribute('part', 'float');
    const mat = new THREE.MeshBasicNodeMaterial({
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    mat.positionNode = select(part.lessThan(0.5), u.A.mul(q.x).add(u.B.mul(q.y)), u.Bx.mul(q.x).add(u.By.mul(q.y)));
    const vq: N = varying(q, 'vGq');
    const vPart: N = varying(part, 'vPart');
    mat.colorNode = Fn(() => {
      const uv = vq.mul(QUAD_R); // plane coordinates, units of R
      const rho = length(uv);
      const taper = float(1.0).sub(smoothstep(1.0, QUAD_R, rho));
      const diskP = exp(rho.div(-DISK_H)).mul(taper);
      const sphP = exp(sqrt(rho.div(SPHEROID_RE)).mul(-3.67)).mul(taper);
      const procMain = select(u.I.w.greaterThan(0.5), u.colB.mul(sphP), u.colD.mul(diskP)).mul(u.I.x);
      // thumbnail: sky offset of this plane point as seen from the Sun → cutout uv (north = row 0)
      const vs = uv.y.mul(u.W.z);
      const east = uv.x.mul(u.P.x).add(vs.mul(u.P.y));
      const north = uv.x.mul(u.P.y).sub(vs.mul(u.P.x));
      const tuv = vec2(float(0.5).sub(east.div(2.0 * QUAD_R)), float(0.5).sub(north.div(2.0 * QUAD_R)));
      const texel = this.texNode.sample(tuv).rgb;
      const skyRho = length(vec2(uv.x, vs.div(max(u.W.w, 0.02))));
      const mask = float(1.0).sub(smoothstep(1.0, 1.45, skyRho)).mul(taper);
      const thumb = max(texel.sub(u.bg), vec3(0.0)).mul(u.I.z).mul(mask);
      const main = kneeColour(procMain).mul(u.W.x).add(kneeColour(thumb).mul(u.W.y));
      const rb = length(vq).mul(BULGE_QUAD);
      const bulgeP = exp(sqrt(rb.div(BULGE_RE)).mul(-3.67)).mul(float(1.0).sub(smoothstep(0.6 * BULGE_QUAD, BULGE_QUAD, rb)));
      const bulge = kneeColour(u.colB.mul(bulgeP).mul(u.I.y)).mul(u.W.x);
      return select(vPart.lessThan(0.5), main, bulge);
    })();
    mat.opacityNode = float(1.0);
    mat.name = 'galaxy-shape';
    this.mesh = new THREE.Mesh(geometry, mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }
}

function makeGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const corners = [-1, -1, 1, -1, 1, 1, -1, 1];
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(8 * 3), 3));
  g.setAttribute('gq', new THREE.BufferAttribute(new Float32Array([...corners, ...corners]), 2));
  g.setAttribute('part', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0, 1, 1, 1, 1]), 1));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  return g;
}

export interface ShapeFrame {
  cam: Vec3;
  camera: THREE.PerspectiveCamera;
  frustum: THREE.Frustum;
  /** device px per radian */
  pxPerRad: number;
  dpr: number;
  /** galaxy-layer reference magnitude (auto-exposure + Exposure slider) */
  mRef: number;
  exposure: number;
  dt: number;
  enabled: boolean;
}

export class GalaxyShapes {
  readonly group = new THREE.Group();
  items: ShapeItem[] = [];
  survey: HipsSurvey = DSS2_COLOR;
  /** false: never fetch images (procedural disks only; ?thumbs=off) */
  thumbsEnabled = true;
  doc: GalaxyShapesDoc | null = null;
  private byKey = new Map<string, GalaxyShape>();
  private slots: Slot[] = [];
  private thumbs = new Map<string, Thumb>();
  private failed = new Map<string, string>();
  private loading = new Set<string>();
  private placeholder: THREE.DataTexture;
  private sphere = new THREE.Sphere();
  private v = new THREE.Vector3();
  onChange: () => void = () => {};
  /** true while a thumbnail fade is running */
  animating = false;

  constructor() {
    this.placeholder = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this.placeholder.needsUpdate = true;
    const geo = makeGeometry();
    for (let i = 0; i < MAX_SLOTS; i++) {
      const s = new Slot(geo, this.placeholder);
      this.slots.push(s);
      this.group.add(s.mesh);
    }
    this.group.name = 'galaxy-shapes';
  }

  setData(doc: GalaxyShapesDoc, catalog: CatalogEntry[]) {
    this.doc = doc;
    this.byKey.clear();
    for (const g of doc.galaxies) for (const k of g.keys) this.byKey.set(catalogKey(k), g);
    this.items = [];
    for (const e of catalog) {
      if (!e.xyz || !(e.dist_pc > 0) || !(e.kind === 'galaxy' || e.kind === 'lg_galaxy')) continue;
      const g = this.shapeFor(e);
      if (!g || !g.major_arcmin) continue;
      const q = Math.min(1, Math.max(0.05, (g.minor_arcmin ?? g.major_arcmin) / g.major_arcmin));
      const spheroid = g.shape === 'spheroid';
      const pa = g.pa_deg ?? 0;
      const c = spheroid ? q : planeCos(g.incl_deg, q);
      const R = 0.5 * g.major_arcmin * ARCMIN * e.dist_pc;
      const mag = e.mag ?? g.mag ?? null;
      const M = mag !== null ? mag - 5 * Math.log10(e.dist_pc / 10) : null;
      this.items.push({
        entry: e, shape: g, xyz: e.xyz, distPc: e.dist_pc, R, q, spheroid,
        axes: diskAxes(e.ra ?? g.ra, e.dec ?? g.dec, pa, c), c, pa,
        fb: spheroid ? 0 : bulgeFraction(g.t), M,
        mu: mag !== null ? meanSurfaceBrightness(mag, g.major_arcmin, g.major_arcmin * q) : 23.5,
        colDisk: spheroid ? lin3(255, 224, 190) : diskColour(g.t), colBulge: spheroid ? lin3(255, 224, 190) : lin3(255, 214, 165),
        fovDeg: (1.5 * g.major_arcmin) / 60,
        px: 0, w: { dot: 1, disk: 0, thumb: 0 }, thumbAlpha: 0, thumbState: 'none', slot: -1,
      });
    }
  }

  shapeFor(e: CatalogEntry): GalaxyShape | null {
    for (const n of [e.name, ...(e.alt ?? [])]) {
      const g = this.byKey.get(catalogKey(n));
      if (g) return g;
    }
    return null;
  }

  itemFor(e: CatalogEntry): ShapeItem | null {
    return this.items.find((i) => i.entry === e) ?? null;
  }

  update(f: ShapeFrame) {
    const { cam, pxPerRad, dpr } = f;
    const active: ShapeItem[] = [];
    for (const it of this.items) {
      const rel: Vec3 = [it.xyz[0] - cam[0], it.xyz[1] - cam[1], it.xyz[2] - cam[2]];
      const r = Math.hypot(rel[0], rel[1], rel[2]);
      it.px = ((2 * it.R) / Math.max(r, 1e-9)) * (pxPerRad / dpr);
      it.slot = -1;
      if (!f.enabled || it.px < DISK_FADE[0]) continue;
      this.sphere.center.set(rel[0], rel[1], rel[2]);
      this.sphere.radius = it.R * QUAD_R * 1.5;
      if (r > this.sphere.radius && !f.frustum.intersectsSphere(this.sphere)) continue;
      active.push(it);
    }
    active.sort((a, b) => b.px - a.px);
    const shown = active.slice(0, MAX_SLOTS);
    this.requestThumbs(shown);

    let animating = false;
    const rot = f.camera.matrixWorldInverse;
    galaxyMask.count.value = 0;
    for (let k = 0; k < this.slots.length; k++) {
      const s = this.slots[k];
      const it = shown[k];
      s.item = it ?? null;
      if (!it) {
        s.mesh.visible = false;
        continue;
      }
      it.slot = k;
      const th = this.thumbs.get(it.shape.name);
      const want = th ? 1 : 0;
      if (it.thumbAlpha !== want) {
        it.thumbAlpha = want > it.thumbAlpha ? Math.min(1, it.thumbAlpha + f.dt / FADE_S) : Math.max(0, it.thumbAlpha - f.dt / FADE_S);
        animating = true;
      }
      it.w = lodWeights(it.px, it.thumbAlpha);
      if (th) th.lastUse = performance.now();

      // ---- geometry (world vectors; the mesh sits at C − camera)
      const rel: Vec3 = [it.xyz[0] - cam[0], it.xyz[1] - cam[1], it.xyz[2] - cam[2]];
      const r = Math.hypot(...rel);
      const w: Vec3 = [rel[0] / r, rel[1] / r, rel[2] / r]; // camera → galaxy
      const ext = it.R * QUAD_R;
      const u = s.u as unknown as Record<string, { value: any }>;
      let cosView: number;
      let bx: Vec3;
      let by: Vec3;
      {
        // camera-facing frame with x along the projected sky major axis
        const a = it.axes.major;
        const ad = a[0] * w[0] + a[1] * w[1] + a[2] * w[2];
        let ax: Vec3 = [a[0] - ad * w[0], a[1] - ad * w[1], a[2] - ad * w[2]];
        const al = Math.hypot(...ax) || 1;
        ax = [ax[0] / al, ax[1] / al, ax[2] / al];
        const cy: Vec3 = [ax[1] * w[2] - ax[2] * w[1], ax[2] * w[0] - ax[0] * w[2], ax[0] * w[1] - ax[1] * w[0]];
        bx = ax;
        by = cy;
      }
      if (it.spheroid) {
        u.A.value.set(bx[0] * ext, bx[1] * ext, bx[2] * ext);
        u.B.value.set(by[0] * ext * it.q, by[1] * ext * it.q, by[2] * ext * it.q);
        u.Bx.value.set(0, 0, 0);
        u.By.value.set(0, 0, 0);
        cosView = it.q;
      } else {
        const a = it.axes.major;
        const m = it.axes.inPlane;
        u.A.value.set(a[0] * ext, a[1] * ext, a[2] * ext);
        u.B.value.set(m[0] * ext, m[1] * ext, m[2] * ext);
        const eb = it.R * BULGE_QUAD;
        u.Bx.value.set(bx[0] * eb, bx[1] * eb, bx[2] * eb);
        u.By.value.set(by[0] * eb, by[1] * eb, by[2] * eb);
        const n = it.axes.normal;
        cosView = Math.abs(n[0] * w[0] + n[1] * w[1] + n[2] * w[2]);
      }
      s.mesh.position.set(rel[0], rel[1], rel[2]);

      // ---- light: photometric mean over D25 at the dot crossfade, display surface brightness beyond
      const M = it.M ?? -15;
      const flux = Math.pow(10, -0.4 * (M + 5 * Math.log10(Math.max(r, 1e-6) / 10) - f.mRef));
      const areaRef = Math.PI * it.R * it.R * Math.max(0.15, cosView) * (REF_PX_PER_RAD / r) ** 2;
      const Iph = flux / areaRef;
      const Idisp = displayIntensity(it.mu, f.exposure);
      const t = ss(DISPLAY_RAMP[0], DISPLAY_RAMP[1], it.px);
      const target = Math.pow(Iph, 1 - t) * Math.pow(Math.max(Iph, Idisp), t);
      const pk = peakIntensities(target, it.fb, it.spheroid ? 1 : cosView, it.spheroid);
      u.I.value.set(pk.disk, pk.bulge, th ? target / th.meanIn : 0, it.spheroid ? 1 : 0);
      u.W.value.set(it.w.disk, it.w.thumb, it.c, it.q);
      u.P.value.set(Math.sin((it.pa * Math.PI) / 180), Math.cos((it.pa * Math.PI) / 180));
      u.colD.value.set(...it.colDisk);
      u.colB.value.set(...it.colBulge);
      if (th) {
        if (s.texNode.value !== th.tex) s.texNode.value = th.tex;
        u.bg.value.set(...th.bg);
      } else if (s.texNode.value !== this.placeholder) s.texNode.value = this.placeholder;
      s.mesh.visible = it.w.disk + it.w.thumb > 1e-4;

      // ---- dot mask (view space)
      const n = galaxyMask.count.value as number;
      const hd = Math.hypot(...it.xyz);
      this.v.set(it.xyz[0] / hd, it.xyz[1] / hd, it.xyz[2] / hd).transformDirection(rot);
      const chord = Math.max(1 * ARCMIN, 0.05 * (it.R / hd));
      galaxyMask.dirs[n].set(this.v.x, this.v.y, this.v.z, chord);
      galaxyMask.dats[n].set(hd, it.w.dot, 0, 0);
      galaxyMask.count.value = n + 1;
    }
    this.animating = animating;
  }

  private requestThumbs(shown: ShapeItem[]) {
    if (!this.thumbsEnabled) return;
    const want = shown.filter((it) => it.px >= THUMB_REQUEST_PX).slice(0, 6);
    for (const it of want) {
      const key = it.shape.name;
      if (this.thumbs.has(key)) {
        it.thumbState = 'ready';
        continue;
      }
      if (this.failed.has(key)) {
        it.thumbState = 'failed';
        it.thumbError = this.failed.get(key);
        continue;
      }
      if (this.loading.has(key)) {
        it.thumbState = 'loading';
        continue;
      }
      if (this.loading.size >= MAX_THUMB_FETCH) continue;
      this.loading.add(key);
      it.thumbState = 'loading';
      void this.loadThumb(it).finally(() => this.loading.delete(key));
    }
  }

  private async loadThumb(it: ShapeItem) {
    const key = it.shape.name;
    try {
      const ra = it.entry.ra ?? it.shape.ra;
      const dec = it.entry.dec ?? it.shape.dec;
      // the cutout / HEALPix reprojection code is fetched with the first thumbnail
      const { fetchCutout } = await import('../data/hipsCutout');
      const c = await fetchCutout(this.survey, ra, dec, it.fovDeg, THUMB_SIZE);
      const st = thumbStats(c.rgba, c.size, it.pa, it.q);
      if (!(st.meanIn > 1e-4)) throw new Error('empty cutout (no signal above the border median)');
      const tex = new THREE.DataTexture(new Uint8Array(c.rgba.buffer.slice(0)), c.size, c.size, THREE.RGBAFormat);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.flipY = false;
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.needsUpdate = true;
      this.thumbs.set(key, { tex, bg: st.bg, meanIn: st.meanIn, via: c.via, lastUse: performance.now() });
      this.evict();
    } catch (e) {
      const msg = (e as Error).message;
      this.failed.set(key, msg);
      console.info(`[galaxy thumbnails] ${key}: kept the procedural disk (${msg})`);
    }
    this.onChange();
  }

  private evict() {
    if (this.thumbs.size <= THUMB_CACHE) return;
    const inUse = new Set(this.slots.map((s) => s.item?.shape.name));
    const old = [...this.thumbs.entries()].filter(([k]) => !inUse.has(k)).sort((a, b) => a[1].lastUse - b[1].lastUse);
    while (this.thumbs.size > THUMB_CACHE && old.length) {
      const [k, t] = old.shift()!;
      t.tex.dispose();
      this.thumbs.delete(k);
    }
  }

  thumbInfo(name: string): { via: string } | { error: string } | null {
    const t = this.thumbs.get(name);
    if (t) return { via: t.via };
    const f = this.failed.get(name);
    return f ? { error: f } : null;
  }

  /** CPU pick on drawn disks: the item whose projected D25 ellipse contains the cursor (CSS px) */
  pickAt(x: number, y: number, cam: Vec3, camera: THREE.PerspectiveCamera, W: number, H: number): ShapeItem | null {
    let best: ShapeItem | null = null;
    for (const s of this.slots) {
      const it = s.item;
      if (!it || it.w.disk + it.w.thumb < 0.5) continue;
      const pr = (p: Vec3) => {
        const v = new THREE.Vector3(p[0] - cam[0], p[1] - cam[1], p[2] - cam[2]).applyMatrix4(camera.matrixWorldInverse);
        if (v.z >= 0) return null;
        v.applyMatrix4(camera.projectionMatrix);
        return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H };
      };
      const c = pr(it.xyz);
      const a = it.axes.major;
      const b = it.spheroid ? it.axes.minorSky : it.axes.inPlane;
      const k = it.spheroid ? it.q : 1;
      const pa = pr([it.xyz[0] + a[0] * it.R, it.xyz[1] + a[1] * it.R, it.xyz[2] + a[2] * it.R]);
      const pb = pr([it.xyz[0] + b[0] * it.R * k, it.xyz[1] + b[1] * it.R * k, it.xyz[2] + b[2] * it.R * k]);
      if (!c || !pa || !pb) continue;
      // solve cursor = c + s·(pa − c) + t·(pb − c); inside when s² + t² ≤ 1
      const ax = pa.x - c.x, ay = pa.y - c.y, bx = pb.x - c.x, by = pb.y - c.y;
      const det = ax * by - ay * bx;
      if (Math.abs(det) < 1) continue;
      const dx = x - c.x, dy = y - c.y;
      const sA = (dx * by - dy * bx) / det;
      const tB = (ax * dy - ay * dx) / det;
      if (sA * sA + tB * tB <= 1 && (!best || it.px < best.px)) best = it; // smallest wins (satellites over hosts)
    }
    return best;
  }

  stats() {
    return this.slots.filter((s) => s.item).map((s) => {
      const it = s.item!;
      return { name: it.shape.name, px: +it.px.toFixed(1), dot: +it.w.dot.toFixed(3), disk: +it.w.disk.toFixed(3), thumb: +it.w.thumb.toFixed(3),
        thumbState: this.thumbs.has(it.shape.name) ? 'ready' : this.failed.has(it.shape.name) ? 'failed' : this.loading.has(it.shape.name) ? 'loading' : 'none',
        via: this.thumbs.get(it.shape.name)?.via, error: this.failed.get(it.shape.name) };
    });
  }
}

/**
 * Background (per-channel median of the outer 6 % border, linear) and the mean linear brightness
 * above it inside the D25 ellipse (the cutout spans 1.5 × D25, north up, east left).
 */
export function thumbStats(rgba: ArrayLike<number>, size: number, paDeg: number, q: number): { bg: [number, number, number]; meanIn: number } {
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) lut[i] = srgbToLinear(i / 255);
  const border = Math.max(2, Math.round(size * 0.06));
  const ch: number[][] = [[], [], []];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      if (x >= border && x < size - border && y >= border && y < size - border) continue;
      const o = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) ch[c].push(lut[rgba[o + c]]);
    }
  const med = (a: number[]) => {
    a.sort((p, r) => p - r);
    return a[a.length >> 1] ?? 0;
  };
  const bg: [number, number, number] = [med(ch[0]), med(ch[1]), med(ch[2])];
  const p = (paDeg * Math.PI) / 180;
  const sp = Math.sin(p);
  const cp = Math.cos(p);
  let sum = 0;
  let n = 0;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      // sky offset in units of R: the field is ±QUAD_R
      const east = (0.5 - (x + 0.5) / size) * 2 * QUAD_R;
      const north = (0.5 - (y + 0.5) / size) * 2 * QUAD_R;
      const maj = east * sp + north * cp;
      const mn = east * cp - north * sp;
      if (maj * maj + (mn / q) * (mn / q) > 1) continue;
      const o = (y * size + x) * 4;
      let s = 0;
      for (let c = 0; c < 3; c++) s += Math.max(0, lut[rgba[o + c]] - bg[c]);
      sum += s / 3;
      n++;
    }
  return { bg, meanIn: n ? sum / n : 0 };
}
