/**
 * Octree point-cloud streaming (docs/data-contract.md sections 3 and 5).
 *
 * Per frame, all visible layers are traversed together through one max-priority queue keyed
 * by projected node size in pixels. Nodes are taken in priority order until the global point
 * budget is spent; that set is the cut (additive LOD: parents and children drawn together).
 * Missing nodes in the cut are fetched, most important first, with a small concurrency limit;
 * children are only considered once their parent is loaded.
 *
 * Light conservation (tiles/blobs.ts): every node that is not drawn but whose parent is (or an
 * undrawn root) is drawn as one soft blob carrying its whole subtree's light (`agg`).
 * Fades: each node has two linear channels, own points and blob, walking toward their targets at
 * the same rate. When a node splits, its blob fades out while its own points and its children's
 * blobs fade in, so the summed light is conserved through the transition (skymap's two-channel
 * fade, cut.wesl, re-implemented).
 *
 * Cached-but-undrawn nodes are kept until the cache exceeds its budget, then the least recently
 * used fully-faded ones are disposed.
 */

import * as THREE from 'three/webgpu';
import type { Vec3 } from '../math/frames';
import { parseMeta, parseRenderRecords, readExtRecord, type LayerMeta, type NodeMeta, type RenderRecords } from './format';
import type { PointLayerConfig } from '../data/manifest';
import { createBlobMaterial, createLayerMaterials, makeNodeGeometry, QUAD, type LayerMaterials, type PointUniforms } from '../render/pointMaterial';
import { ownLight } from './blobs';

const SQRT3 = Math.sqrt(3);
/** seconds for a full split/merge cross-fade */
export const FADE_S = 0.35;
/** at most this many drawn nodes get their pick records loaded for the uncertainty view */
export const UNC_NODE_BUDGET = 32;

export enum NodeState {
  Unloaded = 0,
  Loading = 1,
  Loaded = 2,
  Failed = 3,
}

export interface TileNode {
  layer: PointLayer;
  meta: NodeMeta;
  children: TileNode[];
  parent: TileNode | null;
  state: NodeState;
  points: THREE.Mesh | null;
  pick: THREE.Mesh | null;
  data: RenderRecords | null;
  lastUsed: number;
  priority: number;
  ext: Promise<ArrayBuffer> | null;
  extBuf: ArrayBuffer | null;
  uncReady: boolean;
  ownAlpha: number;
  blobAlpha: number;
  slot: number;
  ownL: number;
}

export class PointLayer {
  readonly cfg: PointLayerConfig;
  meta: LayerMeta | null = null;
  status: 'pending' | 'ready' | 'missing' | 'error' = 'pending';
  error = '';
  root: TileNode | null = null;
  readonly byName = new Map<string, TileNode>();
  readonly mats: LayerMaterials;
  readonly group = new THREE.Group();
  readonly pickGroup = new THREE.Group();
  readonly blobMesh: THREE.Mesh;
  private blobCap = 0;
  visible: boolean;
  opacity = 1;
  /** hidden because a real layer it stands in for is available */
  superseded = false;

  constructor(cfg: PointLayerConfig, readonly code: number) {
    this.cfg = cfg;
    this.visible = cfg.visible;
    this.mats = createLayerMaterials(cfg.colorMode, code);
    this.group.name = cfg.id;
    const bg = new THREE.InstancedBufferGeometry();
    bg.setIndex(QUAD.index!.clone());
    bg.setAttribute('position', QUAD.getAttribute('position').clone());
    bg.setAttribute('uv', QUAD.getAttribute('uv').clone());
    this.blobMesh = new THREE.Mesh(bg, createBlobMaterial(this.mats.uniforms));
    this.blobMesh.frustumCulled = false;
    this.ensureBlobCapacity(256);
    this.group.add(this.blobMesh);
  }

  get uniforms(): PointUniforms {
    return this.mats.uniforms;
  }

  get kind() {
    return this.cfg.colorMode;
  }

  get active() {
    return this.status === 'ready' && this.visible && !this.superseded && this.opacity > 0;
  }

  get extStride() {
    return this.meta?.extBytesPerPoint ?? 16;
  }

  url(rel: string) {
    return `${this.cfg.path.replace(/\/$/, '')}/${rel}`;
  }

  ensureBlobCapacity(n: number) {
    if (n <= this.blobCap) return;
    const cap = Math.max(n, this.blobCap * 2);
    const g = this.blobMesh.geometry as THREE.InstancedBufferGeometry;
    g.setAttribute('binst', new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3));
    g.setAttribute('bcol', new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3));
    g.setAttribute('bdat', new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2));
    g.instanceCount = 0;
    this.blobCap = cap;
  }

  async init(known?: Set<string>): Promise<void> {
    if (known && !known.has(this.cfg.path.replace(/\/$/, '').split('/').pop()!)) {
      this.status = 'missing';
      return;
    }
    try {
      const r = await fetch(this.url('meta.json'));
      const type = r.headers.get('content-type') ?? '';
      if (r.status === 404 || !type.includes('json')) {
        this.status = 'missing';
        return;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      this.meta = parseMeta(await r.json());
      for (const m of this.meta.nodes) {
        this.byName.set(m.name, {
          layer: this, meta: m, children: [], parent: null, state: NodeState.Unloaded, points: null, pick: null,
          data: null, lastUsed: -1, priority: 0, ext: null, extBuf: null, uncReady: false, ownAlpha: 0, blobAlpha: 0,
          slot: 0, ownL: 0,
        });
      }
      for (const n of this.byName.values()) {
        const p = n.meta.name.length > 1 ? this.byName.get(n.meta.name.slice(0, -1)) : undefined;
        if (p) {
          p.children.push(n);
          n.parent = p;
        }
      }
      for (const n of this.byName.values()) n.ownL = ownLight(n);
      this.root = this.byName.get('r') ?? null;
      if (!this.root) throw new Error('no root node r');
      this.status = 'ready';
    } catch (e) {
      this.status = 'error';
      this.error = (e as Error).message;
    }
  }

  loadExt(n: TileNode): Promise<ArrayBuffer> {
    if (!n.ext) {
      n.ext = fetch(this.url(`n/${n.meta.name}.ext.bin`)).then((r) => {
        if (!r.ok) throw new Error(`${n.meta.name}.ext.bin: HTTP ${r.status}`);
        return r.arrayBuffer();
      });
      n.ext.then((b) => (n.extBuf = b)).catch(() => (n.ext = null));
    }
    return n.ext;
  }
}

export interface StreamView {
  camPos: Vec3;
  /** frustum in relative-to-eye coordinates (camera at origin) */
  frustum: THREE.Frustum;
  /** pixels per radian at the screen centre (device pixels) */
  pxPerRad: number;
  frame: number;
  dt: number;
}

export interface StreamStats {
  visibleNodes: number;
  drawnNodes: number;
  drawnPoints: number;
  wantedPoints: number;
  loadedNodes: number;
  loadedPoints: number;
  blobs: number;
  inFlight: number;
  queued: number;
  failed: number;
  nearestPc: number;
  farthestPc: number;
  /** drawn light / root subtree light, per active layer (1 = conserved) */
  light: Record<string, number>;
  fading: boolean;
}

class MaxHeap<T extends { priority: number }> {
  private a: T[] = [];
  get size() {
    return this.a.length;
  }
  push(x: T) {
    const a = this.a;
    a.push(x);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].priority >= a[i].priority) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): T | undefined {
    const a = this.a;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].priority > a[m].priority) m = l;
        if (r < a.length && a[r].priority > a[m].priority) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

export class Streamer {
  layers: PointLayer[] = [];
  /** global point budget (contract default 4 M) */
  pointBudget = 4_000_000;
  /** a node is refined when its projected size exceeds this many device pixels */
  minNodePx = 140;
  maxConcurrent = 6;
  /** cached-but-not-drawn points are kept up to this multiple of the budget */
  cacheFactor = 1.6;
  /** "distance uncertainty" display mode */
  uncertainty = false;
  onLoaded: () => void = () => {};

  private inFlight = 0;
  private live = new Set<TileNode>();
  private loaded = new Set<TileNode>();
  private failed = 0;
  private sphere = new THREE.Sphere();
  private slots: (TileNode | null)[] = [null];
  private freeSlots: number[] = [];
  stats: StreamStats = {
    visibleNodes: 0, drawnNodes: 0, drawnPoints: 0, wantedPoints: 0, loadedNodes: 0, loadedPoints: 0, blobs: 0,
    inFlight: 0, queued: 0, failed: 0, nearestPc: Infinity, farthestPc: 0, light: {}, fading: false,
  };

  nodeForSlot(slot: number): TileNode | null {
    return this.slots[slot] ?? null;
  }

  private projected(n: TileNode, cam: Vec3, pxPerRad: number): { px: number; dist: number } {
    const c = n.meta.center;
    const d = Math.hypot(c[0] - cam[0], c[1] - cam[1], c[2] - cam[2]);
    const r = n.meta.half * SQRT3;
    if (d <= r) return { px: 1e12 / (1 + d / r), dist: 0 };
    return { px: (r / Math.sqrt(d * d - r * r)) * pxPerRad, dist: d - r };
  }

  private inFrustum(n: TileNode, v: StreamView): boolean {
    const c = n.meta.center;
    this.sphere.center.set(c[0] - v.camPos[0], c[1] - v.camPos[1], c[2] - v.camPos[2]);
    this.sphere.radius = n.meta.half * SQRT3;
    return v.frustum.intersectsSphere(this.sphere);
  }

  update(v: StreamView): StreamStats {
    // ---- 1. the cut: priority queue under the point budget
    const heap = new MaxHeap<TileNode>();
    for (const L of this.layers) {
      if (!L.active || !L.root) continue;
      L.root.priority = this.projected(L.root, v.camPos, v.pxPerRad).px;
      heap.push(L.root);
    }
    const cut = new Set<TileNode>();
    const toLoad: TileNode[] = [];
    let budgetUsed = 0;
    let nearest = Infinity;
    let farthest = 0;
    while (heap.size) {
      const n = heap.pop()!;
      if (budgetUsed + n.meta.count > this.pointBudget) break;
      budgetUsed += n.meta.count;
      cut.add(n);
      n.lastUsed = v.frame;
      const pr = this.projected(n, v.camPos, v.pxPerRad);
      nearest = Math.min(nearest, pr.dist);
      farthest = Math.max(farthest, pr.dist + 2 * n.meta.half * SQRT3);
      if (n.state === NodeState.Unloaded) toLoad.push(n);
      if (n.state !== NodeState.Loaded) continue;
      for (const ch of n.children) {
        if (!this.inFrustum(ch, v)) continue;
        const p = this.projected(ch, v.camPos, v.pxPerRad).px;
        if (p < this.minNodePx) continue;
        ch.priority = p;
        heap.push(ch);
      }
    }
    toLoad.sort((a, b) => b.priority - a.priority);
    for (const n of toLoad) {
      if (this.inFlight >= this.maxConcurrent) break;
      this.load(n);
    }

    // ---- 2. targets: own points for loaded cut nodes, blobs for the undrawn frontier
    const ownTarget = new Set<TileNode>();
    const blobTarget = new Set<TileNode>();
    for (const L of this.layers) {
      if (!L.active || !L.root) continue;
      const walk = (n: TileNode) => {
        if (cut.has(n) && n.state === NodeState.Loaded) {
          ownTarget.add(n);
          for (const c of n.children) walk(c);
        } else blobTarget.add(n);
      };
      walk(L.root);
    }

    // ---- 3. linear fades, same rate on both channels (light conserved through a split)
    const step = Math.min(1, v.dt / FADE_S);
    for (const n of ownTarget) this.live.add(n);
    for (const n of blobTarget) this.live.add(n);
    let fading = false;
    for (const n of this.live) {
      const ot = ownTarget.has(n) && n.layer.active ? 1 : 0;
      const bt = blobTarget.has(n) && n.layer.active ? 1 : 0;
      n.ownAlpha = n.state === NodeState.Loaded ? approach(n.ownAlpha, ot, step) : 0;
      n.blobAlpha = approach(n.blobAlpha, bt, step);
      if (n.ownAlpha !== ot || n.blobAlpha !== bt) fading = true;
      if (n.ownAlpha === 0 && n.blobAlpha === 0 && !ot && !bt) this.live.delete(n);
    }

    // ---- 4. draw: node meshes (RTE positions), pick meshes, blob instances
    const blobLists = new Map<PointLayer, TileNode[]>();
    let drawnPoints = 0;
    let drawnNodes = 0;
    for (const n of this.loaded) {
      const on = n.ownAlpha > 0.001 && n.layer.active;
      if (n.points) {
        n.points.visible = on;
        n.pick!.visible = on;
        if (on) {
          const c = n.meta.center;
          n.points.position.set(c[0] - v.camPos[0], c[1] - v.camPos[1], c[2] - v.camPos[2]);
          n.pick!.position.copy(n.points.position);
          n.points.userData.alpha = n.pick!.userData.alpha = n.ownAlpha;
          const unc = this.uncertainty && n.uncReady;
          const mat = unc ? n.layer.mats.uncMaterial : n.layer.mats.material;
          if (n.points.material !== mat) n.points.material = mat;
          drawnPoints += n.meta.count;
          drawnNodes++;
        }
      }
    }
    const light: Record<string, number> = {};
    for (const L of this.layers) {
      if (!L.active || !L.root) {
        L.blobMesh.visible = false;
        continue;
      }
      blobLists.set(L, []);
      light[L.cfg.id] = 0;
    }
    for (const n of this.live) {
      const list = blobLists.get(n.layer);
      if (!list) continue;
      light[n.layer.cfg.id] += n.ownAlpha * n.ownL + n.blobAlpha * (n.meta.agg?.L ?? 0);
      if (n.blobAlpha > 0.001 && n.meta.agg && n.meta.agg.L > 0) list.push(n);
    }
    let blobs = 0;
    for (const [L, list] of blobLists) {
      const rootL = L.root!.meta.agg?.L;
      light[L.cfg.id] = rootL ? light[L.cfg.id] / rootL : NaN;
      L.ensureBlobCapacity(list.length);
      const g = L.blobMesh.geometry as THREE.InstancedBufferGeometry;
      const pos = g.getAttribute('binst') as THREE.InstancedBufferAttribute;
      const col = g.getAttribute('bcol') as THREE.InstancedBufferAttribute;
      const dat = g.getAttribute('bdat') as THREE.InstancedBufferAttribute;
      const P = pos.array as Float32Array;
      const C = col.array as Float32Array;
      const D = dat.array as Float32Array;
      list.forEach((n, i) => {
        const a = n.meta.agg!;
        const c = n.meta.center;
        // float64 subtraction, then narrow (relative to eye)
        P[i * 3] = c[0] + a.c[0] - v.camPos[0];
        P[i * 3 + 1] = c[1] + a.c[1] - v.camPos[1];
        P[i * 3 + 2] = c[2] + a.c[2] - v.camPos[2];
        C[i * 3] = a.rgb[0] / 255;
        C[i * 3 + 1] = a.rgb[1] / 255;
        C[i * 3 + 2] = a.rgb[2] / 255;
        D[i * 2] = a.L * n.blobAlpha;
        // points fill the node cube (rms ≈ 0.58 half-edge); the sprite Gaussian has σ ≈ radius/2.8
        D[i * 2 + 1] = n.meta.half * 1.6;
      });
      g.instanceCount = list.length;
      pos.needsUpdate = col.needsUpdate = dat.needsUpdate = true;
      L.blobMesh.visible = list.length > 0;
      L.blobMesh.position.set(0, 0, 0);
      blobs += list.length;
    }

    // ---- 5. uncertainty mode: pick records for the most important drawn nodes
    if (this.uncertainty) {
      const want = [...ownTarget].filter((n) => !n.uncReady).sort((a, b) => b.priority - a.priority);
      let have = [...ownTarget].filter((n) => n.uncReady).length;
      for (const n of want) {
        if (have >= UNC_NODE_BUDGET) break;
        have++;
        if (!n.ext) n.layer.loadExt(n).then(() => this.attachUnc(n)).catch(() => {});
      }
    }

    this.evict(v.frame);
    let loadedPoints = 0;
    for (const n of this.loaded) loadedPoints += n.meta.count;
    this.stats = {
      visibleNodes: cut.size, drawnNodes, drawnPoints, wantedPoints: budgetUsed, loadedNodes: this.loaded.size, loadedPoints,
      blobs, inFlight: this.inFlight, queued: toLoad.length, failed: this.failed, nearestPc: nearest, farthestPc: farthest,
      light, fading,
    };
    return this.stats;
  }

  /** add the `unc` (dist_lo/d, dist_hi/d) attribute once a node's pick records are in */
  private attachUnc(n: TileNode) {
    if (!n.extBuf || !n.points || !n.data) return;
    const stride = n.layer.extStride;
    const cnt = n.meta.count;
    const unc = new Float32Array(cnt * 2);
    const c = n.meta.center;
    const p = n.data.positions;
    for (let i = 0; i < cnt; i++) {
      const d = Math.hypot(c[0] + p[i * 3], c[1] + p[i * 3 + 1], c[2] + p[i * 3 + 2]);
      let lo = 1, hi = 1;
      if (stride >= 24 && d > 0) {
        const e = readExtRecord(n.extBuf, i, stride);
        lo = Number.isFinite(e.distLo) ? e.distLo / d : 1;
        // no upper percentile (parallax consistent with zero): show a long, capped streak
        hi = Number.isFinite(e.distHi) ? e.distHi / d : Number.isFinite(e.distLo) ? 3 : 1;
      }
      unc[i * 2] = Math.min(Math.max(lo, 0.05), 1);
      unc[i * 2 + 1] = Math.min(Math.max(hi, 1), 3);
    }
    (n.points.geometry as THREE.InstancedBufferGeometry).setAttribute('unc', new THREE.InstancedBufferAttribute(unc, 2));
    n.uncReady = true;
    this.onLoaded();
  }

  /** nodes currently drawn (own points visible) */
  drawn(): TileNode[] {
    return [...this.loaded].filter((n) => n.points?.visible);
  }

  private load(n: TileNode) {
    n.state = NodeState.Loading;
    this.inFlight++;
    const L = n.layer;
    fetch(L.url(`n/${n.meta.name}.bin`))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then((buf) => {
        const data = parseRenderRecords(buf, n.meta.count);
        const g = makeNodeGeometry(data.positions, data.rgbl, data.count, n.meta.half * SQRT3);
        const slot = this.freeSlots.pop() ?? this.slots.length;
        if (slot >= 1 << 22) throw new Error('pick slot space exhausted');
        this.slots[slot] = n;
        n.slot = slot;
        const pts = new THREE.Mesh(g, L.mats.material);
        const pick = new THREE.Mesh(g, L.mats.pickMaterial);
        for (const m of [pts, pick]) {
          m.frustumCulled = false;
          m.visible = false;
          m.userData.alpha = 0;
          m.userData.slot = slot;
          m.userData.node = n;
        }
        L.group.add(pts);
        L.pickGroup.add(pick);
        n.points = pts;
        n.pick = pick;
        n.data = data;
        n.state = NodeState.Loaded;
        n.ownAlpha = 0;
        this.loaded.add(n);
        if (this.uncertainty && n.extBuf) this.attachUnc(n);
      })
      .catch((e) => {
        n.state = NodeState.Failed;
        this.failed++;
        console.warn(`[tiles] ${L.cfg.id}/${n.meta.name}: ${(e as Error).message}`);
      })
      .finally(() => {
        this.inFlight--;
        this.onLoaded();
      });
  }

  private evict(frame: number) {
    let total = 0;
    for (const n of this.loaded) total += n.meta.count;
    const cap = this.pointBudget * this.cacheFactor;
    if (total <= cap) return;
    const candidates = [...this.loaded]
      .filter((n) => n.lastUsed !== frame && n.ownAlpha === 0)
      .sort((a, b) => a.lastUsed - b.lastUsed);
    for (const n of candidates) {
      if (total <= cap) break;
      this.unload(n);
      total -= n.meta.count;
    }
  }

  private unload(n: TileNode) {
    if (n.points) {
      n.points.geometry.dispose();
      n.layer.group.remove(n.points);
      n.layer.pickGroup.remove(n.pick!);
    }
    if (n.slot) {
      this.slots[n.slot] = null;
      this.freeSlots.push(n.slot);
    }
    n.slot = 0;
    n.points = n.pick = null;
    n.data = null;
    n.ext = null;
    n.extBuf = null;
    n.uncReady = false;
    n.ownAlpha = 0;
    n.state = NodeState.Unloaded;
    this.loaded.delete(n);
  }

  /** drop everything of a layer from GPU (e.g. when toggled off) */
  releaseLayer(L: PointLayer) {
    for (const n of [...this.loaded]) if (n.layer === L) this.unload(n);
    for (const n of [...this.live]) if (n.layer === L) {
      n.blobAlpha = 0;
      this.live.delete(n);
    }
  }
}

function approach(x: number, target: number, step: number) {
  return x < target ? Math.min(target, x + step) : Math.max(target, x - step);
}
