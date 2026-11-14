/**
 * Asteroids and comets: 1.58 million MPC orbits (data/tiles/small-bodies/, built by
 * scripts/build_small_bodies.py) propagated as two-body Kepler orbits on the GPU for the time in
 * the time bar (orbitpoints.ts), coloured by orbit class, plus a few thousand named objects for
 * search and labels (names.json, positions on the CPU with the float64 twin in kepler.ts).
 *
 * Loading: meta.json + names.json at start (1 MB, search needs them); the class binaries only when
 * the layer is on and the camera is inside the Solar System (< 0.05 pc), smallest first, the main
 * belt (44 MB) last. `maxPoints` (layers.json, or setCap) draws only the brightest N of each class:
 * the files are sorted by H, so the cap is a magnitude cut.
 *
 * Accuracy (test/smallbodies.test.ts against JPL Horizons): Ceres, Vesta, Apophis, Eris within
 * 1.1e-4 AU 158 days after the element epoch, 5.6e-4 AU after 339 days, 6.5e-3 AU after 2 years;
 * planetary perturbations are what two-body leaves out.
 */

import * as THREE from 'three/webgpu';
import { Fn, float, length, smoothstep, uniform, uv, vec3 } from 'three/tsl';
import type { Vec3 } from '../math/frames';
import { PC_PER_AU } from '../math/units';
import { srgbToLinear } from '../render/brightness';
import type { LabelItem } from '../render/labels';
import type { ExtraCtx, ExtraInfo, ExtraLayerConfig, SolarExtra } from './extra';
import { ECL_TO_GAL, MU_SUN, conicPosition, eclToGal, jdTTFromMs, orbitPolyline, periodDays } from './kepler';
import type { SolarEntry } from './layer';
import { unpackDesignation } from './mpcdesig';
import { makeOrbitPoints, orbitUniforms, setFrameMatrix, setOrbitCap, type OrbitPoints } from './orbitpoints';
import { tr } from './strings';

export const SB_CLASSES = ['neo', 'main', 'trojan', 'centaur', 'tno', 'comet'] as const;
export type SbClass = (typeof SB_CLASSES)[number];

/** class colours (sRGB) and look; the main belt is dense, so each of its points is dimmer */
export const SB_STYLE: Record<SbClass, { color: string; gain: number; hBright: number; floor: number; sizeMin: number; sizeMax: number }> = {
  neo:     { color: '#ff8f66', gain: 0.55, hBright: 17, floor: 0.14, sizeMin: 1.2, sizeMax: 3.0 },
  main:    { color: '#c8b48e', gain: 0.2, hBright: 11, floor: 0.07, sizeMin: 1.1, sizeMax: 3.6 },
  trojan:  { color: '#8fdc86', gain: 0.75, hBright: 11, floor: 0.25, sizeMin: 1.3, sizeMax: 3.2 },
  centaur: { color: '#d9a6ff', gain: 0.95, hBright: 8, floor: 0.35, sizeMin: 1.5, sizeMax: 3.6 },
  tno:     { color: '#86b9ff', gain: 0.95, hBright: 6, floor: 0.3, sizeMin: 1.4, sizeMax: 4.0 },
  comet:   { color: '#78f0e2', gain: 0.95, hBright: 9, floor: 0.3, sizeMin: 1.4, sizeMax: 3.2 },
};
/**
 * brightest N per class drawn as soft quads (size and glow), the rest as 1-px dots (orbitpoints.ts
 * makeDots): the quads alone made the layer fill-bound (perf_smallbodies.mjs)
 */
const QUADS: Record<SbClass, number> = { neo: 20000, main: 40000, trojan: 20000, centaur: 2000, tno: 10000, comet: 5000 };
/** typical outer radius of each class (AU), for the density LOD in update() */
const CLASS_RADIUS_AU: Record<SbClass, number> = { neo: 2, main: 3.6, trojan: 5.8, centaur: 25, tno: 55, comet: 30 };
const DOTS_PER_PX2 = 25;
/** the density LOD never draws fewer than this many objects of a class */
const MIN_DRAWN = 3000;
/** at most this much brighter per drawn point when the LOD thins a class (more saturates the core) */
const LOD_GAIN_MAX = 5;
/** load order: small files first, so most classes appear at once */
const LOAD_ORDER: SbClass[] = ['tno', 'centaur', 'trojan', 'neo', 'comet', 'main'];
const LOAD_WITHIN_PC = 0.05;

interface ClassMeta {
  id: SbClass;
  file: string;
  count: number;
  bytes: number;
  desig?: { chunk: number; files: number };
}

export interface SmallBodiesMeta {
  ref_epoch_jd_tt: number;
  classes: ClassMeta[];
  subclasses: Record<string, string[]>;
  total_bytes: number;
  sources?: Record<string, { url: string; file_time_utc: string }>;
}

interface NameRec {
  n: string;
  num?: number;
  c: SbClass;
  i: number;
  el: number[];
  ep: number | null;
  u?: number;
  opp?: string;
  arc?: string;
  dp?: 1;
  lbl?: 1;
}

interface ClassR {
  meta: ClassMeta;
  state: 'idle' | 'loading' | 'ready' | 'error';
  records?: Float32Array;
  flags?: Uint8Array;
  pts?: OrbitPoints;
  /** picking cache: Galactic pc positions at `posMs` */
  pos?: Float32Array;
  posMs: number;
}

/** what a small-body entry points at (SolarEntry.solar for type 'minor') */
export interface MinorRef {
  type: 'minor';
  cls: SbClass;
  idx: number;
  el: number[];
  num?: number;
  ep?: number | null;
  u?: number;
  opp?: string;
  arc?: string;
  dwarf?: boolean;
  /** picked from the points: its designation is still being fetched */
  unnamed?: boolean;
}

const lin = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return new THREE.Vector3(srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255));
};

export class SmallBodies implements SolarExtra {
  readonly group = new THREE.Group();
  readonly entries: SolarEntry[] = [];
  readonly labelItems: LabelItem[] = [];
  visible: boolean;
  opacity = 1;
  readonly ready: Promise<void>;
  meta: SmallBodiesMeta | null = null;
  readonly classes = new Map<SbClass, ClassR>();
  private base: string;
  private refJd = 2461200.5;
  private cap = Infinity;
  private labelled: SolarEntry[] = [];
  private entriesMs = NaN;
  private entriesT = 0;
  private loading = false;
  private sel: { e: SolarEntry; line: THREE.Line; marker: THREE.Sprite; uA: { value: number } } | null = null;
  private m = new THREE.Matrix4();
  private tmp: Vec3 = [0, 0, 0];
  private tmp2: Vec3 = [0, 0, 0];
  private desigCache = new Map<string, Promise<string[] | null>>();
  /** fade last frame (layer opacity × Solar System fade) */
  fade = 0;
  private dirty = false;

  constructor(readonly cfg: ExtraLayerConfig) {
    this.visible = cfg.visible;
    this.base = cfg.path.endsWith('/') ? cfg.path : `${cfg.path}/`;
    if (cfg.maxPoints) this.cap = cfg.maxPoints;
    const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('sbcap') : null;
    if (q && +q > 0) this.cap = +q;
    this.group.name = 'small-bodies';
    this.ready = this.loadIndex();
  }

  metaText(): string {
    const n = this.meta?.classes.reduce((a, c) => a + c.count, 0) ?? 0;
    const loaded = [...this.classes.values()].filter((c) => c.state === 'ready').reduce((a, c) => a + Math.min(c.meta.count, this.cap), 0);
    const base = tr('sb.layer.meta', { n: n.toLocaleString('en-US') });
    return loaded > 0 && loaded < n ? `${base} ${tr('sb.layer.drawn', { n: loaded.toLocaleString('en-US') })}` : base;
  }

  private async loadIndex() {
    try {
      const [m, names] = await Promise.all([
        fetch(`${this.base}meta.json`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`meta.json HTTP ${r.status}`)))),
        fetch(`${this.base}names.json`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`names.json HTTP ${r.status}`)))),
      ]);
      this.meta = m as SmallBodiesMeta;
      this.refJd = this.meta.ref_epoch_jd_tt;
      for (const c of this.meta.classes) this.classes.set(c.id, { meta: c, state: 'idle', posMs: NaN });
      for (const r of (names as { entries: NameRec[] }).entries) this.addEntry(r);
    } catch (e) {
      console.warn(`[small bodies] not available (${(e as Error).message})`);
    }
  }

  private addEntry(r: NameRec) {
    const isComet = r.c === 'comet';
    const alt: string[] = [];
    if (r.num) alt.push(`(${r.num}) ${r.n}`, `${r.num} ${r.n}`);
    if (isComet) {
      // "1P/Halley" also answers to "Halley" and "1P"; "C/2020 F3 (NEOWISE)" to "NEOWISE" and "C/2020 F3"
      const m = /^([^/]+\/)?(.*?)(?: \((.+)\))?$/.exec(r.n);
      if (m) {
        if (m[1] && /^\d+[PDI]\/$/.test(m[1])) alt.push(m[2], m[1].slice(0, -1));
        if (m[3]) alt.push(`${m[1] ?? ''}${m[2]}`.trim());
        // a bare name ("NEOWISE", "Borisov") is shared by many comets: only the famous one answers to it
        if (m[3] && r.lbl) alt.push(m[3]);
      }
    }
    const xyz: Vec3 = [0, 0, 0];
    const kind = r.dp ? 'dwarf_planet' : isComet ? 'comet' : 'asteroid';
    const ref: MinorRef = { type: 'minor', cls: r.c, idx: r.i, el: r.el, num: r.num, ep: r.ep, u: r.u, opp: r.opp, arc: r.arc, dwarf: !!r.dp };
    const e: SolarEntry = {
      name: r.n, alt: alt.filter((a, i) => a && a !== r.n && alt.indexOf(a) === i), kind, dist_pc: 0, xyz,
      docs: isComet ? 'comet' : r.num === 1 ? 'asteroid-belt' : r.dp ? 'solar-system' : 'asteroid-belt',
      ref: 'Orbit: IAU Minor Planet Center osculating elements; two-body propagation.',
      solar: ref as unknown as SolarEntry['solar'],
    };
    this.entries.push(e);
    if (r.lbl) {
      this.labelled.push(e);
      // H - 45 ranks labels by H and distance like apparent magnitudes (labels.ts), always "bright"
      this.labelItems.push({ name: r.n, xyz, kind, absMag: r.el[6] - 45, minScale: 0, maxScale: kind === 'comet' ? 4e-4 : 1.5e-3, sizePc: undefined, notable: true, onClick: () => this.onSelect(e) });
    }
  }

  /** set by layer.ts: open the info card */
  onSelect: (e: SolarEntry) => void = () => {};

  setCap(n: number) {
    this.cap = n > 0 ? n : Infinity;
    for (const c of this.classes.values()) if (c.pts) setOrbitCap(c.pts, c.meta.count, this.cap);
  }

  /** drawn object count (for stats) */
  drawnCount(): number {
    let n = 0;
    for (const c of this.classes.values()) if (c.pts && c.pts.mesh.visible) n += c.pts.geometry.instanceCount + (c.pts.dots?.geometry.drawRange.count ?? 0);
    return n;
  }

  private async loadClasses() {
    this.loading = true;
    for (const id of LOAD_ORDER) {
      const c = this.classes.get(id);
      if (!c || c.state !== 'idle') continue;
      c.state = 'loading';
      try {
        const r = await fetch(`${this.base}${c.meta.file}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const buf = await r.arrayBuffer();
        const n = c.meta.count;
        if (buf.byteLength !== n * 29) throw new Error(`size ${buf.byteLength} != ${n * 29}`);
        c.records = new Float32Array(buf, 0, n * 7);
        c.flags = new Uint8Array(buf, n * 28, n);
        const st = SB_STYLE[id];
        const U = orbitUniforms(lin(st.color), MU_SUN);
        U.gain.value = st.gain;
        U.hBright.value = st.hBright;
        U.floor.value = st.floor;
        U.sizeMin.value = st.sizeMin;
        U.sizeMax.value = st.sizeMax;
        c.pts = makeOrbitPoints({ count: n, records: c.records, uniforms: U, conics: id === 'comet', name: `sb-${id}`, quadCount: Math.min(n, QUADS[id]) });
        setOrbitCap(c.pts, n, this.cap);
        this.group.add(c.pts.mesh);
        if (c.pts.dots) this.group.add(c.pts.dots);
        c.state = 'ready';
        this.dirty = true;
      } catch (e) {
        c.state = 'error';
        console.warn(`[small bodies] ${c.meta.file}: ${(e as Error).message}`);
      }
    }
    this.loading = false;
  }

  /** days since the reference epoch (TT) at a UTC time */
  dtDays(ms: number): number {
    return jdTTFromMs(ms) - this.refJd;
  }

  positionAt(e: SolarEntry, ms: number, out: Vec3 = [0, 0, 0]): Vec3 | null {
    const r = e.solar as unknown as MinorRef;
    if (r.type !== 'minor') return null;
    conicPosition(r.el, this.dtDays(ms), MU_SUN, this.tmp);
    return eclToGal(this.tmp, PC_PER_AU, out);
  }

  private refreshEntries(ms: number, all: boolean) {
    const list = all ? this.entries : this.labelled;
    for (const e of list) {
      this.positionAt(e, ms, e.xyz);
      e.dist_pc = Math.hypot(...e.xyz);
    }
    if (all) this.entriesMs = ms;
  }

  update(c: ExtraCtx): boolean {
    const fade = this.visible ? this.opacity * c.fade : 0;
    const changed = Math.abs(fade - this.fade) > 1e-4;
    this.fade = fade;
    this.group.visible = fade > 0.002;
    const camSun = Math.hypot(...c.cam);
    if (this.group.visible && camSun < LOAD_WITHIN_PC && !this.loading && [...this.classes.values()].some((x) => x.state === 'idle')) void this.loadClasses();
    // named objects: labels every frame the time moves, the rest of the search list at most once a second
    if (c.timeChanged || this.entriesMs !== this.entriesMs) {
      const now = performance.now();
      const all = this.entriesMs !== this.entriesMs || (now - this.entriesT > 1000 && Math.abs(c.ms - this.entriesMs) > 3600e3);
      if (all) this.entriesT = now;
      this.refreshEntries(c.ms, all);
    }
    if (!this.group.visible) return changed;
    setFrameMatrix(this.m, ECL_TO_GAL, PC_PER_AU, [-c.cam[0], -c.cam[1], -c.cam[2]]);
    const dt = this.dtDays(c.ms);
    for (const k of this.classes.values()) {
      if (!k.pts) continue;
      const U = k.pts.uniforms;
      U.dt.value = dt;
      U.focus.value = c.focusDist * 1e9;
      U.dpr.value = c.dpr;
      U.gain.value = SB_STYLE[k.meta.id].gain * fade;
      // density LOD: seen from far outside, a class covers few pixels and 1.5 M points would pile up
      // ~100 deep on each of them (fill-bound); draw at most DOTS_PER_PX2 per pixel of its disc,
      // brightest first (quads, then dots), and scale them up toward the summed light (max LOD_GAIN_MAX)
      const n = Math.min(k.meta.count, this.cap);
      const nQuadsAll = Math.min(n, k.pts.quadCount);
      const nDotsAll = Math.max(0, n - k.pts.quadCount);
      let budget = Infinity;
      const R = CLASS_RADIUS_AU[k.meta.id] * PC_PER_AU;
      if (camSun > 1.5 * R) {
        const rPx = (R / camSun) * c.pxPerRad;
        budget = Math.max(MIN_DRAWN, Math.round(DOTS_PER_PX2 * Math.PI * rPx * rPx));
      }
      const nQuads = Math.min(nQuadsAll, budget);
      const nDots = Math.min(nDotsAll, Math.max(0, budget - nQuads));
      k.pts.geometry.instanceCount = nQuads;
      U.gain.value *= Math.min(LOD_GAIN_MAX, nQuads > 0 ? nQuadsAll / nQuads : 1);
      if (k.pts.dots) {
        k.pts.dots.geometry.setDrawRange(k.pts.quadCount, nDots);
        U.dotGain.value = 0.6 * Math.min(LOD_GAIN_MAX, nDots > 0 ? nDotsAll / nDots : 1);
      }
      k.pts.mesh.matrix.copy(this.m);
      k.pts.mesh.matrixWorldNeedsUpdate = true;
      if (k.pts.dots) {
        k.pts.dots.matrix.copy(this.m);
        k.pts.dots.matrixWorldNeedsUpdate = true;
      }
      k.pts.mesh.visible = true;
    }
    if (this.sel) this.placeSelection(c);
    const d = this.dirty;
    this.dirty = false;
    return changed || d;
  }

  // ------------------------------------------------------------------ picking

  /** Galactic pc positions of a class at `ms` (cached while the time stands still) */
  private positions(k: ClassR, ms: number): Float32Array {
    const n = Math.min(k.meta.count, this.cap);
    if (k.pos && k.posMs === ms && k.pos.length === n * 3) return k.pos;
    const out = k.pos && k.pos.length === n * 3 ? k.pos : new Float32Array(n * 3);
    const rec = k.records!;
    const el = [0, 0, 0, 0, 0, 0];
    const dt = this.dtDays(ms);
    const p = this.tmp;
    const g = this.tmp2;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < 6; j++) el[j] = rec[i * 7 + j];
      conicPosition(el, dt, MU_SUN, p, false, 8);
      eclToGal(p, PC_PER_AU, g);
      out[i * 3] = g[0];
      out[i * 3 + 1] = g[1];
      out[i * 3 + 2] = g[2];
    }
    k.pos = out;
    k.posMs = ms;
    return out;
  }

  pickAt(x: number, y: number, c: ExtraCtx): { e: SolarEntry; d: number } | null {
    if (!this.group.visible) return null;
    const cam = c.camera;
    const v = new THREE.Vector3();
    const R = 6;
    let best: { k: ClassR; i: number; d: number; dist: number } | null = null;
    for (const k of this.classes.values()) {
      if (!k.pts) continue;
      const pos = this.positions(k, c.ms);
      const n = pos.length / 3;
      for (let i = 0; i < n; i++) {
        v.set(pos[i * 3] - c.cam[0], pos[i * 3 + 1] - c.cam[1], pos[i * 3 + 2] - c.cam[2]);
        const dist = v.length();
        v.applyMatrix4(cam.matrixWorldInverse);
        if (v.z >= 0) continue;
        v.applyMatrix4(cam.projectionMatrix);
        const sx = (v.x * 0.5 + 0.5) * c.width;
        const sy = (-v.y * 0.5 + 0.5) * c.height;
        const d = Math.hypot(sx - x, sy - y);
        // brighter (lower index = lower H) wins within a pixel
        if (d <= R && (!best || d < best.d - 1 || (Math.abs(d - best.d) <= 1 && i < best.i))) best = { k, i, d, dist };
      }
    }
    if (!best) return null;
    return { e: this.entryFor(best.k, best.i, c.ms), d: best.d };
  }

  /** the named entry for a record, else a transient one (designation filled in asynchronously) */
  entryFor(k: ClassR, i: number, ms: number): SolarEntry {
    const named = this.entries.find((e) => {
      const r = e.solar as unknown as MinorRef;
      return r.cls === k.meta.id && r.idx === i;
    });
    if (named) return named;
    const rec = k.records!;
    const el = Array.from(rec.subarray(i * 7, i * 7 + 7));
    const u = k.flags ? k.flags[i] >> 4 : 15;
    const ref: MinorRef = { type: 'minor', cls: k.meta.id, idx: i, el, u, unnamed: true };
    const kind = k.meta.id === 'comet' ? 'comet' : 'asteroid';
    const e: SolarEntry = {
      name: tr(kind === 'comet' ? 'sb.unnamed.comet' : 'sb.unnamed.asteroid'), alt: [], kind, dist_pc: 0, xyz: [0, 0, 0],
      docs: kind === 'comet' ? 'comet' : 'asteroid-belt', ref: 'IAU Minor Planet Center', solar: ref as unknown as SolarEntry['solar'],
    };
    this.positionAt(e, ms, e.xyz);
    e.dist_pc = Math.hypot(...e.xyz);
    return e;
  }

  /** designation of a record from its chunk file (MPC packed form unpacked; comets: the name) */
  async designation(cls: SbClass, idx: number): Promise<string | null> {
    const k = this.classes.get(cls);
    const chunk = k?.meta.desig?.chunk ?? 65536;
    const key = `${cls}-${Math.floor(idx / chunk)}`;
    let p = this.desigCache.get(key);
    if (!p) {
      p = fetch(`${this.base}desig/${key}.txt`).then((r) => (r.ok ? r.text() : null)).then((t) => (t ? t.split('\n') : null)).catch(() => null);
      this.desigCache.set(key, p);
    }
    const lines = await p;
    const s = lines?.[idx % chunk];
    return s ? (cls === 'comet' ? s : unpackDesignation(s)) : null;
  }

  // ------------------------------------------------------------------ selection

  select(e: SolarEntry | null) {
    if (this.sel && this.sel.e === e) return;
    if (this.sel) {
      this.group.remove(this.sel.line, this.sel.marker);
      this.sel.line.geometry.dispose();
      this.sel = null;
    }
    const r = e?.solar as unknown as MinorRef | undefined;
    if (!e || r?.type !== 'minor') return;
    const rNow = Math.hypot(...e.xyz) / PC_PER_AU;
    const poly = orbitPolyline(r.el, 1024, Math.max(30, rNow * 2.5));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(poly), 3));
    const uA = uniform(0.5);
    const col = lin(SB_STYLE[r.cls].color);
    const mat = new THREE.LineBasicNodeMaterial({ transparent: true, depthTest: true, depthWrite: false, blending: THREE.AdditiveBlending });
    mat.colorNode = vec3(col.x, col.y, col.z).mul(0.9);
    mat.opacityNode = uA;
    const line = new THREE.Line(g, mat);
    line.matrixAutoUpdate = false;
    line.frustumCulled = false;
    line.renderOrder = 12;
    const smat = new THREE.SpriteNodeMaterial({ transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending });
    // a ring marker: bright annulus, hollow centre, so the object itself stays visible
    smat.colorNode = Fn(() => {
      const rr = length(uv().mul(2.0).sub(1.0));
      const ring = smoothstep(0.55, 0.72, rr).mul(float(1.0).sub(smoothstep(0.82, 1.0, rr)));
      return vec3(col.x, col.y, col.z).mul(ring).mul(uA).mul(2.0);
    })();
    smat.opacityNode = float(1.0);
    const marker = new THREE.Sprite(smat);
    marker.renderOrder = 15;
    marker.frustumCulled = false;
    this.group.add(line, marker);
    this.sel = { e, line, marker, uA };
    if (r.unnamed) {
      r.unnamed = false;
      void this.designation(r.cls, r.idx).then((d) => {
        if (!d) return;
        e.name = d;
        if (this.sel?.e === e) this.onSelect(e);
      });
    }
  }

  private placeSelection(c: ExtraCtx) {
    const s = this.sel!;
    s.line.matrix.copy(this.m);
    s.line.matrixWorldNeedsUpdate = true;
    const p = this.positionAt(s.e, c.ms, s.e.xyz)!;
    s.e.dist_pc = Math.hypot(...p);
    const rel: Vec3 = [p[0] - c.cam[0], p[1] - c.cam[1], p[2] - c.cam[2]];
    const dist = Math.hypot(...rel);
    const size = ((9 * c.dpr) / c.pxPerRad) * dist;
    s.marker.position.set(rel[0], rel[1], rel[2]);
    s.marker.scale.set(size, size, 1);
    s.uA.value = 0.45 * this.fade;
  }

  // ------------------------------------------------------------------ cards and views

  info(e: SolarEntry, ms: number, earth: Vec3): ExtraInfo {
    const r = e.solar as unknown as MinorRef;
    const [q, ecc, inc] = r.el;
    const H = r.el[6];
    const p = this.positionAt(e, ms)!;
    const rows: [string, string][] = [];
    const au = (pc: number) => pc / PC_PER_AU;
    const f = (x: number, d: number) => x.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
    rows.push([tr('facts.dist_sun'), `${f(au(Math.hypot(...p)), au(Math.hypot(...p)) < 10 ? 3 : 2)} ${tr('unit.au')}`]);
    rows.push([tr('facts.dist_earth'), `${f(au(Math.hypot(p[0] - earth[0], p[1] - earth[1], p[2] - earth[2])), 3)} ${tr('unit.au')}`]);
    const sub = this.meta?.subclasses[r.cls]?.[this.subclassOf(r)] ?? '';
    rows.push([tr('sb.class'), `${tr(`sb.class.${r.cls}`)}${sub ? ` (${sub})` : ''}`]);
    if (ecc < 1) rows.push([tr('sb.a'), `${f(q / (1 - ecc), 4)} ${tr('unit.au')}`]);
    rows.push([tr('sb.q'), `${f(q, 4)} ${tr('unit.au')}`], [tr('sb.e'), f(ecc, ecc > 0.99 ? 6 : 4)], [tr('sb.i'), `${f((inc * 180) / Math.PI, 2)}°`]);
    const P = periodDays(q, ecc);
    if (Number.isFinite(P)) rows.push([tr('facts.period_days'), P > 730 ? `${f(P / 365.25, P > 36525 ? 0 : 2)} ${tr('unit.years')}` : `${f(P, 1)} ${tr('unit.days')}`]);
    rows.push([tr(r.cls === 'comet' ? 'sb.M1' : 'sb.H'), f(H, 2)]);
    if (r.cls !== 'comet' && r.u !== undefined && r.u !== 15) rows.push([tr('sb.U'), r.u <= 9 ? String(r.u) : r.u === 10 ? 'E' : 'D/F']);
    if (r.opp) rows.push([tr('sb.arc'), `${r.arc} (${r.opp} ${tr('sb.oppositions')})`]);
    const iso = (jd: number) => new Date((jd - 2440587.5) * 86400000).toISOString().slice(0, 10);
    const ownEp = r.ep !== undefined && r.ep !== null ? this.refJd + r.ep : r.cls === 'comet' ? null : this.refJd;
    if (ownEp !== null) {
      const days = Math.round(jdTTFromMs(ms) - ownEp);
      rows.push([tr('sb.epoch'), `${iso(ownEp)} TT (${tr(days >= 0 ? 'sb.epoch.after' : 'sb.epoch.before', { n: Math.abs(days).toLocaleString('en-US') })})`]);
    }
    const file = this.meta?.sources?.['MPCORB.DAT.gz']?.file_time_utc?.slice(0, 10) ?? '';
    return {
      kind: r.dwarf ? tr('kind.dwarf_planet') : tr(r.cls === 'comet' ? 'kind.comet' : 'kind.asteroid'),
      title: e.name,
      rows,
      note: tr(r.cls === 'comet' ? 'sb.note.comet' : 'sb.note', { date: file }),
      docs: e.docs,
    };
  }

  private subclassOf(r: MinorRef): number {
    const k = this.classes.get(r.cls);
    if (k?.flags) return k.flags[r.idx] & 15;
    return 99;
  }

  viewFor(e: SolarEntry, ms: number): { focus: Vec3; dist: number; yaw: number; pitch: number } {
    const p = this.positionAt(e, ms)!;
    const rS = Math.hypot(...p);
    // from "above" the ecliptic and a little outside the orbit: the Sun stays in the frame
    const pole = eclToGal([0, 0, 1]);
    const out = [p[0] / rS, p[1] / rS, p[2] / rS];
    const d = [pole[0] * 0.8 + out[0] * 0.6, pole[1] * 0.8 + out[1] * 0.6, pole[2] * 0.8 + out[2] * 0.6];
    const n = Math.hypot(...d);
    return { focus: p, dist: Math.max(0.02 * PC_PER_AU, rS * 0.9), yaw: Math.atan2(d[1], d[0]), pitch: Math.asin(d[2] / n) };
  }
}
