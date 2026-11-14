/**
 * Streamed surface imagery for the Moon and Mars: a quadtree of sphere patches over the
 * geographic tile pyramid (tiles.ts), refined by screen-space error, textured from NASA Trek /
 * Murray Lab CTX tiles through an LRU texture cache with at most 6 requests in flight.
 *
 * - Only while the body is big on screen (radius > ON_PX device px) is anything requested or
 *   drawn; below that the body's single global texture (layer.ts) is shown as before.
 * - When active the patches replace the body mesh and always cover the whole sphere: a patch
 *   whose own tile has not arrived samples its nearest loaded ancestor tile, or the global
 *   texture, through a sub-rectangle transform, so there is no hole and no seam while loading.
 *   A newly available tile cross-fades in over FADE_MS.
 * - Vertices are built in float64 on the CPU, relative to each patch's centre, so the float32
 *   GPU positions stay accurate to centimetres at 10 km altitude (GPU sin/cos are not).
 * - Lighting is the body shader's: Lambert from the Sun direction per fragment, so the terminator
 *   matches the far view. The imagery is flat: no DEM tile service with CORS exists for the Moon
 *   and the Mars MOLA DEM is only offered as HEALPix FITS (docs/open-data-inventory.md).
 * - Mars: Viking colour sets the colour; above level 5 the CTX greyscale mosaic modulates it by
 *   its local contrast (CTX / CTX blurred by 4 mip levels), which keeps Viking's tone and adds
 *   ~5 m detail. CTX gaps (no data, black) leave the Viking colour alone.
 */

import * as THREE from 'three/webgpu';
import { Fn, clamp, dot, float, max, mix, modelWorldMatrix, normalLocal, normalize, positionWorld, select, texture, uniform, uv, vec3, vec4 } from 'three/tsl';
import { PC_PER_AU } from '../../math/units';
import type { Vec3 } from '../../math/frames';
import type { BodyFrame } from '../ephemeris';
import { bodyToGal, galToBody, latLonToBody } from './geo';
import { SURFACES, globalRect, subRect, tileBounds, tileKey, type SurfaceBody, type SurfaceMode, type SurfaceSpec, type TileBounds } from './tiles';

/* eslint-disable @typescript-eslint/no-explicit-any */
type U<T> = { value: T };

const GRID = 32; // segments per patch edge
/** split while a tile texel covers more than this many device px */
const SPLIT_PX = 1.4;
const FADE_MS = 350;
const MAX_LEAVES = 360;
/** body radius on screen (device px) above which tiles are used, and below which they stop */
export const SURFACE_ON_PX = 160;
const OFF_PX = 120;
const MIN_LEVEL = 2;
/** the detail layer is divided by its own ancestor this many levels up (8× coarser) */
const LOWPASS_UP = 3;
/** linear CTX brightness → Viking MDIM 2.1 brightness: mean ratio 0.42-0.59 over four tiles
 *  (levels 3-5, measured 2026-11-14), 0.5 used */
const CTX_GAIN = 0.5;
/** mean Viking MDIM 2.1 colour / luminance (linear), same four tiles: (1.52, 0.87, 0.80) */
const MARS_CHROMA = vec3(1.52, 0.865, 0.803);
const PC_PER_KM_SURF = PC_PER_AU / 149597870.7;

// ------------------------------------------------------------------------------------------ cache

/** unique texture versions, starting well above anything three assigns on its own */
let texVersionSeq = 1000;

interface Entry {
  key: string;
  url: string;
  state: 'idle' | 'loading' | 'ready' | 'failed';
  tex: THREE.Texture | null;
  bytes: number;
  used: number;
  prio: number;
  wanted: number;
  tries: number;
}

export interface CacheStats {
  requests: number;
  loaded: number;
  /** gave up after 3 tries */
  failed: number;
  retries: number;
  bytesDown: number;
  evicted: number;
  inFlight: number;
  queued: number;
  resident: number;
  residentMB: number;
}

/** LRU texture cache + request queue shared by every body (≤ maxInFlight concurrent fetches) */
export class TileCache {
  maxInFlight = 6;
  budgetBytes = 192 * 2 ** 20;
  onLoad: () => void = () => {};
  readonly stats: CacheStats = { requests: 0, loaded: 0, failed: 0, retries: 0, bytesDown: 0, evicted: 0, inFlight: 0, queued: 0, resident: 0, residentMB: 0 };
  /** every URL requested, in order (captures report requests per view) */
  readonly log: string[] = [];
  private m = new Map<string, Entry>();
  private queue: Entry[] = [];
  private frame = 0;
  private bytes = 0;
  /** failed tiles waiting for their retry */
  private waiting = 0;

  begin() {
    this.frame++;
    this.queue.length = 0;
  }

  /** a ready texture (and mark it used this frame), else null */
  get(key: string): THREE.Texture | null {
    const e = this.m.get(key);
    if (!e || e.state !== 'ready') return null;
    e.used = this.frame;
    return e.tex;
  }

  isFailed(key: string) {
    return this.m.get(key)?.state === 'failed';
  }

  want(key: string, url: string, prio: number) {
    let e = this.m.get(key);
    if (!e) {
      e = { key, url, state: 'idle', tex: null, bytes: 0, used: 0, prio, wanted: -1, tries: 0 };
      this.m.set(key, e);
    }
    if (e.state !== 'idle') return;
    if (e.wanted !== this.frame) {
      e.wanted = this.frame;
      e.prio = prio;
      this.queue.push(e);
    } else e.prio = Math.min(e.prio, prio);
  }

  /** start the most urgent wanted requests, evict over budget */
  end() {
    this.queue.sort((a, b) => a.prio - b.prio);
    let i = 0;
    while (this.stats.inFlight < this.maxInFlight && i < this.queue.length) void this.load(this.queue[i++]);
    this.stats.queued = this.queue.length - i;
    if (this.bytes > this.budgetBytes) this.evict();
  }

  private async load(e: Entry) {
    e.state = 'loading';
    this.stats.inFlight++;
    this.stats.requests++;
    this.log.push(e.url);
    try {
      const r = await fetch(e.url, { mode: 'cors', credentials: 'omit' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      this.stats.bytesDown += blob.size;
      // flipped here (not by the GPU upload), so WebGPU and the WebGL fallback agree
      const bmp = await createImageBitmap(blob, { imageOrientation: 'flipY' });
      const tex = new THREE.Texture(bmp as unknown as HTMLImageElement);
      tex.flipY = false;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.anisotropy = 8;
      // three r186 rebinds a texture node whose value changed only when the new texture's
      // `version` differs from the old one's (Bindings: binding.generation = texture.version), and
      // every fresh texture has version 1: swapping tile A for tile B kept A on the GPU. A unique
      // version per tile makes every swap rebind.
      tex.version = ++texVersionSeq;
      e.tex = tex;
      e.bytes = Math.round(bmp.width * bmp.height * 4 * 1.34);
      this.bytes += e.bytes;
      e.state = 'ready';
      e.used = this.frame;
      this.stats.loaded++;
    } catch {
      // the CTX cache answers some tiles with HTTP 500 (no CORS header, so fetch only sees a
      // network error), often transiently: retry twice, 2 s and 4 s later, then give up
      e.tries++;
      if (e.tries < 3) {
        e.state = 'failed';
        this.stats.retries++;
        this.waiting++;
        setTimeout(() => {
          e.state = 'idle';
          this.waiting--;
        }, 2000 * e.tries);
      } else {
        e.state = 'failed';
        this.stats.failed++;
      }
    } finally {
      this.stats.inFlight--;
      this.updateResident();
      this.onLoad();
    }
  }

  private evict() {
    const ready = [...this.m.values()].filter((e) => e.state === 'ready' && e.used < this.frame - 1).sort((a, b) => a.used - b.used);
    for (const e of ready) {
      if (this.bytes <= this.budgetBytes * 0.85) break;
      e.tex!.dispose();
      (e.tex!.image as ImageBitmap).close?.();
      this.bytes -= e.bytes;
      this.m.delete(e.key);
      this.stats.evicted++;
    }
    this.updateResident();
  }

  private updateResident() {
    let n = 0;
    for (const e of this.m.values()) if (e.state === 'ready') n++;
    this.stats.resident = n;
    this.stats.residentMB = +(this.bytes / 2 ** 20).toFixed(1);
  }

  /** nothing loading and nothing waiting (captures wait for this) */
  get idle() {
    return this.stats.inFlight === 0 && this.stats.queued === 0 && this.waiting === 0;
  }
}

// ------------------------------------------------------------------------------------------ nodes

interface QNode {
  z: number;
  x: number;
  y: number;
  b: TileBounds;
  /** body-fixed unit direction of the patch centre */
  c: Vec3;
  /** angular radius about c (rad) */
  ang: number;
  kids: QNode[] | null;
  geom: THREE.BufferGeometry | null;
  used: number;
}

function makeNode(z: number, x: number, y: number): QNode {
  const b = tileBounds(z, x, y);
  const pts: Vec3[] = [];
  for (const la of [b.lat0, (b.lat0 + b.lat1) / 2, b.lat1]) for (const lo of [b.lon0, (b.lon0 + b.lon1) / 2, b.lon1]) pts.push(latLonToBody(la, lo));
  const s: Vec3 = [0, 0, 0];
  for (const p of pts) (s[0] += p[0]), (s[1] += p[1]), (s[2] += p[2]);
  const n = Math.hypot(...s);
  const c: Vec3 = [s[0] / n, s[1] / n, s[2] / n];
  let ang = 0;
  for (const p of pts) ang = Math.max(ang, Math.acos(Math.min(1, p[0] * c[0] + p[1] * c[1] + p[2] * c[2])));
  return { z, x, y, b, c, ang: ang * 1.02, kids: null, geom: null, used: 0 };
}

/** a (GRID+1)² grid on the unit sphere, positions relative to the patch centre, plus a skirt */
function buildGeometry(n: QNode): THREE.BufferGeometry {
  const N = GRID + 1;
  const nv = N * N + 4 * N;
  const pos = new Float32Array(nv * 3);
  const nor = new Float32Array(nv * 3);
  const uvs = new Float32Array(nv * 2);
  const { lon0, lon1, lat0, lat1 } = n.b;
  const c = n.c;
  const put = (i: number, la: number, lo: number, u: number, v: number, r: number) => {
    const p = latLonToBody(la, lo);
    pos[i * 3] = p[0] * r - c[0];
    pos[i * 3 + 1] = p[1] * r - c[1];
    pos[i * 3 + 2] = p[2] * r - c[2];
    nor[i * 3] = p[0];
    nor[i * 3 + 1] = p[1];
    nor[i * 3 + 2] = p[2];
    uvs[i * 2] = u;
    uvs[i * 2 + 1] = v;
  };
  for (let j = 0; j < N; j++) {
    const v = j / GRID; // 0 = south edge
    for (let i = 0; i < N; i++) {
      const u = i / GRID;
      put(j * N + i, lat0 + (lat1 - lat0) * v, lon0 + (lon1 - lon0) * u, u, v, 1);
    }
  }
  // skirt: the border pulled inward, hides T-junction cracks against coarser neighbours
  const drop = 1 - Math.min(0.02, ((lon1 - lon0) * Math.PI) / 180 / GRID * 0.5);
  const edge: [number, number][] = [];
  for (let i = 0; i < N; i++) edge.push([i, 0]);
  for (let j = 0; j < N; j++) edge.push([GRID, j]);
  for (let i = GRID; i >= 0; i--) edge.push([i, GRID]);
  for (let j = GRID; j >= 0; j--) edge.push([0, j]);
  const base = N * N;
  const idx: number[] = [];
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const a = j * N + i;
      idx.push(a, a + 1, a + N + 1, a, a + N + 1, a + N);
    }
  }
  const skirtCount = Math.min(edge.length, 4 * N);
  for (let k = 0; k < skirtCount; k++) {
    const [i, j] = edge[k];
    put(base + k, lat0 + (lat1 - lat0) * (j / GRID), lon0 + (lon1 - lon0) * (i / GRID), i / GRID, j / GRID, drop);
  }
  for (let k = 0; k < skirtCount - 1; k++) {
    const [i0, j0] = edge[k];
    const [i1, j1] = edge[k + 1];
    if (i0 === i1 && j0 === j1) continue;
    const a = j0 * N + i0;
    const b2 = j1 * N + i1;
    idx.push(a, base + k, b2, b2, base + k, base + k + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(idx);
  return g;
}

// ------------------------------------------------------------------------------------------ patches

interface Slot {
  key: string;
  cTex: any;
  cOff: U<THREE.Vector2>;
  cScale: U<THREE.Vector2>;
  dTex: any;
  dOff: U<THREE.Vector2>;
  dScale: U<THREE.Vector2>;
  /** the detail layer's own low-pass: its ancestor LOWPASS_UP levels coarser */
  lTex: any;
  lOff: U<THREE.Vector2>;
  lScale: U<THREE.Vector2>;
  dW: U<number>;
  cBlank: THREE.Texture;
  dBlank: THREE.Texture;
  lBlank: THREE.Texture;
}

interface Patch {
  mesh: THREE.Mesh;
  a: Slot;
  b: Slot;
  uFade: U<number>;
  t0: number;
  node: QNode | null;
}

/** 1×1 grey placeholder. (A mip-biased second sample of the detail tile would be the simpler
 *  low-pass, but three r186 drops the sampler of a biased node that shares its texture with
 *  another node: "unresolved value nodeUniform_sampler". The coarser ancestor tile is used instead.) */
const blank = () => {
  const t = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
};
const BLANK = blank();

function makeSlot(): Slot {
  const cOff = uniform(new THREE.Vector2());
  const cScale = uniform(new THREE.Vector2(1, 1));
  const dOff = uniform(new THREE.Vector2());
  const dScale = uniform(new THREE.Vector2(1, 1));
  const lOff = uniform(new THREE.Vector2());
  const lScale = uniform(new THREE.Vector2(1, 1));
  const uvL = uv();
  const cBlank = blank();
  const dBlank = blank();
  const lBlank = blank();
  return {
    key: '', cOff, cScale, dOff, dScale, lOff, lScale, dW: uniform(0), cBlank, dBlank, lBlank,
    cTex: texture(cBlank, uvL.mul(cScale).add(cOff)),
    dTex: texture(dBlank, uvL.mul(dScale).add(dOff)),
    lTex: texture(lBlank, uvL.mul(lScale).add(lOff)),
  };
}

/**
 * Colour × detail. Far out the detail only rescales the colour by its local contrast
 * (CTX / its own 8× coarser ancestor), keeping the colour layer's brightness. Close in (uNear → 1)
 * the brightness comes from the detail layer itself, scaled by CTX_GAIN, and the colour layer only
 * gives the hue: Viking's 232 m albedo blotches would otherwise dominate a 10 km view. CTX "no
 * data" (black) keeps the colour layer as it is.
 */
function shade(s: Slot, uNear: U<number>) {
  const c = s.cTex.rgb;
  const d = s.dTex.r;
  const dl = s.lTex.r;
  const has = d.greaterThan(0.02).and(dl.greaterThan(0.03));
  const vl = max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 0.004);
  const ratio = clamp(d.div(max(dl, 0.03)), 0.3, 2.5);
  const target = mix(vl.mul(ratio), d.mul(CTX_GAIN), uNear as any);
  // close in, the hue too moves halfway to the planet's mean (Viking's blotches are also colour)
  const hue = mix(c.div(vl), MARS_CHROMA, (uNear as any).mul(0.5));
  const near = hue.mul(target);
  const far = c.mul(select(has, target.div(vl), float(1)));
  const detailed = select(has, mix(far, near, uNear as any), c);
  return mix(c, detailed, s.dW as any);
}

let patchSeq = 0;

function makePatch(uSun: U<THREE.Vector3>, uAlpha: U<number>, uNear: U<number>): Patch {
  const a = makeSlot();
  const b = makeSlot();
  const uFade = uniform(1);
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthTest: true, depthWrite: true, blending: THREE.NormalBlending });
  mat.colorNode = Fn(() => {
    const albedo = mix(shade(a, uNear), shade(b, uNear), uFade);
    const nW = normalize(modelWorldMatrix.mul(vec4(normalLocal, 0.0)).xyz);
    const L = normalize((uSun as any).sub(positionWorld));
    const lambert = max(dot(nW, L), 0.0);
    return albedo.mul(lambert.mul(1.15).add(0.003));
  })();
  mat.opacityNode = uAlpha as any;
  // Every patch material has the same node graph, so three r186 would give them one cached node
  // builder state, whose bindings point at the FIRST material's texture and uniform nodes: every
  // patch would show another patch's tile. A per-material key keeps the states apart (the WGSL is
  // identical, so the shader module and pipeline are still shared).
  const key = `planet-patch-${++patchSeq}`;
  const base = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => `${base()}|${key}`;
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
  mesh.matrixAutoUpdate = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  mesh.visible = false;
  return { mesh, a, b, uFade, t0: 0, node: null };
}

/** what a patch shows: colour tile (or the global map) + optional detail tile, with uv transforms */
interface Pick {
  key: string;
  cTex: THREE.Texture;
  cOff: [number, number];
  cScale: [number, number];
  dTex: THREE.Texture | null;
  dOff: [number, number];
  dScale: [number, number];
  lTex: THREE.Texture | null;
  lOff: [number, number];
  lScale: [number, number];
}

/**
 * three r186 mixes up the bindings when one Texture object sits in two texture nodes of the same
 * material while it is compiled (seen as each patch showing another tile: its parent, whole). Every
 * node therefore starts on its own 1×1 placeholder, and a fresh patch fills only slot B.
 */
function clearSlot(s: Slot) {
  s.key = '';
  s.cTex.value = s.cBlank;
  s.dTex.value = s.dBlank;
  s.lTex.value = s.lBlank;
  s.dW.value = 0;
}

function assign(s: Slot, p: Pick) {
  s.key = p.key;
  s.cTex.value = p.cTex;
  s.cOff.value.set(p.cOff[0], p.cOff[1]);
  s.cScale.value.set(p.cScale[0], p.cScale[1]);
  const on = !!(p.dTex && p.lTex);
  s.dTex.value = on ? p.dTex : s.dBlank;
  s.lTex.value = on ? p.lTex : s.lBlank;
  s.dOff.value.set(p.dOff[0], p.dOff[1]);
  s.dScale.value.set(p.dScale[0], p.dScale[1]);
  s.lOff.value.set(p.lOff[0], p.lOff[1]);
  s.lScale.value.set(p.lScale[0], p.lScale[1]);
  s.dW.value = on ? 1 : 0;
}

// ------------------------------------------------------------------------------------------ surface

export interface SurfaceFrameIn {
  /** body centre minus camera, pc */
  rel: Vec3;
  f: BodyFrame;
  rpc: number;
  camera: THREE.PerspectiveCamera;
  /** device px per radian */
  pxPerRad: number;
  /** body radius on screen, device px */
  rpx: number;
  /** the body's global texture (fallback level) */
  globalTex: THREE.Texture | null;
  visible: boolean;
  now: number;
}

export interface SurfaceStats {
  active: boolean;
  leaves: number;
  maxLevel: number;
  withOwnTile: number;
}

export class PlanetSurface {
  active = false;
  mode: SurfaceMode = 'photo';
  readonly stats: SurfaceStats = { active: false, leaves: 0, maxLevel: 0, withOwnTile: 0 };
  private roots: QNode[] = [makeNode(0, 0, 0), makeNode(0, 1, 0)];
  private pool: Patch[] = [];
  private live = new Map<QNode, Patch>();
  private frame = 0;
  private frustum = new THREE.Frustum();
  private m4 = new THREE.Matrix4();
  private sphere = new THREE.Sphere();
  /** 0 far out, 1 below ~15 km: how much the detail layer sets the brightness */
  private uNear = uniform(0);

  constructor(
    readonly body: SurfaceBody,
    private parent: THREE.Object3D,
    private cache: TileCache,
    private uSun: U<THREE.Vector3>,
    private uAlpha: U<number>,
  ) {}

  get spec(): SurfaceSpec {
    return SURFACES[this.body][this.mode];
  }

  setMode(m: SurfaceMode) {
    if (m === this.mode) return;
    this.mode = m;
    for (const p of this.live.values()) p.a.key = p.b.key = ''; // re-pick (no fade from the other mode)
  }

  /** per frame; returns whether a fade is running (needs another frame) */
  update(i: SurfaceFrameIn): boolean {
    this.frame++;
    const want = i.visible && (this.active ? i.rpx > OFF_PX : i.rpx > SURFACE_ON_PX);
    this.active = want;
    this.stats.active = want;
    if (!want) {
      if (this.live.size) this.releaseAll();
      return false;
    }
    // camera in body-fixed axes, in units of the radius
    const cg: Vec3 = [-i.rel[0] / i.rpc, -i.rel[1] / i.rpc, -i.rel[2] / i.rpc];
    const camB = galToBody(i.f, cg);
    const d = Math.hypot(...camB);
    const camDir: Vec3 = [camB[0] / d, camB[1] / d, camB[2] / d];
    const horizon = d > 1 ? Math.acos(1 / d) : Math.PI;
    // detail layer drives the brightness below ~60 km altitude (see shade())
    const altKm = (d - 1) * i.rpc / PC_PER_KM_SURF;
    this.uNear.value = Math.min(1, Math.max(0, (60 - altKm) / 45));
    this.m4.multiplyMatrices(i.camera.projectionMatrix, i.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.m4);
    // side planes only: near/far are set for scene units elsewhere and do not apply to pc here
    this.frustum.planes[4].set(new THREE.Vector3(0, 0, 0), 1);
    this.frustum.planes[5].set(new THREE.Vector3(0, 0, 0), 1);
    const spec = this.spec;

    // ---- select leaves
    const leaves: { n: QNode; dist: number }[] = [];
    const visit = (n: QNode) => {
      n.used = this.frame;
      const cosA = n.c[0] * camDir[0] + n.c[1] * camDir[1] + n.c[2] * camDir[2];
      const angToCam = Math.acos(Math.max(-1, Math.min(1, cosA)));
      if (angToCam - n.ang > horizon) return; // entirely beyond the horizon
      // frustum: the patch's chord sphere, relative to the eye (pc)
      const cG = bodyToGal(i.f, n.c);
      const chord = 2 * Math.sin(Math.min(n.ang, Math.PI / 2) / 2);
      this.sphere.center.set(i.rel[0] + cG[0] * i.rpc, i.rel[1] + cG[1] * i.rpc, i.rel[2] + cG[2] * i.rpc);
      this.sphere.radius = Math.max(chord, 1 - Math.cos(n.ang)) * i.rpc * 1.05;
      if (n.z > 0 && !this.frustum.intersectsSphere(this.sphere)) return;
      // distance to the nearest point of the patch, at least the altitude
      const dc = Math.hypot(camB[0] - n.c[0], camB[1] - n.c[1], camB[2] - n.c[2]);
      const dist = Math.max(dc - chord, d - 1, 1e-6) * i.rpc;
      const z = n.z;
      const px = z < spec.color.maxLevel || !spec.detail ? spec.color.px : spec.detail.src.px;
      const texel = ((Math.PI / 2 ** z) / px) * i.rpc;
      const sse = (texel / dist) * i.pxPerRad;
      const split = z < spec.maxLevel && (z < MIN_LEVEL || sse > SPLIT_PX) && leaves.length < MAX_LEAVES;
      if (split) {
        if (!n.kids) n.kids = [0, 1, 2, 3].map((k) => makeNode(z + 1, n.x * 2 + (k & 1), n.y * 2 + (k >> 1)));
        for (const k of n.kids) visit(k);
      } else leaves.push({ n, dist });
    };
    for (const r of this.roots) visit(r);

    // ---- requests: colour tile (and its parent while missing), detail tile; coarse levels first
    const cmax = spec.color.maxLevel;
    for (const { n, dist } of leaves) {
      const zc = Math.min(n.z, cmax);
      const k = zc - n.z;
      const cx = n.x >> -k;
      const cy = n.y >> -k;
      const prioBase = Math.log2(dist / i.rpc + 1e-9);
      if (!this.cache.get(tileKey(spec.color.id, zc, cx, cy))) {
        this.cache.want(tileKey(spec.color.id, zc, cx, cy), spec.color.url(zc, cx, cy), zc * 10 + prioBase);
        if (zc > 0) this.cache.want(tileKey(spec.color.id, zc - 1, cx >> 1, cy >> 1), spec.color.url(zc - 1, cx >> 1, cy >> 1), (zc - 1) * 10 + prioBase);
      }
      if (spec.detail && n.z >= spec.detail.fromLevel) {
        const zd = Math.min(n.z, spec.detail.src.maxLevel);
        const s = n.z - zd;
        this.cache.want(tileKey(spec.detail.src.id, zd, n.x >> s, n.y >> s), spec.detail.src.url(zd, n.x >> s, n.y >> s), zd * 10 + 5 + prioBase);
        const zl = Math.max(0, zd - LOWPASS_UP);
        const sl = n.z - zl;
        this.cache.want(tileKey(spec.detail.src.id, zl, n.x >> sl, n.y >> sl), spec.detail.src.url(zl, n.x >> sl, n.y >> sl), zl * 10 + 5 + prioBase);
      }
    }

    // ---- patches
    const keep = new Set<QNode>();
    let fading = false;
    let own = 0;
    let maxZ = 0;
    for (const { n } of leaves) {
      keep.add(n);
      maxZ = Math.max(maxZ, n.z);
      let p = this.live.get(n);
      const fresh = !p;
      if (!p) {
        p = this.pool.pop() ?? this.newPatch();
        if (!n.geom) n.geom = buildGeometry(n);
        p.mesh.geometry = n.geom;
        p.node = n;
        p.a.key = p.b.key = '';
        this.live.set(n, p);
      }
      const pick = this.pick(n, spec, i.globalTex);
      if (pick.key.startsWith(`${spec.color.id}/${Math.min(n.z, cmax)}/`)) own++;
      if (p.b.key !== pick.key) {
        if (fresh || !p.b.key) {
          // slot A stays on its own placeholder: no texture in two nodes of one material (below)
          clearSlot(p.a);
          assign(p.b, pick);
          p.uFade.value = 1;
        } else {
          // keep showing the old image in slot A and fade the new one in
          assign(p.a, this.slotPick(p.b));
          assign(p.b, pick);
          p.t0 = i.now;
          p.uFade.value = 0;
        }
      }
      if (p.uFade.value < 1) {
        p.uFade.value = Math.min(1, (i.now - p.t0) / FADE_MS);
        fading = true;
      }
      // keep the textures of both slots resident
      if (p.a.key) for (const k of p.a.key.split('|')) if (k !== 'global') this.cache.get(k);
      // patch matrix: body axes scaled by the radius, origin at the patch centre (relative to eye)
      const cG = bodyToGal(i.f, n.c);
      const R = i.rpc;
      p.mesh.matrix.set(
        i.f.x[0] * R, i.f.y[0] * R, i.f.z[0] * R, i.rel[0] + cG[0] * R,
        i.f.x[1] * R, i.f.y[1] * R, i.f.z[1] * R, i.rel[1] + cG[1] * R,
        i.f.x[2] * R, i.f.y[2] * R, i.f.z[2] * R, i.rel[2] + cG[2] * R,
        0, 0, 0, 1,
      );
      p.mesh.matrixWorldNeedsUpdate = true;
      p.mesh.visible = true;
    }
    for (const [n, p] of this.live) if (!keep.has(n)) this.release(n, p);
    this.prune();
    this.stats.leaves = leaves.length;
    this.stats.maxLevel = maxZ;
    this.stats.withOwnTile = own;
    return fading;
  }

  /** the best loaded imagery for a node: own tile, else the nearest loaded ancestor, else the global map */
  private pick(n: QNode, spec: SurfaceSpec, globalTex: THREE.Texture | null): Pick {
    let c: Pick['cTex'] | null = null;
    let cOff: [number, number] = [0, 0];
    let cScale: [number, number] = [1, 1];
    let ck = 'global';
    for (let z = Math.min(n.z, spec.color.maxLevel); z >= 0; z--) {
      const s = n.z - z;
      const key = tileKey(spec.color.id, z, n.x >> s, n.y >> s);
      const t = this.cache.get(key);
      if (t) {
        const r = subRect(n.z, n.x, n.y, z);
        c = t;
        cOff = r.off;
        cScale = [r.scale, r.scale];
        ck = key;
        break;
      }
    }
    if (!c) {
      const g = globalRect(n.z, n.x, n.y);
      c = globalTex ?? BLANK;
      cOff = g.off;
      cScale = g.scale;
    }
    let dTex: THREE.Texture | null = null;
    let dOff: [number, number] = [0, 0];
    let dScale: [number, number] = [1, 1];
    let lTex: THREE.Texture | null = null;
    let lOff: [number, number] = [0, 0];
    let lScale: [number, number] = [1, 1];
    let dk = '';
    if (spec.detail && n.z >= spec.detail.fromLevel) {
      for (let z = Math.min(n.z, spec.detail.src.maxLevel); z >= spec.detail.fromLevel; z--) {
        const s = n.z - z;
        const key = tileKey(spec.detail.src.id, z, n.x >> s, n.y >> s);
        const t = this.cache.get(key);
        if (t) {
          const r = subRect(n.z, n.x, n.y, z);
          // its low-pass reference: the same mosaic LOWPASS_UP levels coarser
          const zl = Math.max(0, z - LOWPASS_UP);
          const lkey = tileKey(spec.detail.src.id, zl, n.x >> (n.z - zl), n.y >> (n.z - zl));
          const lt = this.cache.get(lkey);
          if (!lt) continue;
          const rl = subRect(n.z, n.x, n.y, zl);
          dTex = t;
          dOff = r.off;
          dScale = [r.scale, r.scale];
          lTex = lt;
          lOff = rl.off;
          lScale = [rl.scale, rl.scale];
          dk = `${key}|${lkey}`;
          break;
        }
      }
    }
    return { key: dk ? `${ck}|${dk}` : ck, cTex: c, cOff, cScale, dTex, dOff, dScale, lTex, lOff, lScale };
  }

  private slotPick(s: Slot): Pick {
    return {
      key: s.key, cTex: s.cTex.value, cOff: [s.cOff.value.x, s.cOff.value.y], cScale: [s.cScale.value.x, s.cScale.value.y],
      dTex: s.dW.value > 0 ? s.dTex.value : null, dOff: [s.dOff.value.x, s.dOff.value.y], dScale: [s.dScale.value.x, s.dScale.value.y],
      lTex: s.dW.value > 0 ? s.lTex.value : null, lOff: [s.lOff.value.x, s.lOff.value.y], lScale: [s.lScale.value.x, s.lScale.value.y],
    };
  }

  private newPatch(): Patch {
    const p = makePatch(this.uSun, this.uAlpha, this.uNear);
    this.parent.add(p.mesh);
    return p;
  }

  private release(n: QNode, p: Patch) {
    p.mesh.visible = false;
    p.node = null;
    p.a.key = p.b.key = '';
    this.live.delete(n);
    this.pool.push(p);
  }

  private releaseAll() {
    for (const [n, p] of this.live) this.release(n, p);
  }

  /** drop subtrees not visited for a while (their geometry too) */
  private prune() {
    if (this.frame % 120 !== 0) return;
    const old = this.frame - 600;
    const walk = (n: QNode) => {
      if (!n.kids) return;
      if (n.kids.every((k) => k.used < old && !this.live.has(k))) {
        const free = (k: QNode) => {
          k.kids?.forEach(free);
          const p = this.live.get(k);
          if (p) this.release(k, p);
          k.geom?.dispose();
          k.geom = null;
        };
        n.kids.forEach(free);
        n.kids = null;
      } else n.kids.forEach(walk);
    };
    this.roots.forEach(walk);
  }
}
