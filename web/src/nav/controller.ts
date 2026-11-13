/**
 * Orbit-around-focus navigation over ~17 decades of distance.
 *
 * State is float64: focus (pc), distance to focus (pc), yaw (azimuth about +z) and pitch.
 * The three.js camera always sits at the origin and only rotates; every object is placed
 * relative to `camPos()` (relative-to-eye rendering).
 *
 *   drag            orbit                 right-drag / shift-drag   pan
 *   wheel / pinch   zoom toward cursor    W A S D  fly, Q E down/up (speed ∝ distance)
 *   + / -           zoom                  arrows   orbit
 */

import * as THREE from 'three/webgpu';
import type { Vec3 } from '../math/frames';
import { easeInOut, makeZoomPath, pathDuration, type ZoomPath } from '../math/flyto';

export const MIN_DIST = 1e-11; // ~300 km: close enough to stand over a planet (Solar System layer)
export const MAX_DIST = 3e10;

export interface View {
  focus: Vec3;
  dist: number;
  yaw: number; // rad
  pitch: number; // rad
}

interface Flight {
  path: ZoomPath;
  from: View;
  to: View;
  t0: number;
  dur: number;
  resolve: (done: boolean) => void;
}

const PITCH_LIMIT = (89.9 * Math.PI) / 180;

function wrapAngle(a: number) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

export class NavController {
  view: View = { focus: [0, 0, 0], dist: 5, yaw: (-150 * Math.PI) / 180, pitch: (22 * Math.PI) / 180 };
  /** called on any user input (used to cancel the tour) */
  onUserInput: () => void = () => {};
  onChange: () => void = () => {};
  reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  private targetLogDist = Math.log(this.view.dist);
  private zoomAnchor: Vec3 | null = null;
  private keys = new Set<string>();
  private pointers = new Map<number, { x: number; y: number }>();
  private dragMode: 'orbit' | 'pan' | null = null;
  private pinch: { span: number; mid: { x: number; y: number } } | null = null;
  private flight: Flight | null = null;
  private downAt: { x: number; y: number; t: number } | null = null;
  /** the gesture's first pointer went down on a map label (its own click opens the label) */
  private downOnLabel = false;
  /** the last gesture that started on a label moved or pinched, so its click must not fire */
  private swallowClick = false;
  onClick: (x: number, y: number) => void = () => {};
  /** extra lower bound on the distance (pc), e.g. a followed planet's radius; 0 = none */
  distFloor = 0;
  onDoubleClick: (x: number, y: number) => void = () => {};

  constructor(private el: HTMLElement, private camera: THREE.PerspectiveCamera) {
    el.addEventListener('pointerdown', (e) => this.onPointerDown(e, false));
    // move/up on window: a gesture may start on a map label (no capture there), see addGestureSource
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('dblclick', (e) => this.onDoubleClick(e.clientX, e.clientY));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  get flying() {
    return this.flight !== null;
  }

  /** world-space offset direction from focus to camera */
  static dir(yaw: number, pitch: number): Vec3 {
    const cp = Math.cos(pitch);
    return [cp * Math.cos(yaw), cp * Math.sin(yaw), Math.sin(pitch)];
  }

  camPos(): Vec3 {
    const d = NavController.dir(this.view.yaw, this.view.pitch);
    const f = this.view.focus;
    return [f[0] + d[0] * this.view.dist, f[1] + d[1] * this.view.dist, f[2] + d[2] * this.view.dist];
  }

  /** camera basis: right, up, back (= dir) */
  basis(): { right: Vec3; up: Vec3; back: Vec3 } {
    const { yaw, pitch } = this.view;
    const back = NavController.dir(yaw, pitch);
    const right: Vec3 = [-Math.sin(yaw), Math.cos(yaw), 0];
    const up: Vec3 = [
      back[1] * right[2] - back[2] * right[1],
      back[2] * right[0] - back[0] * right[2],
      back[0] * right[1] - back[1] * right[0],
    ];
    return { right, up, back };
  }

  /** push the orientation into the three.js camera (which stays at the origin) */
  applyToCamera() {
    const { right, up, back } = this.basis();
    const m = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(...right),
      new THREE.Vector3(...up),
      new THREE.Vector3(...back),
    );
    this.camera.position.set(0, 0, 0);
    this.camera.quaternion.setFromRotationMatrix(m);
    this.camera.updateMatrixWorld(true);
  }

  setView(v: Partial<View>) {
    this.cancelFlight();
    this.distFloor = 0; // an explicit view wins; a followed body sets its floor again next frame
    Object.assign(this.view, v);
    this.view.dist = Math.min(MAX_DIST, Math.max(MIN_DIST, this.view.dist));
    this.view.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.view.pitch));
    this.targetLogDist = Math.log(this.view.dist);
    this.zoomAnchor = null;
    this.onChange();
  }

  /** Animated flight along the van Wijk-Nuij log-distance path. Resolves false if interrupted. */
  flyTo(to: Partial<View>, opts: { durationScale?: number } = {}): Promise<boolean> {
    this.cancelFlight();
    const from: View = { ...this.view, focus: [...this.view.focus] as Vec3 };
    const target: View = {
      focus: (to.focus ?? from.focus).slice() as Vec3,
      dist: Math.min(MAX_DIST, Math.max(MIN_DIST, to.dist ?? from.dist)),
      yaw: to.yaw ?? from.yaw,
      pitch: Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, to.pitch ?? from.pitch)),
    };
    const sep = Math.hypot(
      target.focus[0] - from.focus[0],
      target.focus[1] - from.focus[1],
      target.focus[2] - from.focus[2],
    );
    const path = makeZoomPath(from.dist, target.dist, sep);
    const rot = Math.abs(wrapAngle(target.yaw - from.yaw)) + Math.abs(target.pitch - from.pitch);
    const dur = Math.max(pathDuration(path.S, this.reducedMotion), this.reducedMotion ? 0 : rot * 0.6) *
      (opts.durationScale ?? 1);
    return new Promise((resolve) => {
      this.flight = { path, from, to: target, t0: performance.now(), dur: dur * 1000, resolve };
    });
  }

  cancelFlight() {
    if (this.flight) {
      const f = this.flight;
      this.flight = null;
      this.targetLogDist = Math.log(this.view.dist);
      f.resolve(false);
    }
  }

  /** per-frame integration; returns true if the view changed */
  update(dt: number): boolean {
    let changed = false;
    if (this.flight) {
      const f = this.flight;
      const raw = Math.min(1, (performance.now() - f.t0) / f.dur);
      const t = easeInOut(raw);
      const { pan, dist } = f.path.at(t);
      const v = this.view;
      for (let k = 0; k < 3; k++) v.focus[k] = f.from.focus[k] + (f.to.focus[k] - f.from.focus[k]) * pan;
      v.dist = dist;
      v.yaw = f.from.yaw + wrapAngle(f.to.yaw - f.from.yaw) * t;
      v.pitch = f.from.pitch + (f.to.pitch - f.from.pitch) * t;
      this.targetLogDist = Math.log(v.dist);
      if (raw >= 1) {
        this.flight = null;
        Object.assign(v, { ...f.to, focus: [...f.to.focus] });
        this.targetLogDist = Math.log(v.dist);
        f.resolve(true);
      }
      changed = true;
    }

    // smooth wheel zoom (exponential approach in log space), anchored at the cursor
    const cur = Math.log(this.view.dist);
    if (Math.abs(this.targetLogDist - cur) > 1e-4) {
      const next = cur + (this.targetLogDist - cur) * (1 - Math.exp(-dt * 14));
      const k = Math.exp(next - cur);
      if (this.zoomAnchor) {
        const P = this.zoomAnchor;
        const f = this.view.focus;
        for (let i = 0; i < 3; i++) f[i] = P[i] + (f[i] - P[i]) * k;
      }
      this.view.dist = Math.exp(next);
      changed = true;
    } else this.zoomAnchor = null;
    if (this.distFloor > 0 && this.view.dist < this.distFloor && !this.flight) {
      this.view.dist = this.distFloor;
      this.targetLogDist = Math.max(this.targetLogDist, Math.log(this.distFloor));
      changed = true;
    }

    // keyboard
    if (this.keys.size && !this.flight) {
      const { right, up, back } = this.basis();
      const fast = this.keys.has('shift') ? 4 : 1;
      const s = this.view.dist * 0.9 * dt * fast;
      const mv: Vec3 = [0, 0, 0];
      const add = (v: Vec3, k: number) => {
        mv[0] += v[0] * k;
        mv[1] += v[1] * k;
        mv[2] += v[2] * k;
      };
      if (this.keys.has('w')) add(back, -s);
      if (this.keys.has('s')) add(back, s);
      if (this.keys.has('a')) add(right, -s);
      if (this.keys.has('d')) add(right, s);
      if (this.keys.has('q')) add(up, -s);
      if (this.keys.has('e')) add(up, s);
      if (mv[0] || mv[1] || mv[2]) {
        for (let i = 0; i < 3; i++) this.view.focus[i] += mv[i];
        changed = true;
      }
      const rot = 1.4 * dt;
      if (this.keys.has('arrowleft')) (this.view.yaw -= rot), (changed = true);
      if (this.keys.has('arrowright')) (this.view.yaw += rot), (changed = true);
      if (this.keys.has('arrowup')) (this.view.pitch = Math.min(PITCH_LIMIT, this.view.pitch + rot)), (changed = true);
      if (this.keys.has('arrowdown')) (this.view.pitch = Math.max(-PITCH_LIMIT, this.view.pitch - rot)), (changed = true);
      if (this.keys.has('+') || this.keys.has('=')) this.zoomBy(Math.exp(-2.5 * dt));
      if (this.keys.has('-') || this.keys.has('_')) this.zoomBy(Math.exp(2.5 * dt));
    }
    if (changed) this.onChange();
    return changed;
  }

  /** multiply the target distance (smoothly applied) */
  zoomBy(factor: number, anchor: Vec3 | null = null) {
    this.targetLogDist = Math.min(Math.log(MAX_DIST), Math.max(Math.log(Math.max(MIN_DIST, this.distFloor)), this.targetLogDist + Math.log(factor)));
    this.zoomAnchor = anchor;
  }

  /** world point on the focus plane under a client pixel */
  pointOnFocusPlane(cx: number, cy: number): Vec3 {
    const r = this.el.getBoundingClientRect();
    const ndc = new THREE.Vector3(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1, 0.5);
    ndc.unproject(this.camera).normalize(); // camera at origin -> direction
    const { back } = this.basis();
    const denom = -(ndc.x * back[0] + ndc.y * back[1] + ndc.z * back[2]);
    const t = this.view.dist / Math.max(denom, 1e-6);
    const c = this.camPos();
    return [c[0] + ndc.x * t, c[1] + ndc.y * t, c[2] + ndc.z * t];
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.cancelFlight();
    this.onUserInput();
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    const k = Math.exp(Math.max(-3, Math.min(3, dy * 0.0022)));
    this.zoomBy(k, this.pointOnFocusPlane(e.clientX, e.clientY));
  };

  /**
   * Map labels sit over the canvas and cover much of it on a phone. A drag, or one finger of a
   * pinch, that lands on a label must still move the map, while a plain tap keeps opening the
   * label. Pointers that go down on `.label` elements inside `layer` join the gesture without
   * pointer capture (so the label still gets its click), and a click that ends a drag or pinch
   * is swallowed.
   */
  addGestureSource(layer: HTMLElement) {
    layer.addEventListener('pointerdown', (e) => {
      if ((e.target as Element | null)?.closest('.label')) this.onPointerDown(e, true);
    });
    layer.addEventListener('click', (e) => {
      if (!this.swallowClick) return;
      this.swallowClick = false;
      e.stopPropagation();
      e.preventDefault();
    }, { capture: true });
  }

  private onPointerDown = (e: PointerEvent, onLabel: boolean) => {
    if (!onLabel) this.el.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.cancelFlight();
    this.onUserInput();
    if (this.pointers.size === 1) {
      this.dragMode = e.button === 2 || e.shiftKey ? 'pan' : 'orbit';
      this.downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
      this.downOnLabel = onLabel;
      this.swallowClick = false;
    } else if (this.pointers.size === 2) {
      if (this.downOnLabel) this.swallowClick = true;
      this.dragMode = null;
      this.downAt = null;
      this.pinch = this.pinchState();
    }
  };

  private pinchState() {
    const [a, b] = [...this.pointers.values()];
    return { span: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  }

  private pan(dx: number, dy: number) {
    const { right, up } = this.basis();
    const h = this.el.clientHeight || 1;
    const s = (2 * this.view.dist * Math.tan((this.camera.fov * Math.PI) / 360)) / h;
    for (let i = 0; i < 3; i++) this.view.focus[i] += (-dx * right[i] + dy * up[i]) * s;
  }

  private onPointerMove = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (this.pointers.size === 2 && this.pinch) {
      const now = this.pinchState();
      if (now.span > 0 && this.pinch.span > 0) {
        const k = this.pinch.span / now.span;
        this.view.dist = Math.min(MAX_DIST, Math.max(MIN_DIST, this.distFloor, this.view.dist * k));
        this.targetLogDist = Math.log(this.view.dist);
      }
      this.pan(now.mid.x - this.pinch.mid.x, now.mid.y - this.pinch.mid.y);
      this.pinch = now;
      this.onChange();
      return;
    }
    if (this.dragMode === 'orbit') {
      this.view.yaw -= dx * 0.005;
      this.view.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.view.pitch + dy * 0.005));
      this.onChange();
    } else if (this.dragMode === 'pan') {
      this.pan(dx, dy);
      this.onChange();
    }
  };

  private onPointerUp = (e: PointerEvent) => {
    if (!this.pointers.delete(e.pointerId)) return;
    if (this.downAt && this.pointers.size === 0) {
      const moved = Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y);
      const tap = moved < 5 && performance.now() - this.downAt.t < 500 && e.type === 'pointerup';
      // a tap on a label is the label's own click; a drag that started on one must not open it
      if (this.downOnLabel) this.swallowClick = !tap;
      else if (tap) this.onClick(e.clientX, e.clientY);
    }
    if (this.pointers.size < 2) this.pinch = null;
    if (this.pointers.size === 0) {
      this.dragMode = null;
      this.downAt = null;
    }
  };

  private onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'q', 'e', '+', '=', '-', '_', 'shift', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(k)) {
      if (t && t.closest('[role="slider"]') && k.startsWith('arrow')) return;
      if (k.startsWith('arrow')) e.preventDefault();
      if (k !== 'shift') {
        this.cancelFlight();
        this.onUserInput();
      }
      this.keys.add(k);
    }
  };
}
