/**
 * DOM labels for named objects (catalogues + Milky Way model).
 *
 * A label is a candidate when the object is in front of the camera, on screen, inside its kind's
 * scale window, and either bright as seen from the camera or near it. Candidates are ranked and
 * accepted greedily when their MEASURED text box, padded by 8 px, overlaps no accepted box and no
 * UI panel. Labels fade in and out over 300 ms (smoothstep envelope), so declutter changes never
 * pop (both after skymap's label director, MIT, re-implemented).
 *
 * Declutter on top of the box test (selectLabels, pure and unit-tested):
 *   - the "You are here" pin is placed first and always shown;
 *   - model / context labels (Milky Way arms, the bar, whole-galaxy labels) go before catalogue
 *     labels at their scale, even before catalogue labels already on screen;
 *   - per-kind caps per view (pulsars 4, SNRs 5, nebulae 5, ...), scaled with the viewport;
 *   - a minimum distance to every accepted label that grows as the label's importance falls
 *     (0 px for context labels, up to 96 px for an anonymous faint pulsar);
 *   - same-kind candidates left out near each other become one "12 pulsars" badge; clicking it
 *     flies in (onCluster), and zooming in spreads the members out so they label themselves.
 * Solar System labels (Sun, planets, moons, probes) keep the plain box rule: no caps, spacing or badges.
 * Star names are roman, galaxies italic, model features in the model colour (star-atlas convention).
 */

import * as THREE from 'three/webgpu';
import type { Vec3 } from '../math/frames';
import { baseKind, kindColor, kindInfo } from '../objects/kinds';

export interface LabelItem {
  name: string;
  xyz: Vec3;
  kind: string;
  /** absolute magnitude if known */
  absMag: number | null;
  minScale?: number;
  maxScale?: number;
  /** physical radius (pc) of an extended object; its label hides when the object is under a pixel */
  sizePc?: number;
  onClick?: () => void;
  /** temporarily skipped (e.g. a planet's label while the camera is down at its surface) */
  hidden?: boolean;
  /** has a common name or its own article (Crab Pulsar, Geminga, Sgr A*): ranks above anonymous entries */
  notable?: boolean;
  /** context label (whole Milky Way, model features): goes before catalogue labels at its scale */
  context?: boolean;
}

const MAX_LABELS = 28;
const PAD = 8;
const FADE_S = 0.3;

/** kinds that keep the plain box rule (no caps, spacing or badges); 'here' is the Show me pin */
export const SOLAR_KINDS = new Set(['sun', 'planet', 'dwarf_planet', 'moon', 'spacecraft', 'here']);

/** labels per kind family in one view (at 1440 x 900; scaled with sqrt of the viewport area) */
export const KIND_CAPS: Record<string, number> = {
  pulsar: 4, snr: 5, nebula: 5, cluster: 5, exoplanet: 4, black_hole: 4, message: 3, seti_signal: 3, frb: 5, neutrino: 3, cmb: 1,
  star: 14, wd: 6, galaxy: 14, lg_galaxy: 10, qso: 6,
};
/** base importance (0..1) per family before brightness / notability */
const BASE_IMPORTANCE: Record<string, number> = {
  pulsar: 0.15, exoplanet: 0.2, snr: 0.3, nebula: 0.3, message: 0.3, seti_signal: 0.3, cluster: 0.35, qso: 0.35,
  wd: 0.35, star: 0.45, galaxy: 0.45, lg_galaxy: 0.5, black_hole: 0.55, frb: 0.35, neutrino: 0.6, cmb: 1,
};
/** minimum distance (px) between label anchors at importance 0; falls linearly to 0 at importance 1 */
export const SPACING_MAX_PX = 96;
/** candidates left out within this radius (px) of a same-family seed join its badge */
export const CLUSTER_RADIUS_PX = 130;
export const MIN_CLUSTER = 4;
const MAX_BADGES = 6;

/** camera-focus distances (pc) at which each kind of object is 'at scale' and may be labelled;
 *  kinds not listed here use the window of their kinds.ts entry, then the galaxy default */
export const SCALE_WINDOWS: Record<string, [number, number]> = {
  star: [0, 3000],
  wd: [0, 1000],
  cluster: [1, 5000],
  bh: [10, 3e5],
  lg_galaxy: [500, 5e6],
  galaxy: [2e4, 2e8],
  qso: [1e6, 1e10],
};

export function scaleWindow(kind: string): [number, number] {
  const fixed = SCALE_WINDOWS[kind];
  if (fixed) return fixed;
  const k = kindInfo(kind);
  return k.minScale !== undefined || k.maxScale !== undefined ? [k.minScale ?? 0, k.maxScale ?? Infinity] : [2e4, 2e8];
}

/** kind family for caps and badges: registry kind ('open_cluster' → 'cluster', 'bh' → 'black_hole') */
export function labelFamily(kind: string): string {
  return baseKind(kind);
}

/** catalogue designations (PSR J0534+2200, NGC 6960, G1.9+0.3, SGR 1806-20, NP 0532) are not common names */
const DESIGNATION = /^(PSR|SNR|NGC|IC|UGC|PGC|HIP|HD|HR|Gaia|2MASS|SGR|NP|LMC|SMC|W|Sh ?2|RCW|CTB|HB|Kes|MSH|[JBG])[\s-]?[\d+.-]/i;

/** an entry worth labelling before anonymous ones: its own article, a Messier number, or a common-name alias */
export function isNotable(e: { name: string; alt?: string[]; docs?: string; messier?: unknown }): boolean {
  if (e.docs || e.messier) return true;
  return [e.name, ...(e.alt ?? [])].some((n) => !DESIGNATION.test(n.trim()) && /[A-Za-zÀ-ɏЀ-ӿ]{4,}/.test(n) && !/^\S*\d/.test(n.trim()));
}

/** importance 0..1 of a label: decides its spacing; the pin, Solar System and context labels are 1 */
export function labelImportance(it: Pick<LabelItem, 'kind' | 'notable' | 'context'>, app: number | null): number {
  if (SOLAR_KINDS.has(it.kind) || it.kind === 'model' || it.context) return 1;
  const fam = labelFamily(it.kind);
  let imp = BASE_IMPORTANCE[fam] ?? 0.3;
  if (app !== null) imp += Math.min(0.4, Math.max(0, ((fam.includes('galaxy') ? 11 : 4.5) - app) / 8));
  if (it.notable) imp += 0.35;
  return Math.min(1, imp);
}

export function spacingPx(importance: number): number {
  return SPACING_MAX_PX * (1 - Math.min(1, Math.max(0, importance)));
}

export interface LabelCand {
  it: LabelItem;
  x: number;
  y: number;
  /** lower = more important (apparent magnitude based, as before) */
  rank: number;
  importance: number;
  /** measured text width (px, including the marker); else SelectOptions.widthOf is asked */
  w?: number;
  /** currently shown (alpha > 0.5): wins ties so the layout stays stable while moving */
  shown: boolean;
}

export interface Box { x0: number; x1: number; y0: number; y1: number }

export interface ClusterBadge {
  /** stable identity across frames: family + the seed (best-ranked member) */
  key: string;
  family: string;
  kind: string;
  x: number;
  y: number;
  members: LabelItem[];
}

export interface SelectOptions {
  width: number;
  height: number;
  occluders: Box[];
  /** text width of a badge for `n` members of `family` (px) */
  badgeWidth?: (family: string, n: number) => number;
  /** text width of a label (px); only called for candidates that pass the cheaper rules */
  widthOf?: (it: LabelItem) => number;
  cluster?: boolean;
}

const overlaps = (b: Box, list: Box[]) => list.some((p) => b.x0 < p.x1 && b.x1 > p.x0 && b.y0 < p.y1 && b.y1 > p.y0);
const boxAt = (x: number, y: number, w: number): Box => ({ x0: x - PAD, x1: x + w + PAD, y0: y - 9 - PAD, y1: y + 9 + PAD });

/**
 * Which candidates get a label and which left-out groups get a badge. Pure (no DOM), so the rules
 * are unit-tested (test/labels.test.ts).
 */
export function selectLabels(cands: LabelCand[], o: SelectOptions): { accepted: Set<LabelItem>; badges: ClusterBadge[] } {
  const byRank = [...cands].sort((a, b) => a.rank - b.rank);
  const isPin = (c: LabelCand) => c.it.kind === 'here';
  const isContext = (c: LabelCand) => c.it.kind === 'model' || !!c.it.context;
  const order = [
    ...byRank.filter(isPin),
    ...byRank.filter((c) => isContext(c) && !isPin(c)),
    ...byRank.filter((c) => c.shown),
    ...byRank,
  ];
  const boxes = [...o.occluders];
  const anchors: { x: number; y: number }[] = [];
  const accepted = new Set<LabelItem>();
  const famCount = new Map<string, number>();
  const capScale = Math.min(1.4, Math.max(0.6, Math.sqrt((o.width * o.height) / (1440 * 900))));
  const limit = Math.min(MAX_LABELS, Math.round((o.width * o.height) / 26000));
  const left: LabelCand[] = [];
  const seen = new Set<LabelItem>();
  for (const c of order) {
    if (accepted.has(c.it) || seen.has(c.it)) continue;
    seen.add(c.it);
    const width = () => c.w ?? (c.w = o.widthOf ? o.widthOf(c.it) : 8 * c.it.name.length + 12);
    if (isPin(c)) {
      const box = boxAt(c.x, c.y, width());
      // the pin always wins: no limit, no overlap test; everything else steers around it
      boxes.push(box);
      anchors.push(c);
      accepted.add(c.it);
      continue;
    }
    const plain = SOLAR_KINDS.has(c.it.kind);
    if (accepted.size >= limit) {
      if (!plain) left.push(c);
      continue;
    }
    // cheap rules first (cap, spacing), so text widths are only measured for real contenders
    const fam = labelFamily(c.it.kind);
    const capped = !plain && !isContext(c);
    if (capped) {
      const cap = Math.max(1, Math.round((KIND_CAPS[fam] ?? 6) * capScale));
      const sp = spacingPx(c.importance);
      if ((famCount.get(fam) ?? 0) >= cap || anchors.some((a) => Math.hypot(a.x - c.x, a.y - c.y) < sp)) {
        left.push(c);
        continue;
      }
    }
    const box = boxAt(c.x, c.y, width());
    if (overlaps(box, boxes)) {
      if (!plain) left.push(c);
      continue;
    }
    if (capped) famCount.set(fam, (famCount.get(fam) ?? 0) + 1);
    boxes.push(box);
    anchors.push(c);
    accepted.add(c.it);
  }
  const badges: ClusterBadge[] = [];
  if (o.cluster === false) return { accepted, badges };
  // greedy seeds by rank; a grid of CLUSTER_RADIUS_PX cells keeps the neighbour search linear
  const R = CLUSTER_RADIUS_PX;
  const pool = left.filter((c) => !isContext(c)).sort((a, b) => a.rank - b.rank);
  const grid = new Map<string, LabelCand[]>();
  const cell = (x: number, y: number, fam: string) => `${fam}|${Math.floor(x / R)}|${Math.floor(y / R)}`;
  for (const c of pool) {
    const k = cell(c.x, c.y, labelFamily(c.it.kind));
    const g = grid.get(k);
    if (g) g.push(c);
    else grid.set(k, [c]);
  }
  const used = new Set<LabelItem>();
  for (const seed of pool) {
    if (badges.length >= MAX_BADGES) break;
    if (used.has(seed.it)) continue;
    const fam = labelFamily(seed.it.kind);
    const cx = Math.floor(seed.x / R);
    const cy = Math.floor(seed.y / R);
    const members: LabelCand[] = [];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      for (const c of grid.get(`${fam}|${cx + i}|${cy + j}`) ?? []) {
        if (!used.has(c.it) && Math.hypot(c.x - seed.x, c.y - seed.y) <= R) members.push(c);
      }
    }
    if (members.length < MIN_CLUSTER) continue;
    const w = o.badgeWidth ? o.badgeWidth(fam, members.length) : 90;
    // at the seed, else at the members' centroid, else a label row below / above the seed
    const mx = members.reduce((t, m) => t + m.x, 0) / members.length;
    const my = members.reduce((t, m) => t + m.y, 0) / members.length;
    const spot = [[seed.x, seed.y], [mx, my], [seed.x, seed.y + 36], [seed.x, seed.y - 36]]
      .find(([x, y]) => !overlaps(boxAt(x, y, w), boxes));
    if (!spot) continue;
    boxes.push(boxAt(spot[0], spot[1], w));
    for (const m of members) used.add(m.it);
    badges.push({ key: `${fam}:${seed.it.name}`, family: fam, kind: seed.it.kind, x: spot[0], y: spot[1], members: members.map((m) => m.it) });
  }
  return { accepted, badges };
}

interface State {
  el: HTMLButtonElement;
  alpha: number;
  w: number;
  item: LabelItem;
}

interface BadgeState {
  el: HTMLButtonElement;
  alpha: number;
  n: number;
  b: ClusterBadge;
}

export class LabelLayer {
  private items: LabelItem[] = [];
  private states = new Map<LabelItem, State>();
  private badgeStates = new Map<string, BadgeState>();
  private v = new THREE.Vector3();
  private measure: HTMLSpanElement | null = null;
  private widthCache = new Map<string, number>();
  modelOpacity = 1;
  enabled = true;
  /** same-kind groups of left-out labels become "12 pulsars" badges */
  clustering = true;
  /** true while any label is mid-fade */
  animating = false;
  /** a badge was clicked: fly in on its members (set by the app) */
  onCluster: (members: LabelItem[]) => void = () => {};
  /** badge text for n members of a family (set by the app, in the current language) */
  clusterText: (family: string, n: number) => string = (f, n) => `${n} ${f}`;
  clusterHint: (text: string) => string = (s) => s;

  constructor(private root: HTMLElement) {}

  setItems(items: LabelItem[]) {
    for (const s of this.states.values()) s.el.remove();
    this.states.clear();
    for (const s of this.badgeStates.values()) s.el.remove();
    this.badgeStates.clear();
    this.widthCache.clear();
    this.items = items;
  }

  private state(it: LabelItem): State {
    let s = this.states.get(it);
    if (!s) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'label';
      el.tabIndex = -1;
      el.textContent = it.name;
      el.dataset.kind = it.kind.includes('galaxy') ? 'galaxy' : it.kind === 'model' ? 'model' : it.kind === 'gw_event' ? 'volume' : 'star';
      // marker ring and text tint in the kind colour (kinds.ts); the model keeps its own style
      if (it.kind !== 'model') {
        el.style.setProperty('--kc', kindColor(it.kind));
        el.classList.add('kc');
      }
      el.style.opacity = '0';
      if (it.onClick) el.onclick = it.onClick;
      this.root.appendChild(el);
      s = { el, alpha: 0, w: el.offsetWidth + 12, item: it };
      this.states.set(it, s);
    }
    return s;
  }

  /** width of a badge text, measured once per string with a hidden badge-styled element */
  private badgeWidth = (family: string, n: number): number => {
    const text = this.clusterText(family, n);
    let w = this.widthCache.get(text);
    if (w === undefined) {
      if (!this.measure) {
        this.measure = document.createElement('span');
        this.measure.className = 'label cluster';
        this.measure.style.visibility = 'hidden';
        this.root.appendChild(this.measure);
      }
      this.measure.textContent = text;
      w = this.measure.offsetWidth + 4;
      this.widthCache.set(text, w);
    }
    return w;
  };

  update(camera: THREE.PerspectiveCamera, camPos: Vec3, focusDist: number, width: number, height: number, occluders: DOMRect[], dt: number) {
    const pxPerRadCss = height / 2 / Math.tan((camera.fov * Math.PI) / 360);
    const cands: LabelCand[] = [];
    if (this.enabled) {
      for (const it of this.items) {
        if (it.hidden) continue;
        if (it.kind === 'model' && this.modelOpacity < 0.15) continue;
        const win = scaleWindow(it.kind);
        if (focusDist < (it.minScale ?? win[0]) || focusDist > (it.maxScale ?? win[1])) continue;
        const dx = it.xyz[0] - camPos[0];
        const dy = it.xyz[1] - camPos[1];
        const dz = it.xyz[2] - camPos[2];
        const r = Math.hypot(dx, dy, dz);
        if (r < focusDist * 1e-3) continue; // we are sitting on it
        // an extended object smaller than a pixel is not "at scale": its label would sit on unrelated points
        if (it.sizePc !== undefined && ((2 * it.sizePc) / r) * pxPerRadCss < 1) continue;
        if (it.kind !== 'model' && r > focusDist * (it.kind.includes('galaxy') ? 100 : 300)) continue;
        // behind-the-camera test in view space: with a tiny near plane the NDC z of a point behind
        // the camera rounds to exactly 1 and would pass an NDC test
        this.v.set(dx, dy, dz).applyMatrix4(camera.matrixWorldInverse);
        if (this.v.z >= 0) continue;
        this.v.applyMatrix4(camera.projectionMatrix);
        // no NDC-depth test: the near plane is clamped to >= 1e-6 pc (three r186 log depth), so at
        // Earth-Moon scales every label would sit "in front of" it; behind-camera is handled above
        const x = (this.v.x * 0.5 + 0.5) * width;
        const y = (-this.v.y * 0.5 + 0.5) * height;
        if (x < -20 || x > width + 20 || y < -10 || y > height + 10) continue;
        const app = it.absMag !== null ? it.absMag + 5 * Math.log10(Math.max(r, 1e-9) / 10) : null;
        const near = r < focusDist * 3;
        const bright = app !== null && app < (it.kind.includes('galaxy') ? 11 : 4.5);
        const isModel = it.kind === 'model';
        if (!near && !bright && !isModel) continue;
        // model features are the context at their scale, so they go first; notable entries before anonymous ones
        const rank = (isModel ? -20 : app !== null ? app - (near ? 6 : 0) : near ? 0 : 8) - (it.notable ? 4 : 0);
        const s = this.states.get(it);
        cands.push({ it, x, y, rank, importance: labelImportance(it, app), w: s?.w, shown: (s?.alpha ?? 0) > 0.5 });
      }
    }
    const pos = new Map<LabelItem, LabelCand>();
    for (const c of cands) pos.set(c.it, c);
    const { accepted, badges } = selectLabels(cands, {
      width, height, occluders: occluders.map((r) => ({ x0: r.left, x1: r.right, y0: r.top, y1: r.bottom })),
      badgeWidth: this.badgeWidth, widthOf: (it) => this.state(it).w, cluster: this.clustering,
    });
    const step = dt / FADE_S;
    let animating = false;
    for (const [it, s] of this.states) {
      const c = pos.get(it);
      const target = accepted.has(it) ? 1 : 0;
      s.alpha = c ? (s.alpha < target ? Math.min(target, s.alpha + step) : Math.max(target, s.alpha - step)) : 0;
      if (s.alpha !== target && c) animating = true;
      if (s.alpha <= 0) {
        if (s.el.style.opacity !== '0') s.el.style.opacity = '0';
        s.el.style.visibility = 'hidden';
        if (!c && this.states.size > 400) {
          s.el.remove();
          this.states.delete(it);
        }
        continue;
      }
      const e = s.alpha * s.alpha * (3 - 2 * s.alpha);
      s.el.style.visibility = 'visible';
      s.el.style.opacity = String(e * (it.kind === 'model' ? Math.min(1, this.modelOpacity) : 1));
      s.el.style.transform = `translate(${c!.x.toFixed(1)}px, ${c!.y.toFixed(1)}px)`;
    }
    if (this.updateBadges(badges, step)) animating = true;
    this.animating = animating;
  }

  private updateBadges(badges: ClusterBadge[], step: number): boolean {
    let animating = false;
    const live = new Map(badges.map((b) => [b.key, b]));
    for (const b of badges) {
      let s = this.badgeStates.get(b.key);
      if (!s) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'label cluster kc';
        el.tabIndex = -1;
        el.dataset.kind = b.family.includes('galaxy') ? 'galaxy' : 'star';
        el.dataset.k = b.family;
        el.style.setProperty('--kc', kindColor(b.kind));
        el.style.opacity = '0';
        this.root.appendChild(el);
        s = { el, alpha: 0, n: 0, b };
        const st = s;
        el.onclick = () => this.onCluster(st.b.members);
        this.badgeStates.set(b.key, s);
      }
      s.b = b;
      if (s.n !== b.members.length) {
        s.n = b.members.length;
        s.el.textContent = this.clusterText(b.family, s.n);
        s.el.title = this.clusterHint(s.el.textContent);
        s.el.setAttribute('aria-label', s.el.title);
      }
    }
    for (const [key, s] of this.badgeStates) {
      const b = live.get(key);
      s.alpha = b ? Math.min(1, s.alpha + step) : Math.max(0, s.alpha - step);
      if ((b && s.alpha < 1) || (!b && s.alpha > 0)) animating = true;
      if (s.alpha <= 0) {
        s.el.remove();
        this.badgeStates.delete(key);
        continue;
      }
      const e = s.alpha * s.alpha * (3 - 2 * s.alpha);
      s.el.style.visibility = 'visible';
      s.el.style.opacity = String(e);
      s.el.style.transform = `translate(${s.b.x.toFixed(1)}px, ${s.b.y.toFixed(1)}px)`;
    }
    return animating;
  }
}
