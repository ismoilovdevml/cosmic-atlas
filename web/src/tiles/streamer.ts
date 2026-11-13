/**
 * Octree point-cloud streaming (docs/data-contract.md sections 3 and 5).
 *
 * Per frame, all visible layers are traversed together through one max-priority queue keyed
 * by projected node size in pixels. Nodes are taken in priority order until the global point
 * budget is spent; that set is drawn (additive LOD: parents and children together). Missing
 * nodes in the set are fetched, most important first, with a small concurrency limit.
 * Children are only considered once their parent is loaded. Nodes that drop out of the set
 * stay cached until the cache exceeds its budget, then the least-recently-used are disposed.
 */

import * as THREE from 'three/webgpu';
import type { Vec3 } from '../math/frames';
import { parseMeta, parseRenderRecords, type LayerMeta, type NodeMeta, type RenderRecords } from './format';
import type { PointLayerConfig } from '../data/manifest';
import { createPointMaterial, makeNodeGeometry, type PointUniforms } from '../render/pointMaterial';

const SQRT3 = Math.sqrt(3);

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
  state: NodeState;
  points: THREE.Mesh | null;
  data: RenderRecords | null;
  lastUsed: number;
  priority: number;
  ext: Promise<ArrayBuffer> | null;
}

export class PointLayer {
  readonly cfg: PointLayerConfig;
  meta: LayerMeta | null = null;
  status: 'pending' | 'ready' | 'missing' | 'error' = 'pending';
  error = '';
  root: TileNode | null = null;
  readonly material: THREE.PointsNodeMaterial;
  readonly uniforms: PointUniforms;
  readonly group = new THREE.Group();
  visible: boolean;
  opacity = 1;
  /** hidden because a real layer it stands in for is available */
  superseded = false;

  constructor(cfg: PointLayerConfig) {
    this.cfg = cfg;
    this.visible = cfg.visible;
    const pm = createPointMaterial(cfg.colorMode);
    this.material = pm.material;
    this.uniforms = pm.uniforms;
    this.group.name = cfg.id;
  }

  get kind() {
    return this.cfg.colorMode;
  }

  get active() {
    return this.status === 'ready' && this.visible && !this.superseded && this.opacity > 0;
  }

  url(rel: string) {
    return `${this.cfg.path.replace(/\/$/, '')}/${rel}`;
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
      const byName = new Map<string, TileNode>();
      for (const m of this.meta.nodes) {
        byName.set(m.name, {
          layer: this,
          meta: m,
          children: [],
          state: NodeState.Unloaded,
          points: null,
          data: null,
          lastUsed: -1,
          priority: 0,
          ext: null,
        });
      }
      for (const n of byName.values()) {
        if (n.meta.name.length > 1) byName.get(n.meta.name.slice(0, -1))?.children.push(n);
      }
      this.root = byName.get('r') ?? null;
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
      n.ext.catch(() => (n.ext = null));
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
}

export interface StreamStats {
  visibleNodes: number;
  drawnNodes: number;
  drawnPoints: number;
  wantedPoints: number;
  loadedNodes: number;
  loadedPoints: number;
  inFlight: number;
  queued: number;
  failed: number;
  nearestPc: number;
  farthestPc: number;
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
  onLoaded: () => void = () => {};

  private inFlight = 0;
  private visible: TileNode[] = [];
  private loaded = new Set<TileNode>();
  private failed = 0;
  private sphere = new THREE.Sphere();
  stats: StreamStats = {
    visibleNodes: 0, drawnNodes: 0, drawnPoints: 0, wantedPoints: 0, loadedNodes: 0, loadedPoints: 0,
    inFlight: 0, queued: 0, failed: 0, nearestPc: Infinity, farthestPc: 0,
  };

  /** projected size (device px) of a node's bounding sphere; huge when the camera is inside */
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
    const heap = new MaxHeap<TileNode>();
    for (const L of this.layers) {
      if (!L.active || !L.root) continue;
      if (!this.inFrustum(L.root, v)) continue;
      L.root.priority = this.projected(L.root, v.camPos, v.pxPerRad).px;
      heap.push(L.root);
    }
    const visible: TileNode[] = [];
    const toLoad: TileNode[] = [];
    let budgetUsed = 0;
    let nearest = Infinity;
    let farthest = 0;
    while (heap.size) {
      const n = heap.pop()!;
      if (budgetUsed + n.meta.count > this.pointBudget) break;
      budgetUsed += n.meta.count;
      visible.push(n);
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
    // fetch most important first
    toLoad.sort((a, b) => b.priority - a.priority);
    for (const n of toLoad) {
      if (this.inFlight >= this.maxConcurrent) break;
      this.load(n);
    }
    // draw set
    for (const n of this.visible) if (n.points) n.points.visible = false;
    let drawnPoints = 0;
    let drawnNodes = 0;
    for (const n of visible) {
      if (!n.points) continue;
      const c = n.meta.center;
      n.points.position.set(c[0] - v.camPos[0], c[1] - v.camPos[1], c[2] - v.camPos[2]);
      n.points.visible = true;
      drawnPoints += n.meta.count;
      drawnNodes++;
    }
    this.visible = visible;
    this.evict(v.frame);
    let loadedPoints = 0;
    for (const n of this.loaded) loadedPoints += n.meta.count;
    this.stats = {
      visibleNodes: visible.length,
      drawnNodes,
      drawnPoints,
      wantedPoints: budgetUsed,
      loadedNodes: this.loaded.size,
      loadedPoints,
      inFlight: this.inFlight,
      queued: toLoad.length,
      failed: this.failed,
      nearestPc: nearest,
      farthestPc: farthest,
    };
    return this.stats;
  }

  /** nodes currently drawn (for picking) */
  drawn(): TileNode[] {
    return this.visible.filter((n) => n.points?.visible);
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
        const pts = new THREE.Mesh(g, L.material);
        pts.frustumCulled = false;
        pts.visible = false;
        pts.matrixWorldAutoUpdate = true;
        pts.userData.node = n;
        L.group.add(pts);
        n.points = pts;
        n.data = data;
        n.state = NodeState.Loaded;
        this.loaded.add(n);
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
    const candidates = [...this.loaded].filter((n) => n.lastUsed !== frame).sort((a, b) => a.lastUsed - b.lastUsed);
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
    }
    n.points = null;
    n.data = null;
    n.ext = null;
    n.state = NodeState.Unloaded;
    this.loaded.delete(n);
  }

  /** drop everything of a layer from GPU (e.g. when toggled off for good) */
  releaseLayer(L: PointLayer) {
    for (const n of [...this.loaded]) if (n.layer === L) this.unload(n);
  }
}
