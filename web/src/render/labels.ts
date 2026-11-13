/**
 * DOM labels for named objects (catalogues + Milky Way model).
 *
 * A label is a candidate when the object is in front of the camera, on screen, inside its kind's
 * scale window, and either bright as seen from the camera or near it. Candidates are ranked and
 * accepted greedily when their MEASURED text box, padded by 8 px, overlaps no accepted box and no
 * UI panel. Labels fade in and out over 300 ms (smoothstep envelope), so declutter changes never
 * pop (both after skymap's label director, MIT, re-implemented).
 * Star names are roman, galaxies italic, model features in the model colour (star-atlas convention).
 */

import * as THREE from 'three/webgpu';
import type { Vec3 } from '../math/frames';

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
}

const MAX_LABELS = 28;
const PAD = 8;
const FADE_S = 0.3;

/** camera-focus distances (pc) at which each kind of object is 'at scale' and may be labelled */
export const SCALE_WINDOWS: Record<string, [number, number]> = {
  star: [0, 3000],
  wd: [0, 1000],
  cluster: [1, 5000],
  bh: [10, 3e5],
  lg_galaxy: [500, 5e6],
  galaxy: [2e4, 2e8],
  qso: [1e6, 1e10],
};

interface State {
  el: HTMLButtonElement;
  alpha: number;
  w: number;
  item: LabelItem;
}

export class LabelLayer {
  private items: LabelItem[] = [];
  private states = new Map<LabelItem, State>();
  private v = new THREE.Vector3();
  modelOpacity = 1;
  enabled = true;
  /** true while any label is mid-fade */
  animating = false;

  constructor(private root: HTMLElement) {}

  setItems(items: LabelItem[]) {
    for (const s of this.states.values()) s.el.remove();
    this.states.clear();
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
      el.dataset.kind = it.kind.includes('galaxy') ? 'galaxy' : it.kind === 'model' ? 'model' : 'star';
      el.style.opacity = '0';
      if (it.onClick) el.onclick = it.onClick;
      this.root.appendChild(el);
      s = { el, alpha: 0, w: el.offsetWidth + 12, item: it };
      this.states.set(it, s);
    }
    return s;
  }

  update(camera: THREE.PerspectiveCamera, camPos: Vec3, focusDist: number, width: number, height: number, occluders: DOMRect[], dt: number) {
    const pxPerRadCss = height / 2 / Math.tan((camera.fov * Math.PI) / 360);
    type C = { it: LabelItem; x: number; y: number; rank: number };
    const cands: C[] = [];
    if (this.enabled) {
      for (const it of this.items) {
        if (it.kind === 'model' && this.modelOpacity < 0.15) continue;
        const win = SCALE_WINDOWS[it.kind] ?? [2e4, 2e8];
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
        if (this.v.z > 1 || this.v.z < -1) continue;
        const x = (this.v.x * 0.5 + 0.5) * width;
        const y = (-this.v.y * 0.5 + 0.5) * height;
        if (x < -20 || x > width + 20 || y < -10 || y > height + 10) continue;
        const app = it.absMag !== null ? it.absMag + 5 * Math.log10(Math.max(r, 1e-9) / 10) : null;
        const near = r < focusDist * 3;
        const bright = app !== null && app < (it.kind.includes('galaxy') ? 11 : 4.5);
        const isModel = it.kind === 'model';
        if (!near && !bright && !isModel) continue;
        // model features are the context at their scale, so they go first
        const rank = isModel ? -20 : app !== null ? app - (near ? 6 : 0) : near ? 0 : 8;
        cands.push({ it, x, y, rank });
      }
    }
    cands.sort((a, b) => a.rank - b.rank);
    // currently visible labels win ties, which keeps the layout stable while moving
    const pos = new Map<LabelItem, C>();
    for (const c of cands) pos.set(c.it, c);
    const boxes = occluders.map((r) => ({ x0: r.left, x1: r.right, y0: r.top, y1: r.bottom }));
    const accepted = new Set<LabelItem>();
    const limit = Math.min(MAX_LABELS, Math.round((width * height) / 26000));
    const order = [...cands.filter((c) => (this.states.get(c.it)?.alpha ?? 0) > 0.5), ...cands];
    for (const c of order) {
      if (accepted.size >= limit) break;
      if (accepted.has(c.it)) continue;
      const w = this.state(c.it).w;
      const box = { x0: c.x - PAD, x1: c.x + w + PAD, y0: c.y - 9 - PAD, y1: c.y + 9 + PAD };
      if (boxes.some((p) => box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0)) continue;
      boxes.push(box);
      accepted.add(c.it);
    }
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
    this.animating = animating;
  }
}
