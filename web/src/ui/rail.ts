/**
 * The "powers of ten" rail: a logarithmic axis of camera distance from ~0.04 AU to ~30 Gpc.
 * The marker shows the current scale; click, drag or arrow keys set a new one.
 */

import { t } from '../i18n';
import { PC_PER_AU } from '../math/units';

export const RAIL_MIN = Math.log10(2e-7);
export const RAIL_MAX = Math.log10(3e10);

const TICKS: [number, string][] = [
  [Math.log10(PC_PER_AU), 'AU'],
  [0, 'pc'],
  [3, 'kpc'],
  [6, 'Mpc'],
  [9, 'Gpc'],
];

// object distances, placed where the view of that object roughly fits
const LANDMARKS: [number, string][] = [
  [Math.log10(100 * PC_PER_AU), 'rail.solarSystem'],
  [Math.log10(1.3), 'rail.proxima'],
  [Math.log10(3e4), 'rail.milkyWay'],
  [Math.log10(7.65e5), 'rail.andromeda'],
  [Math.log10(3e8), 'rail.cosmicWeb'],
  [Math.log10(1.43e10), 'rail.horizon'],
];

export class ScaleRail {
  onPick: (logD: number, commit: boolean) => void = () => {};
  private dragging = false;
  private value = 0;

  constructor(private el: HTMLElement, private ticks: HTMLElement, private mark: HTMLElement) {
    this.build();
    el.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      el.setPointerCapture(e.pointerId);
      this.onPick(this.fromX(e.clientX), false);
    });
    el.addEventListener('pointermove', (e) => {
      if (this.dragging) this.onPick(this.fromX(e.clientX), false);
    });
    const end = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      this.onPick(this.fromX(e.clientX), true);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 1 : 0.25;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') this.onPick(this.value + step, true);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') this.onPick(this.value - step, true);
      else if (e.key === 'Home') this.onPick(RAIL_MIN, true);
      else if (e.key === 'End') this.onPick(RAIL_MAX, true);
      else return;
      e.preventDefault();
    });
    new ResizeObserver(() => this.build()).observe(el);
  }

  private frac(v: number) {
    return (v - RAIL_MIN) / (RAIL_MAX - RAIL_MIN);
  }

  private fromX(x: number) {
    const r = this.el.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (x - r.left) / r.width));
    return RAIL_MIN + f * (RAIL_MAX - RAIL_MIN);
  }

  /** (re)draw ticks and landmarks; called again when the UI language changes */
  build() {
    this.ticks.textContent = '';
    for (let d = Math.ceil(RAIL_MIN); d <= RAIL_MAX; d++) {
      const tk = document.createElement('div');
      tk.className = 'tick' + (d % 3 === 0 ? ' major' : '');
      tk.style.left = `${this.frac(d) * 100}%`;
      this.ticks.appendChild(tk);
    }
    for (const [v, unit] of TICKS) {
      const label = `1\u00a0${t(`unit.${unit}`)}`;
      const tk = document.createElement('div');
      tk.className = 'tick major';
      tk.style.left = `${this.frac(v) * 100}%`;
      const l = document.createElement('span');
      l.className = 'tick-label';
      l.textContent = label;
      l.style.left = `${this.frac(v) * 100}%`;
      this.ticks.append(tk, l);
    }
    // landmarks, skipping any that would overlap the previous one at this width
    const w = this.el.clientWidth;
    let lastRight = -Infinity;
    for (const [v, key] of LANDMARKS) {
      const label = t(key);
      const x = this.frac(v) * w;
      const half = (label.length * 6.6) / 2 + 4;
      if (x - half < lastRight || x - half < -4 || x + half > w + 4) continue;
      lastRight = x + half;
      const l = document.createElement('span');
      l.className = 'landmark';
      l.textContent = label;
      l.style.left = `${x}px`;
      this.ticks.appendChild(l);
    }
  }

  set(logD: number, text: string) {
    this.value = logD;
    this.mark.style.left = `${this.frac(Math.min(RAIL_MAX, Math.max(RAIL_MIN, logD))) * 100}%`;
    this.el.setAttribute('aria-valuenow', logD.toFixed(2));
    this.el.setAttribute('aria-valuetext', text);
  }
}
