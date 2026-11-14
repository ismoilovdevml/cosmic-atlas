/**
 * Earth satellites: the CelesTrak GP snapshot (data/tiles/satellites/, scripts/build_satellites.py)
 * propagated with SGP4 (satellite.js) at the time in the time bar, and JWST from its Horizons track.
 *
 * SGP4 for all ~17,000 objects costs ~12 ms on the CPU (measured, Node 24, M4 Pro), too much for
 * every frame. So each frame refreshes REFRESH_PER_FRAME of them: their SGP4 state (TEME) becomes
 * osculating two-body elements, and the GPU (orbitpoints.ts, the same Kepler shader as the
 * asteroids) carries every satellite forward from its last state. At x1 each object is refreshed
 * about every 0.2 s; two-body drifts 0.1 m in 2 s and ~2 km in 10 min from SGP4 (ISS, measured in
 * test/satellites.test.ts), so at high time speeds the shell is right statistically, not per object.
 * The labelled objects (ISS, CSS, Hubble) run SGP4 on the CPU every frame.
 *
 * Shown only within ~0.03 AU of Earth (JWST is 1.2-1.75 million km out).
 */

import * as THREE from 'three/webgpu';
import { Fn, clamp, dot, exp, float, uniform, uv, vec3 } from 'three/tsl';
import type { Vec3 } from '../math/frames';
import { PC_PER_AU } from '../math/units';
import { srgbToLinear } from '../render/brightness';
import type { LabelItem } from '../render/labels';
import { KM_PER_AU } from './bodies';
import type { ExtraCtx, ExtraInfo, ExtraLayerConfig, SolarExtra } from './extra';
import { MU_EARTH, conicPosition, elementsFromState } from './kepler';
import type { SolarEntry } from './layer';
import { makeOrbitPoints, orbitUniforms, setFrameMatrix, type OrbitPoints } from './orbitpoints';
import { SATELLITE_JS_VERSION, mat3Apply, parseGp, sgp4Teme, temeToGal, type GpSnapshot, type SatRecord } from './sgp4frame';
import { interpolateTrack, type CraftTrack } from './spacecraft';
import { tr } from './strings';

const PC_PER_KM = PC_PER_AU / KM_PER_AU;
const EARTH_R_KM = 6371.0;
/** visible within FADE_AU[0] of Earth, gone beyond FADE_AU[1] */
export const SAT_FADE_AU: [number, number] = [0.015, 0.03];
const LOAD_WITHIN_AU = 0.08;
const REFRESH_PER_FRAME = 1500;
/** re-base the float32 time origin of the GPU elements after this many seconds */
const REBASE_S = 1e5;
/** group colours: stations, Starlink, other active, (failed SGP4 = black, i.e. invisible when added) */
const GROUP_COLORS = ['#ffd27a', '#9cc7ff', '#e8e8e8', '#000000'];
const GROUP_H = [3, 7, 6, 99];
export const SAT_NAMED: { norad: number; name: string; alt: string[] }[] = [
  { norad: 25544, name: 'ISS', alt: ['International Space Station', 'ISS (ZARYA)', 'Zarya', 'МКС', 'XKS'] },
  { norad: 48274, name: 'CSS (Tiangong)', alt: ['Tiangong', 'CSS (TIANHE)', 'Tianhe', 'Китайская космическая станция', 'Тяньгун'] },
  { norad: 20580, name: 'Hubble', alt: ['HST', 'Hubble Space Telescope', 'Хаббл'] },
];
const JWST_NAME = 'JWST';

/** what a satellite entry points at (SolarEntry.solar for type 'sat'); norad -170 = JWST */
export interface SatRef {
  type: 'sat';
  norad: number;
  /** index in the snapshot (unset for JWST / before load) */
  idx?: number;
}

const lin = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return new THREE.Vector3(srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255));
};
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class Satellites implements SolarExtra {
  readonly group = new THREE.Group();
  readonly entries: SolarEntry[] = [];
  readonly labelItems: LabelItem[] = [];
  visible: boolean;
  opacity = 1;
  readonly ready = Promise.resolve();
  sats: SatRecord[] = [];
  snapshotUtc = '';
  private base: string;
  private state: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
  private pts: OrbitPoints | null = null;
  private elA = new Float32Array(0);
  private elB = new Float32Array(0);
  private T0 = NaN;
  private cursor = 0;
  private jwst: CraftTrack | null = null;
  private jwstSprite: THREE.Sprite;
  private jwstA = uniform(0);
  private m = new THREE.Matrix4();
  private rot: number[] = new Array(9);
  private named = new Map<number, SolarEntry>();
  fade = 0;
  private dirty = false;
  /** set by layer.ts: open the info card */
  onSelect: (e: SolarEntry) => void = () => {};

  constructor(readonly cfg: ExtraLayerConfig) {
    this.visible = cfg.visible;
    this.base = cfg.path.endsWith('/') ? cfg.path : `${cfg.path}/`;
    this.group.name = 'satellites';
    for (const s of [...SAT_NAMED, { norad: -170, name: JWST_NAME, alt: ['James Webb Space Telescope', 'Webb', 'Джеймс Уэбб'] }]) {
      const xyz: Vec3 = [0, 0, 0];
      const e: SolarEntry = {
        name: s.name, alt: s.alt, kind: 'satellite', dist_pc: 0, xyz, docs: 'satellite',
        ref: s.norad === -170 ? 'JPL Horizons (-170)' : 'CelesTrak GP elements; SGP4 (satellite.js)',
        solar: { type: 'sat', norad: s.norad } as unknown as SolarEntry['solar'],
      };
      this.entries.push(e);
      this.named.set(s.norad, e);
      this.labelItems.push({ name: s.name, xyz, kind: 'satellite', absMag: -40, minScale: 0, maxScale: 2e-7, sizePc: 0, onClick: () => this.onSelect(e) });
    }
    const c = lin('#f2e6c9');
    const smat = new THREE.SpriteNodeMaterial({ transparent: true, depthTest: true, depthWrite: false, blending: THREE.AdditiveBlending });
    smat.colorNode = Fn(() => {
      const p = uv().mul(2.0).sub(1.0);
      const r2 = dot(p, p);
      return vec3(c.x, c.y, c.z).mul(exp(r2.mul(-5.0)).mul(clamp(float(1.0).sub(r2), 0.0, 1.0))).mul(this.jwstA).mul(1.6);
    })();
    smat.opacityNode = float(1.0);
    this.jwstSprite = new THREE.Sprite(smat);
    this.jwstSprite.renderOrder = 15;
    this.jwstSprite.frustumCulled = false;
    this.jwstSprite.visible = false;
    this.group.add(this.jwstSprite);
  }

  metaText(): string {
    return this.state === 'ready'
      ? tr('sat.layer.meta', { n: this.sats.length.toLocaleString('en-US'), t: this.snapshotUtc.slice(0, 16).replace('T', ' ') })
      : tr('sat.layer.metaIdle');
  }

  private async load() {
    this.state = 'loading';
    try {
      const [gp, meta, jw] = await Promise.all([
        fetch(`${this.base}gp.json`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`gp.json HTTP ${r.status}`)))),
        fetch(`${this.base}meta.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch(`${this.base}jwst.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      this.sats = parseGp(gp as GpSnapshot);
      this.snapshotUtc = meta?.snapshot_utc ?? '';
      if (jw?.track) this.jwst = jw.track as CraftTrack;
      const n = this.sats.length;
      this.elA = new Float32Array(n * 4);
      this.elB = new Float32Array(n * 4);
      this.sats.forEach((s, i) => {
        const e = this.named.get(s.norad);
        if (e) (e.solar as unknown as SatRef).idx = i;
      });
      const U = orbitUniforms(lin('#ffffff'), MU_EARTH);
      U.hBright.value = 6;
      U.floor.value = 0.45;
      U.sizeMin.value = 1.6;
      U.sizeMax.value = 3.2;
      this.pts = makeOrbitPoints({ count: n, elA: this.elA, elB: this.elB, uniforms: U, conics: false, tagColors: GROUP_COLORS.map(lin), name: 'satellites' });
      this.group.add(this.pts.mesh);
      this.T0 = NaN;
      this.state = 'ready';
      this.dirty = true;
    } catch (e) {
      this.state = 'error';
      console.warn(`[satellites] not available (${(e as Error).message})`);
    }
  }

  /** SGP4 -> osculating elements for satellites [from, to) at `ms`, written for the GPU */
  private refresh(from: number, to: number, ms: number) {
    const tRel = (ms - this.T0) / 1000;
    const el = [0, 0, 0, 0, 0, 0];
    for (let i = from; i < to; i++) {
      const s = this.sats[i];
      const st = sgp4Teme(s.rec, ms);
      const k = i * 4;
      if (!st) {
        this.elA.set([6378, 0, 0, 0], k);
        this.elB.set([0, 0, 99, 3], k);
        continue;
      }
      elementsFromState(st.r, st.v, MU_EARTH, el);
      if (!(el[1] < 1)) el[1] = 0.999;
      this.elA[k] = el[0];
      this.elA[k + 1] = el[1];
      this.elA[k + 2] = el[2];
      this.elA[k + 3] = el[3];
      this.elB[k] = el[4];
      this.elB[k + 1] = el[5] + tRel;
      this.elB[k + 2] = GROUP_H[s.group] ?? 6;
      this.elB[k + 3] = s.group;
    }
    const a = this.pts!.geometry.getAttribute('elA') as THREE.InstancedBufferAttribute;
    const b = this.pts!.geometry.getAttribute('elB') as THREE.InstancedBufferAttribute;
    for (const at of [a, b]) {
      at.addUpdateRange(from * 4, (to - from) * 4);
      at.needsUpdate = true;
    }
  }

  positionAt(e: SolarEntry, ms: number, out: Vec3 = [0, 0, 0], earth?: Vec3): Vec3 | null {
    const r = e.solar as unknown as SatRef;
    if (r.type !== 'sat') return null;
    const E = earth ?? this.earthAt?.(ms) ?? [0, 0, 0];
    if (r.norad === -170) {
      if (!this.jwst) return null;
      const p = interpolateTrack(this.jwst, jdTdb(ms));
      if (!p) return null;
      for (let k = 0; k < 3; k++) out[k] = E[k] + p.pos[k];
      return out;
    }
    const s = r.idx !== undefined ? this.sats[r.idx] : undefined;
    if (!s) return null;
    const st = sgp4Teme(s.rec, ms);
    if (!st) return null;
    const g = mat3Apply(temeToGal(ms, this.rot), st.r);
    for (let k = 0; k < 3; k++) out[k] = E[k] + g[k] * PC_PER_KM;
    return out;
  }

  /** set by layer.ts: the Earth's heliocentric position (pc) at a time */
  earthAt: ((ms: number) => Vec3) | null = null;

  update(c: ExtraCtx): boolean {
    const dE = Math.hypot(c.cam[0] - c.earth[0], c.cam[1] - c.earth[1], c.cam[2] - c.earth[2]) / PC_PER_AU;
    const fade = this.visible ? this.opacity * c.fade * (1 - smooth(SAT_FADE_AU[0], SAT_FADE_AU[1], dE)) : 0;
    const changed = Math.abs(fade - this.fade) > 1e-4;
    this.fade = fade;
    this.group.visible = fade > 0.002;
    if (this.visible && this.state === 'idle' && dE < LOAD_WITHIN_AU && c.fade > 0) void this.load();
    if (this.state !== 'ready' || !this.pts) return changed;
    // labelled objects: their own SGP4 every frame (also keeps search distances live)
    for (const e of this.entries) {
      const p = this.positionAt(e, c.ms, e.xyz, c.earth);
      e.dist_pc = p ? Math.hypot(...p) : 0;
      const li = this.labelItems.find((l) => l.xyz === e.xyz);
      if (li) {
        li.hidden = !p || !this.group.visible;
        // hide the label when the object sits within ~10 px of Earth's centre (as for moons)
        li.sizePc = p ? Math.hypot(p[0] - c.earth[0], p[1] - c.earth[1], p[2] - c.earth[2]) / 20 : 0;
      }
    }
    if (!this.group.visible) return changed;
    const n = this.sats.length;
    if (!(Math.abs(c.ms - this.T0) < REBASE_S * 1000)) {
      this.T0 = c.ms;
      this.refresh(0, n, c.ms);
      this.dirty = true;
      this.cursor = 0;
    } else if (c.timeChanged) {
      const a = this.cursor;
      const b = Math.min(n, a + REFRESH_PER_FRAME);
      this.refresh(a, b, c.ms);
      this.cursor = b >= n ? 0 : b;
    }
    const U = this.pts.uniforms;
    U.dt.value = (c.ms - this.T0) / 1000;
    U.focus.value = c.focusDist * 1e9;
    U.gain.value = 0.9 * fade;
    setFrameMatrix(this.m, temeToGal(c.ms, this.rot), PC_PER_KM, [c.earth[0] - c.cam[0], c.earth[1] - c.cam[1], c.earth[2] - c.cam[2]]);
    this.pts.mesh.matrix.copy(this.m);
    this.pts.mesh.matrixWorldNeedsUpdate = true;
    // JWST: a sprite at its Horizons position
    const jw = this.named.get(-170)!;
    if (this.jwst && jw.dist_pc > 0) {
      const rel: Vec3 = [jw.xyz[0] - c.cam[0], jw.xyz[1] - c.cam[1], jw.xyz[2] - c.cam[2]];
      const dist = Math.hypot(...rel);
      const size = ((5 * c.dpr) / c.pxPerRad) * dist;
      this.jwstSprite.position.set(rel[0], rel[1], rel[2]);
      this.jwstSprite.scale.set(size, size, 1);
      this.jwstA.value = fade;
      this.jwstSprite.visible = true;
    } else this.jwstSprite.visible = false;
    const d = this.dirty;
    this.dirty = false;
    return changed || d;
  }

  pickAt(x: number, y: number, c: ExtraCtx): { e: SolarEntry; d: number } | null {
    if (!this.group.visible || this.state !== 'ready') return null;
    const v = new THREE.Vector3();
    const proj = (p: Vec3) => {
      v.set(p[0] - c.cam[0], p[1] - c.cam[1], p[2] - c.cam[2]).applyMatrix4(c.camera.matrixWorldInverse);
      if (v.z >= 0) return null;
      v.applyMatrix4(c.camera.projectionMatrix);
      return Math.hypot((v.x * 0.5 + 0.5) * c.width - x, (-v.y * 0.5 + 0.5) * c.height - y);
    };
    let best: { i: number; d: number } | null = null;
    const R = 7;
    const rot = temeToGal(c.ms, this.rot);
    const dt = (c.ms - this.T0) / 1000;
    const el = [0, 0, 0, 0, 0, 0];
    const t: Vec3 = [0, 0, 0];
    const g: Vec3 = [0, 0, 0];
    for (let i = 0; i < this.sats.length; i++) {
      if (this.elB[i * 4 + 3] > 2.5) continue;
      for (let k = 0; k < 4; k++) el[k] = this.elA[i * 4 + k];
      el[4] = this.elB[i * 4];
      el[5] = this.elB[i * 4 + 1];
      conicPosition(el, dt, MU_EARTH, t);
      mat3Apply(rot, t, g);
      const d = proj([c.earth[0] + g[0] * PC_PER_KM, c.earth[1] + g[1] * PC_PER_KM, c.earth[2] + g[2] * PC_PER_KM]);
      if (d !== null && d <= R && (!best || d < best.d)) best = { i, d };
    }
    const jw = this.named.get(-170)!;
    if (this.jwstSprite.visible) {
      const d = proj(jw.xyz);
      if (d !== null && d <= R && (!best || d < best.d)) return { e: jw, d };
    }
    if (!best) return null;
    return { e: this.entryFor(best.i, c), d: best.d };
  }

  private entryFor(i: number, c: ExtraCtx): SolarEntry {
    const s = this.sats[i];
    const named = this.named.get(s.norad);
    if (named) return named;
    const e: SolarEntry = {
      name: s.name, alt: [s.intl, `NORAD ${s.norad}`], kind: 'satellite', dist_pc: 0, xyz: [0, 0, 0], docs: 'satellite',
      ref: 'CelesTrak GP elements; SGP4 (satellite.js)', solar: { type: 'sat', norad: s.norad, idx: i } as unknown as SolarEntry['solar'],
    };
    this.positionAt(e, c.ms, e.xyz, c.earth);
    e.dist_pc = Math.hypot(...e.xyz);
    return e;
  }

  select() {}

  info(e: SolarEntry, ms: number, earth: Vec3): ExtraInfo {
    const r = e.solar as unknown as SatRef;
    const rows: [string, string][] = [];
    const p = this.positionAt(e, ms, [0, 0, 0], earth);
    const f = (x: number, d: number) => x.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
    const geoKm = p ? Math.hypot(p[0] - earth[0], p[1] - earth[1], p[2] - earth[2]) / PC_PER_KM : NaN;
    if (r.norad === -170) {
      if (p) rows.push([tr('sat.fromEarth'), `${f(geoKm, 0)} ${tr('unit.km')}`]);
      rows.push([tr('facts.launch'), '2021-12-25']);
      const span = this.jwst ? [this.jwst.t0_jd_tdb, this.jwst.t0_jd_tdb + (this.jwst.n - 1) * this.jwst.step_days] : null;
      const iso = (jd: number) => new Date((jd - 2440587.5) * 86400000).toISOString().slice(0, 10);
      return { kind: tr('kind.satellite'), title: e.name, rows, docs: e.docs,
        note: tr('sat.note.jwst', { span: span ? `${iso(span[0])} – ${iso(span[1])}` : 'n/a' }) + (p ? '' : ` ${tr('sat.outside')}`) };
    }
    const s = r.idx !== undefined ? this.sats[r.idx] : undefined;
    if (!s) return { kind: tr('kind.satellite'), title: e.name, rows, note: tr('sat.layer.metaIdle'), docs: e.docs };
    if (p) {
      rows.push([tr('sat.altitude'), `${f(geoKm - EARTH_R_KM, 0)} ${tr('unit.km')}`]);
      rows.push([tr('sat.fromEarth'), `${f(geoKm, 0)} ${tr('unit.km')}`]);
    }
    rows.push([tr('sat.period'), `${f(1440 / s.revPerDay, 1)} ${tr('unit.min')}`]);
    rows.push([tr('sb.i'), `${f(s.incDeg, 2)}°`], [tr('sb.e'), f(s.ecc, 5)]);
    rows.push([tr('sat.norad'), String(s.norad)], [tr('sat.cospar'), s.intl]);
    const ageH = (ms - s.epochMs) / 3600e3;
    const age = Math.abs(ageH) < 48 ? tr('sat.age.hours', { n: f(Math.abs(ageH), 1) }) : tr('sat.age.days', { n: f(Math.abs(ageH) / 24, 1) });
    rows.push([tr('sat.epoch'), `${new Date(s.epochMs).toISOString().slice(0, 16).replace('T', ' ')} UTC (${tr(ageH >= 0 ? 'sat.age.old' : 'sat.age.ahead', { age })})`]);
    rows.push([tr('sat.group'), tr(`sat.group.${s.group}`)]);
    return {
      kind: tr('kind.satellite'), title: e.name, rows, docs: e.docs,
      note: tr('sat.note', { version: SATELLITE_JS_VERSION, snap: this.snapshotUtc.slice(0, 16).replace('T', ' ') }) + (Math.abs(ageH) > 72 ? ` ${tr('sat.note.stale')}` : ''),
    };
  }

  viewFor(e: SolarEntry, ms: number, earth: Vec3): { focus: Vec3; dist: number; yaw: number; pitch: number } {
    const p = this.positionAt(e, ms, [0, 0, 0], earth) ?? [...earth] as Vec3;
    const g: Vec3 = [p[0] - earth[0], p[1] - earth[1], p[2] - earth[2]];
    const rg = Math.hypot(...g) || 1;
    const up = [g[0] / rg, g[1] / rg, g[2] / rg];
    // behind and above the object, looking down past it at the Earth's limb
    const side = [up[1], -up[0], 0];
    const sn = Math.hypot(...side) || 1;
    const d = [up[0] * 0.6 + (side[0] / sn) * 0.8, up[1] * 0.6 + (side[1] / sn) * 0.8, up[2] * 0.6];
    const n = Math.hypot(...d);
    const isJwst = (e.solar as unknown as SatRef).norad === -170;
    const dist = isJwst ? rg * 0.25 : Math.max(800, rg * 0.35) * PC_PER_KM;
    return { focus: p, dist, yaw: Math.atan2(d[1], d[0]), pitch: Math.asin(d[2] / n) };
  }
}

function jdTdb(ms: number): number {
  return ms / 86400000 + 2440587.5 + 69.184 / 86400;
}
