/**
 * DOM labels for named objects (catalogues + Milky Way model), decluttered on a screen grid.
 *
 * A label is shown when the object is in front of the camera, on screen, and either
 *   - it would be reasonably bright as seen from the camera (apparent mag below a limit), or
 *   - it lies within a few focus-distances of the camera (you are "at its scale").
 * Candidates are placed brightest first; one that overlaps an already placed label is skipped.
 * Star names are set in roman, galaxies in italic and model features in the model colour,
 * following star-atlas convention.
 */

import * as THREE from 'three/webgpu';
import type { Vec3 } from '../math/frames';

export interface LabelItem {
  name: string;
  xyz: Vec3;
  kind: string;
  /** absolute magnitude if known */
  absMag: number | null;
  /** min / max camera-focus distance at which the label may appear (pc) */
  minScale?: number;
  maxScale?: number;
  onClick?: () => void;
}

const MAX_LABELS = 28;

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

export class LabelLayer {
  private items: LabelItem[] = [];
  private pool: HTMLButtonElement[] = [];
  private v = new THREE.Vector3();
  modelOpacity = 1;
  enabled = true;

  constructor(private root: HTMLElement) {}

  setItems(items: LabelItem[]) {
    this.items = items;
  }

  private el(i: number): HTMLButtonElement {
    let e = this.pool[i];
    if (!e) {
      e = document.createElement('button');
      e.type = 'button';
      e.className = 'label';
      e.tabIndex = -1;
      this.root.appendChild(e);
      this.pool[i] = e;
    }
    return e;
  }

  update(camera: THREE.PerspectiveCamera, camPos: Vec3, focusDist: number, width: number, height: number, occluders: DOMRect[] = []) {
    type C = { it: LabelItem; x: number; y: number; rank: number };
    const cands: C[] = [];
    if (this.enabled) {
      for (const it of this.items) {
        if (it.kind === 'model' && this.modelOpacity < 0.15) continue;
        const win = SCALE_WINDOWS[it.kind] ?? [2e4, 2e8];
        if (focusDist < (it.minScale ?? win[0])) continue;
        if (focusDist > (it.maxScale ?? win[1])) continue;
        const dx = it.xyz[0] - camPos[0];
        const dy = it.xyz[1] - camPos[1];
        const dz = it.xyz[2] - camPos[2];
        const r = Math.hypot(dx, dy, dz);
        if (r < focusDist * 1e-3) continue; // we are sitting on it
        if (it.kind !== 'model' && r > focusDist * (it.kind.includes('galaxy') ? 100 : 300)) continue; // far beyond the current scale
        this.v.set(dx, dy, dz).project(camera);
        if (this.v.z > 1 || this.v.z < -1) continue;
        const x = (this.v.x * 0.5 + 0.5) * width;
        const y = (-this.v.y * 0.5 + 0.5) * height;
        if (x < -20 || x > width + 20 || y < -10 || y > height + 10) continue;
        const app = it.absMag !== null ? it.absMag + 5 * Math.log10(Math.max(r, 1e-9) / 10) : null;
        const near = r < focusDist * 3;
        const bright = app !== null && app < (it.kind.includes('galaxy') ? 11 : 4.5);
        const isModel = it.kind === 'model';
        if (!near && !bright && !isModel) continue;
        // rank: lower is more important
        // model features are the context at their scale, so they go first
        const rank = isModel ? -20 : app !== null ? app - (near ? 6 : 0) : near ? 0 : 8;
        cands.push({ it, x, y, rank });
      }
    }
    cands.sort((a, b) => a.rank - b.rank);
    // UI panels count as already-placed boxes, so labels never sit underneath them
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = occluders.map((r) => ({ x0: r.left, x1: r.right, y0: r.top, y1: r.bottom }));
    let n = 0;
    for (const c of cands) {
      if (n >= Math.min(MAX_LABELS, Math.round((width * height) / 26000))) break;
      const w = c.it.name.length * 7.2 + 16;
      const box = { x0: c.x + 6, x1: c.x + 6 + w, y0: c.y - 9, y1: c.y + 9 };
      if (placed.some((p) => box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0)) continue;
      placed.push(box);
      const e = this.el(n++);
      if (e.textContent !== c.it.name) e.textContent = c.it.name;
      e.dataset.kind = c.it.kind.includes('galaxy') ? 'galaxy' : c.it.kind === 'model' ? 'model' : 'star';
      e.style.transform = `translate(${c.x.toFixed(1)}px, ${c.y.toFixed(1)}px)`;
      e.style.opacity = c.it.kind === 'model' ? String(Math.min(1, this.modelOpacity)) : '';
      e.hidden = false;
      e.onclick = c.it.onClick ?? null;
    }
    for (let i = n; i < this.pool.length; i++) this.pool[i].hidden = true;
  }
}
