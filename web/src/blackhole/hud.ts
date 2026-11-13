/**
 * Black hole HUD (what a hovering observer would measure) and the Flamm embedding-grid overlay.
 * Pure DOM/SVG; nothing here touches the renderer.
 */

import type { Vec3 } from '../math/frames';
import { fmtSig } from '../objects/facts';
import type { BlackHole } from './catalog';
import { C, G0, escapeFraction, hoverAccel, tidalAccel, timeDilation } from './physics';
import { tr } from './strings';

export type Quality = 'low' | 'medium' | 'high';
export const QUALITY_STEPS: Record<Quality, number> = { low: 48, medium: 96, high: 160 };
/** spaghettification warning threshold (m/s^2 across 2 m) */
export const SPAGHETTI_G = 10;

const fmt = (v: number, sig = 3) => fmtSig(v, sig);

function clockFace(cls: string): string {
  let ticks = '';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * 2 * Math.PI;
    const r0 = i % 3 === 0 ? 15 : 17;
    ticks += `M${(20 + r0 * Math.sin(a)).toFixed(2)},${(20 - r0 * Math.cos(a)).toFixed(2)}L${(20 + 19 * Math.sin(a)).toFixed(2)},${(20 - 19 * Math.cos(a)).toFixed(2)}`;
  }
  return `<svg class="bh-dial ${cls}" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="19.2"/><path class="tk" d="${ticks}"/>` +
    `<path class="mn" d="M20,20L20,9"/><path class="sc" d="M20,23L20,4"/><circle class="hub" cx="20" cy="20" r="1.6"/></svg>`;
}

export interface HudState {
  hole: BlackHole;
  /** camera distance from the hole, r_s */
  x: number;
  diskOn: boolean;
  flammOn: boolean;
  quality: Quality;
  atFloor: boolean;
  lensSupported: boolean;
}

export class BlackHoleHud {
  readonly el: HTMLElement;
  onDisk: (on: boolean) => void = () => {};
  onFlamm: (on: boolean) => void = () => {};
  onQuality: (q: Quality) => void = () => {};
  private tYou = 0;
  private tFar = 0;
  private holeName = '';
  private q = <T extends Element>(s: string) => this.el.querySelector(s) as T;

  constructor() {
    const el = document.createElement('aside');
    el.className = 'panel bh-hud';
    el.hidden = true;
    el.setAttribute('aria-live', 'off');
    el.innerHTML = `
      <p class="kind bh-mass"></p>
      <h2 class="bh-title"></h2>
      <dl class="rows bh-rows">
        <dt class="l-dist"></dt><dd class="v-dist"></dd>
        <dt class="l-esc"></dt><dd class="v-esc"></dd>
        <dt class="l-tid"></dt><dd class="v-tid"></dd>
        <dt class="l-hov"></dt><dd class="v-hov"></dd>
      </dl>
      <p class="bh-warn" role="alert" hidden></p>
      <div class="bh-clocks">
        <figure>${clockFace('you')}<figcaption><b class="t-you"></b><span class="c-you"></span></figcaption></figure>
        <figure>${clockFace('far')}<figcaption><b class="t-far"></b><span class="c-far"></span></figcaption></figure>
      </div>
      <p class="fine bh-ratio"></p>
      <p class="bh-floor" role="status" hidden></p>
      <div class="bh-ctl">
        <label class="check"><input type="checkbox" class="cb-disk" /> <span class="l-disk"></span></label>
        <label class="check"><input type="checkbox" class="cb-flamm" /> <span class="l-flamm"></span></label>
        <label class="bh-q"><span class="l-q"></span>
          <select class="sel-q"><option value="low"></option><option value="medium"></option><option value="high"></option></select></label>
      </div>
      <p class="bh-webgl" hidden></p>
      <details class="bh-about"><summary></summary><p class="fine bh-note"></p></details>`;
    this.el = el;
    this.q<HTMLInputElement>('.cb-disk').addEventListener('change', (e) => this.onDisk((e.target as HTMLInputElement).checked));
    this.q<HTMLInputElement>('.cb-flamm').addEventListener('change', (e) => this.onFlamm((e.target as HTMLInputElement).checked));
    this.q<HTMLSelectElement>('.sel-q').addEventListener('change', (e) => this.onQuality((e.target as HTMLSelectElement).value as Quality));
    this.q('.l-dist').textContent = tr('bh.hud.dist');
    this.q('.l-esc').textContent = tr('bh.hud.escape');
    this.q('.l-tid').textContent = tr('bh.hud.tidal');
    this.q('.l-hov').textContent = tr('bh.hud.hover');
    this.q('.c-you').textContent = tr('bh.hud.clock.you');
    this.q('.c-far').textContent = tr('bh.hud.clock.far');
    this.q('.l-disk').textContent = tr('bh.hud.disk');
    this.q('.l-flamm').textContent = tr('bh.hud.flamm');
    this.q('.l-q').textContent = tr('bh.hud.quality');
    this.q('.bh-about summary').textContent = tr('bh.hud.about');
    this.q('.bh-webgl').textContent = tr('bh.hud.webgl');
    const opts = this.q<HTMLSelectElement>('.sel-q').options;
    for (const o of Array.from(opts)) o.textContent = `${tr(`bh.q.${o.value}`)} (${QUALITY_STEPS[o.value as Quality]})`;
  }

  hide() {
    if (!this.el.hidden) this.el.hidden = true;
    document.body.classList.remove('bh-near');
  }

  /** per-frame: clocks tick with wall time dt (s); text refreshes are cheap enough to do every frame */
  update(s: HudState, dt: number, extraNote: string) {
    const h = s.hole;
    if (h.name !== this.holeName) {
      this.holeName = h.name;
      this.tYou = 0;
      this.tFar = 0;
    }
    if (this.el.hidden) {
      // the HUD sits where the layers panel's lower half is: fold that panel once on arrival
      document.getElementById('layers-toggle')?.setAttribute('aria-expanded', 'false');
      this.el.hidden = false;
    }
    document.body.classList.add('bh-near');
    const x = Math.max(1, s.x);
    const dil = timeDilation(x);
    this.tYou += dt;
    this.tFar += dt / Math.max(dil, 1e-9);
    const rM = x * h.rsM;
    const rsKm = h.rsM / 1e3;
    this.q('.bh-title').textContent = tr('bh.hud.title', { name: h.name });
    this.q('.bh-mass').textContent = tr('bh.hud.mass', { mass: fmt(h.massMsun, 4), rs: `${fmt(rsKm, 4)} km` }) + (h.massApprox ? ' *' : '');
    this.q('.v-dist').textContent = tr('bh.hud.dist.val', { x: x.toFixed(x < 10 ? 2 : x < 1000 ? 1 : 0), km: `${fmt(rM / 1e3, 4)} km` });
    const ef = escapeFraction(x);
    this.q('.v-esc').textContent = tr('bh.hud.escape.val', { f: ef.toFixed(4), kms: fmt((ef * C) / 1e3, 4) });
    const tid = tidalAccel(h.rsM, rM, 2);
    this.q('.v-tid').textContent = tr('bh.hud.tidal.val', { a: fmt(tid), g: fmt(tid / G0) });
    this.q('.v-hov').textContent = tr('bh.hud.hover.val', { g: fmt(hoverAccel(h.rsM, rM) / G0) });
    const warn = this.q<HTMLElement>('.bh-warn');
    const spag = tid / G0 > SPAGHETTI_G;
    warn.hidden = !spag;
    if (spag) warn.textContent = tr('bh.hud.spaghetti', { g: fmt(tid / G0) });
    this.q('.v-tid').classList.toggle('danger', spag);
    // clocks: second hands sweep; the minute hand turns once an hour
    const hand = (cls: string, t: number) => {
      this.q<SVGPathElement>(`.bh-dial.${cls} .sc`).setAttribute('transform', `rotate(${((t % 60) * 6).toFixed(2)} 20 20)`);
      this.q<SVGPathElement>(`.bh-dial.${cls} .mn`).setAttribute('transform', `rotate(${(((t / 60) % 60) * 6).toFixed(2)} 20 20)`);
    };
    hand('you', this.tYou);
    hand('far', this.tFar);
    const clock = (t: number) => `${Math.floor(t / 60).toString().padStart(2, '0')}:${(t % 60).toFixed(1).padStart(4, '0')}`;
    this.q('.t-you').textContent = clock(this.tYou);
    this.q('.t-far').textContent = clock(this.tFar);
    this.q('.bh-ratio').textContent = tr('bh.hud.clock.ratio', { k: (1 / dil).toPrecision(dil > 0.999 ? 7 : 4) });
    const fl = this.q<HTMLElement>('.bh-floor');
    fl.hidden = !s.atFloor;
    if (s.atFloor) fl.textContent = tr('bh.hud.floor');
    const cbD = this.q<HTMLInputElement>('.cb-disk');
    if (cbD.checked !== s.diskOn) cbD.checked = s.diskOn;
    const cbF = this.q<HTMLInputElement>('.cb-flamm');
    if (cbF.checked !== s.flammOn) cbF.checked = s.flammOn;
    const sel = this.q<HTMLSelectElement>('.sel-q');
    if (sel.value !== s.quality) sel.value = s.quality;
    const note = [tr('bh.hud.static'), extraNote, h.massApprox ? `* ${tr('bh.mass.approx')}` : ''].filter(Boolean).join(' ');
    const n = this.q('.bh-note');
    if (n.textContent !== note) n.textContent = note;
    const wg = this.q<HTMLElement>('.bh-webgl');
    if (wg.hidden !== s.lensSupported) wg.hidden = s.lensSupported;
  }
}

/**
 * Flamm's paraboloid: the equatorial plane of the Schwarzschild geometry embedded in flat 3D,
 * z(r) = 2 sqrt(r_s (r − r_s)) (Flamm 1916). Radial distances measured along the surface are the
 * true proper distances. Drawn as an SVG overlay (unlensed, it is a diagram), rim in the disk
 * plane at R_MAX, throat at the horizon r = r_s, 2 sqrt(R_MAX − 1) r_s below.
 */
export class FlammOverlay {
  readonly el: SVGSVGElement;
  private readonly path: SVGPathElement;
  private readonly throat: SVGPathElement;
  private readonly label: SVGTextElement;
  static readonly RINGS = [1, 1.25, 1.5, 2, 3, 4, 6, 8, 11, 15, 20];
  static readonly SPOKES = 24;
  static readonly R_MAX = 20;

  constructor() {
    const ns = 'http://www.w3.org/2000/svg';
    this.el = document.createElementNS(ns, 'svg') as SVGSVGElement;
    this.el.setAttribute('class', 'bh-flamm');
    this.el.setAttribute('aria-hidden', 'true');
    this.path = document.createElementNS(ns, 'path') as SVGPathElement;
    this.throat = document.createElementNS(ns, 'path') as SVGPathElement;
    this.throat.setAttribute('class', 'throat');
    this.label = document.createElementNS(ns, 'text') as SVGTextElement;
    this.el.append(this.path, this.throat, this.label);
    this.el.style.display = 'none';
  }

  hide() {
    this.el.style.display = 'none';
  }

  /**
   * camRel: camera minus hole (pc, float64); n: grid axis; project(rel) maps a camera-relative
   * point (pc) to CSS px or null when behind the camera.
   */
  draw(h: BlackHole, camRel: Vec3, n: Vec3, up: Vec3, opacity: number, project: (rel: Vec3) => { x: number; y: number } | null) {
    if (opacity < 0.01) {
      this.hide();
      return;
    }
    this.el.style.display = 'block';
    this.el.style.opacity = opacity.toFixed(3);
    // basis in the plane
    const a: Vec3 = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    let p: Vec3 = [a[1] * n[2] - a[2] * n[1], a[2] * n[0] - a[0] * n[2], a[0] * n[1] - a[1] * n[0]];
    const pl = Math.hypot(...p);
    p = [p[0] / pl, p[1] / pl, p[2] / pl];
    const q: Vec3 = [n[1] * p[2] - n[2] * p[1], n[2] * p[0] - n[0] * p[2], n[0] * p[1] - n[1] * p[0]];
    const rs = h.rsPc;
    const zMax = 2 * Math.sqrt(FlammOverlay.R_MAX - 1);
    // the throat hangs below the rim on screen (screen up = camera up), so it reads as a well
    const side = up[0] * n[0] + up[1] * n[1] + up[2] * n[2] >= 0 ? 1 : -1;
    const pt = (r: number, ang: number) => {
      const depth = side * (zMax - 2 * Math.sqrt(Math.max(0, r - 1))) * rs;
      const c = Math.cos(ang) * r * rs;
      const s = Math.sin(ang) * r * rs;
      const w: Vec3 = [c * p[0] + s * q[0] - depth * n[0] - camRel[0], c * p[1] + s * q[1] - depth * n[1] - camRel[1], c * p[2] + s * q[2] - depth * n[2] - camRel[2]];
      return project(w);
    };
    let d = '';
    const seg = (pts: ({ x: number; y: number } | null)[]) => {
      let pen = false;
      for (const P of pts) {
        if (!P || !Number.isFinite(P.x) || Math.abs(P.x) > 1e5 || Math.abs(P.y) > 1e5) {
          pen = false;
          continue;
        }
        d += `${pen ? 'L' : 'M'}${P.x.toFixed(1)},${P.y.toFixed(1)}`;
        pen = true;
      }
    };
    const N = 96;
    let throat = '';
    for (const r of FlammOverlay.RINGS) {
      const pts = [];
      for (let i = 0; i <= N; i++) pts.push(pt(r, (i / N) * 2 * Math.PI));
      if (r === 1) {
        const save = d;
        d = '';
        seg(pts);
        throat = d;
        d = save;
      } else seg(pts);
    }
    const rr: number[] = [];
    for (let i = 0; i <= 60; i++) rr.push(1 + (FlammOverlay.R_MAX - 1) * (i / 60) ** 2);
    for (let k = 0; k < FlammOverlay.SPOKES; k++) {
      const ang = (k / FlammOverlay.SPOKES) * 2 * Math.PI;
      seg(rr.map((r) => pt(r, ang)));
    }
    this.path.setAttribute('d', d);
    this.throat.setAttribute('d', throat);
    const L = pt(FlammOverlay.R_MAX, Math.PI * 1.5);
    if (L) {
      this.label.setAttribute('x', L.x.toFixed(1));
      this.label.setAttribute('y', (L.y + 16).toFixed(1));
      this.label.textContent = tr('bh.flamm.label');
      this.label.style.display = '';
    } else this.label.style.display = 'none';
  }
}
