/**
 * Black holes up close: ray-traced Schwarzschild lensing, an optional thin accretion disk, a HUD
 * with what a hovering observer measures, Flamm's embedding grid, and a real-scale approach that
 * stops at 1.5 r_s.
 *
 * main.ts calls, per frame, update() (after the camera orientation is set; it may move the focus
 * to keep the camera outside 1.5 r_s) and then PostPass.render(..., feature.lensActive).
 * Only one hole lenses at a time: the one with the largest Einstein radius on screen, and only
 * while that radius exceeds LENS_MIN_PX device pixels.
 */

import './bh.css';
import * as THREE from 'three/webgpu';
import type { CatalogEntry } from '../data/manifest';
import type { Vec3 } from '../math/frames';
import { MIN_DIST, NavController, type View } from '../nav/controller';
import type { PostPass } from '../render/post';
import { blackbodyLum } from './blackbody';
import { blackHolesFrom, skyAxes, type BlackHole } from './catalog';
import { BlackHoleHud, FlammOverlay, QUALITY_STEPS, type Quality } from './hud';
import { LensShader } from './lens';
import { M_PER_PC, X_PHOTON, einsteinAngle } from './physics';
import { tr } from './strings';

export { tr as bhTr } from './strings';
export type { BlackHole } from './catalog';

/** run the lens pass while the Einstein radius (sources at infinity) exceeds this many device px */
export const LENS_MIN_PX = 2;
/** show the HUD within this many r_s */
const HUD_MAX_X = 1e5;
/** the camera stops here (r_s) */
export const FLOOR_X = X_PHOTON;

/**
 * The thin disk: outer radius (r_s), peak temperature (K), display level of a T_peak element, and
 * the exposure of everything else while the disk is on. A thin disk outshines the starlight behind
 * it by a large, model-dependent factor; we expose for the disk like a photograph of a bright
 * source (background x0.15) instead of letting both saturate.
 */
const DISK = { rOut: 12, tPeak: 6500, level: 0.35, bgExposure: 0.15 };

export interface BhFrame {
  nav: NavController;
  camera: THREE.PerspectiveCamera;
  pxPerRad: number;
  dt: number;
  width: number;
  height: number;
}

export class BlackHoleFeature {
  readonly lens = new LensShader();
  readonly hud = new BlackHoleHud();
  readonly flamm = new FlammOverlay();
  holes: BlackHole[] = [];
  /** the hole the lens follows this frame (null = lens off) */
  active: BlackHole | null = null;
  lensActive = false;
  /** camera minus active hole, pc (float64) and in r_s */
  camRel: Vec3 = [0, 0, 0];
  x = Infinity;
  quality: Quality = 'medium';
  flammOn = true;
  /** lensing on both backends (WebGL 2: the TSL shader compiled to GLSL, Low by default); ?bhlens=off disables it */
  lensSupported = true;
  backend: 'WebGPU' | 'WebGL2' = 'WebGPU';
  onChange: () => void = () => {};
  onFly: (v: Partial<View>) => Promise<boolean> = async () => false;
  private diskOn = new Map<string, boolean>();
  private infoBtn: HTMLButtonElement | null = null;
  private atFloor = false;
  private lastKey = '';
  private lastFrame: BhFrame | null = null;
  /** debug: false renders the plain pipeline even near a hole (baseline FPS) */
  lensEnabled = true;
  /**
   * Environment cube of the rendered scene, captured from the camera (= the hole, to a parallax of
   * < 1e-4 arcsec for anything beyond 1 pc) so that rays bent out of the frame still see the scene.
   */
  private cubeRT: THREE.CubeRenderTarget | null = null;
  private cubeCam: THREE.CubeCamera | null = null;
  private envFor = '';
  private envT = 0;
  /** environment re-capture interval (ms) */
  envEveryMs = 1000;
  static readonly ENV_SIZE = 256;

  attach(post: PostPass, backend: 'WebGPU' | 'WebGL2') {
    this.backend = backend;
    this.lensSupported = new URLSearchParams(location.search).get('bhlens') !== 'off';
    if (backend === 'WebGL2') this.quality = 'low';
    const q = new URLSearchParams(location.search).get('bhq');
    if (q === 'low' || q === 'medium' || q === 'high') this.quality = q;
    this.applyQuality();
    if (this.lensSupported) {
      this.cubeRT = new THREE.CubeRenderTarget(BlackHoleFeature.ENV_SIZE, { type: THREE.HalfFloatType, generateMipmaps: false });
      this.cubeCam = new THREE.CubeCamera(1e-10, 1e12, this.cubeRT);
      this.lens.setEnv(this.cubeRT.texture);
      post.enableLens((ctx) => this.lens.compose(ctx));
    }
    this.hud.onDisk = (on) => {
      if (this.active) this.diskOn.set(this.active.name, on);
      this.onChange();
    };
    this.hud.onFlamm = (on) => {
      this.flammOn = on;
      this.onChange();
    };
    this.hud.onQuality = (q) => this.setQuality(q);
    document.body.append(this.flamm.el, this.hud.el);
  }

  /**
   * Re-capture the environment cube when the lensing hole changes, and once a second while it lenses
   * (tiles stream in). setPx(pxPerRad, dpr) sets the point/Milky Way sprite scale for a render:
   * the cube faces are 90° wide, so their photometry needs pxPerRad = size/2 and dpr 1.
   */
  captureEnv(renderer: THREE.WebGPURenderer, scene: THREE.Scene, setPx: (pxPerRad: number, dpr: number) => void, restore: () => void) {
    if (!this.lensActive || !this.cubeCam || !this.active) return;
    const now = performance.now();
    if (this.envFor === this.active.name && now - this.envT < this.envEveryMs) return;
    this.envFor = this.active.name;
    this.envT = now;
    setPx(BlackHoleFeature.ENV_SIZE / 2, 1);
    this.cubeCam.position.set(0, 0, 0);
    this.cubeCam.update(renderer as unknown as THREE.Renderer, scene);
    restore();
  }

  /**
   * Quality = RK4 steps per turn of φ and trace resolution. On a high-density screen (DPR >= 1.5)
   * Low and Medium trace at half resolution (one ray per 2x2 device pixels, about one CSS pixel)
   * and the compose stage interpolates the deflection; High traces every device pixel.
   */
  private applyQuality() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.lens.setSteps(QUALITY_STEPS[this.quality]);
    this.lens.setScale(this.quality !== 'high' && dpr >= 1.5 ? 0.5 : 1);
  }

  setQuality(q: Quality) {
    this.quality = q;
    this.applyQuality();
    this.onChange();
  }

  setCatalog(entries: CatalogEntry[]) {
    this.holes = blackHolesFrom(entries);
  }

  find(name: string): BlackHole | null {
    const k = name.trim().toLowerCase();
    return this.holes.find((h) => h.name.toLowerCase() === k || (h.entry.alt ?? []).some((a) => a.toLowerCase() === k)) ?? null;
  }

  isDiskOn(h: BlackHole): boolean {
    return this.diskOn.get(h.name) ?? h.disk.defaultOn;
  }

  setDisk(name: string, on: boolean) {
    const h = this.find(name);
    if (h) this.diskOn.set(h.name, on);
    this.onChange();
  }

  /** camera minus hole (pc), without the cancellation of (focus + offset) − hole at 1e-12 pc scales */
  private relTo(h: BlackHole, nav: NavController): Vec3 {
    const v = nav.view;
    const d = [Math.cos(v.pitch) * Math.cos(v.yaw), Math.cos(v.pitch) * Math.sin(v.yaw), Math.sin(v.pitch)];
    return [0, 1, 2].map((k) => v.focus[k] - h.xyz[k] + d[k] * v.dist) as Vec3;
  }

  /** a view on the line of sight from Earth (the Sun) at x r_s, looking at the hole */
  viewFor(h: BlackHole, x: number, offsetDeg = 0): Partial<View> {
    const n = Math.hypot(...h.xyz);
    const s = h.xyz.map((c) => -c / n); // hole -> Sun
    return { focus: h.xyz.slice() as Vec3, dist: x * h.rsPc, yaw: Math.atan2(s[1], s[0]) + (offsetDeg * Math.PI) / 180, pitch: Math.asin(s[2]) };
  }

  /** "Experience it": fly to an Earth-side view (25 r_s with a disk, 40 r_s for a dormant hole) */
  experience(h: BlackHole, nav: NavController): Promise<boolean> {
    nav.minDist = Math.min(MIN_DIST, h.rsPc * FLOOR_X * 0.99);
    return this.onFly(this.viewFor(h, this.isDiskOn(h) ? 25 : 40));
  }

  /** info card: show the "Experience it" button for black holes */
  infoFor(title: string, actions: HTMLElement, nav: NavController) {
    const h = this.find(title);
    if (!this.infoBtn) {
      this.infoBtn = document.createElement('button');
      this.infoBtn.type = 'button';
      this.infoBtn.className = 'btn bh-exp';
      this.infoBtn.textContent = tr('bh.experience');
    }
    if (!h) {
      this.infoBtn.remove();
      return;
    }
    this.infoBtn.onclick = () => void this.experience(h, nav);
    if (this.infoBtn.parentElement !== actions) actions.append(this.infoBtn);
  }

  /** per frame; returns true when the picture needs a new frame */
  update(f: BhFrame): boolean {
    const { nav, camera } = f;
    this.lastFrame = f;
    // the hole with the largest Einstein radius on screen
    let best: BlackHole | null = null;
    let bestPx = 0;
    let bestRel: Vec3 = [0, 0, 0];
    for (const h of this.holes) {
      const rel = this.relTo(h, nav);
      const D = Math.hypot(...rel);
      const px = einsteinAngle(h.rsM, Math.max(D, h.rsPc) * M_PER_PC) * f.pxPerRad;
      if (px > bestPx) {
        bestPx = px;
        best = h;
        bestRel = rel;
      }
    }
    const was = this.lensActive;
    const prevActive = this.active;
    this.active = best && bestPx > LENS_MIN_PX ? best : null;
    let changed = this.active !== prevActive;
    if (!this.active) {
      this.lensActive = false;
      this.x = Infinity;
      nav.minDist = MIN_DIST;
      this.atFloor = false;
      this.hud.hide();
      this.flamm.hide();
      return changed || was;
    }
    const h = this.active;
    let rel = bestRel;
    let x = Math.hypot(...rel) / h.rsPc;

    // real scale down to 1.5 r_s: lower the navigation floor near the hole, keep the camera outside
    nav.minDist = x < HUD_MAX_X ? Math.min(MIN_DIST, h.rsPc * FLOOR_X * 0.99) : MIN_DIST;
    const floorPc = FLOOR_X * h.rsPc;
    const fo = [0, 1, 2].map((k) => nav.view.focus[k] - h.xyz[k]);
    const focusAtHole = Math.hypot(...fo) < 1e-3 * h.rsPc;
    if (focusAtHole) nav.distFloor = Math.max(nav.distFloor, floorPc);
    if (x < FLOOR_X && !nav.flying) {
      if (focusAtHole) nav.view.dist = Math.max(nav.view.dist, floorPc);
      else {
        // camera got inside 1.5 r_s with the focus elsewhere: push it out radially
        const k = FLOOR_X / Math.max(x, 1e-9) - 1;
        for (let i = 0; i < 3; i++) nav.view.focus[i] += rel[i] * k;
      }
      rel = this.relTo(h, nav);
      x = Math.hypot(...rel) / h.rsPc;
      changed = true;
    }
    this.atFloor = x <= FLOOR_X * 1.004;
    this.camRel = rel;
    this.x = x;
    this.lensActive = this.lensSupported && this.lensEnabled;

    // lens uniforms
    const L = this.lens;
    L.uCamR.value.set(rel[0] / h.rsPc, rel[1] / h.rsPc, rel[2] / h.rsPc);
    L.uCamRot.value.setFromMatrix4(camera.matrixWorld);
    const t = Math.tan((camera.fov * Math.PI) / 360);
    L.uTanHalf.value.set(t * camera.aspect, t);
    const disk = this.isDiskOn(h);
    L.uDiskOn.value = disk ? 1 : 0;
    L.uDiskN.value.set(...h.disk.n);
    L.uRin.value = 3;
    L.uRout.value = DISK.rOut;
    L.uTpeak.value = DISK.tPeak;
    L.uDiskGain.value = DISK.level / blackbodyLum(DISK.tPeak);
    const xs = Math.max(x, 1.0001);
    L.uBgGain.value = (disk ? DISK.bgExposure : 1) / ((1 - 1 / xs) * (1 - 1 / xs));
    const key = `${h.name}|${disk}|${this.quality}|${this.flammOn}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      changed = true;
    }

    if (x < HUD_MAX_X) {
      const note = [disk ? `${tr('bh.disk.note', { rout: DISK.rOut, tpeak: DISK.tPeak, name: h.name })} ${tr(h.disk.source)}` : '',
        this.backend === 'WebGL2' && this.lensSupported ? tr('bh.hud.webgl2') : ''].filter(Boolean).join(' ');
      this.hud.update({ hole: h, x, diskOn: disk, flammOn: this.flammOn, quality: this.quality, atFloor: this.atFloor, lensSupported: this.lensSupported }, f.dt, note);
      // Flamm grid: fades in inside ~200 r_s
      const op = this.flammOn ? 1 - smoothstep(80, 250, x) : 0;
      const tanH = t;
      const m = camera.matrixWorldInverse.elements;
      const ue = camera.matrixWorld.elements;
      this.flamm.draw(h, rel, disk ? h.disk.n : [0, 0, 1], [ue[4], ue[5], ue[6]], op, (p) => {
        const vx = m[0] * p[0] + m[4] * p[1] + m[8] * p[2];
        const vy = m[1] * p[0] + m[5] * p[1] + m[9] * p[2];
        const vz = m[2] * p[0] + m[6] * p[1] + m[10] * p[2];
        if (vz > -1e-6 * Math.hypot(vx, vy, vz)) return null;
        const nx = vx / (-vz * tanH * camera.aspect);
        const ny = vy / (-vz * tanH);
        return { x: (nx * 0.5 + 0.5) * f.width, y: (0.5 - ny * 0.5) * f.height };
      });
    } else {
      this.hud.hide();
      this.flamm.hide();
    }
    return changed || was !== this.lensActive;
  }

  debugApi() {
    return {
      holes: () => this.holes.map((h) => ({ name: h.name, massMsun: h.massMsun, rsKm: h.rsM / 1e3, distPc: h.entry.dist_pc, disk: h.disk.defaultOn })),
      state: () => ({ active: this.active?.name ?? null, lens: this.lensActive, x: this.x, atFloor: this.atFloor, quality: this.quality,
        disk: this.active ? this.isDiskOn(this.active) : null }),
      /** camera at x r_s from the hole, on the Earth line of sight rotated by yawDeg about the hole (instant) */
      view: (name: string, x: number, yawDeg = 0, pitchDeg?: number) => {
        const h = this.find(name);
        if (!h) return null;
        const v = this.viewFor(h, x, yawDeg);
        if (pitchDeg !== undefined) v.pitch = (pitchDeg * Math.PI) / 180;
        return v;
      },
      /** view with the camera at inclination incDeg to the disk axis (0 = face-on), azimuth azDeg */
      diskView: (name: string, x: number, incDeg: number, azDeg = 0) => {
        const h = this.find(name);
        if (!h) return null;
        const n = h.disk.n;
        // az = 0: the view direction lies in the plane of n and Galactic +z, so the disk's projected
        // axis is vertical on screen (the camera has no roll). Of the two such directions, take the one
        // whose screen-up (NavController.basis) points along +n: camera above the disk, n up.
        const zn = n[2];
        let p: Vec3 = [-zn * n[0], -zn * n[1], 1 - zn * n[2]];
        const pl = Math.hypot(...p);
        p = p.map((c) => c / pl) as Vec3;
        const i = (incDeg * Math.PI) / 180;
        const az = (azDeg * Math.PI) / 180;
        const pick = (sgn: number, inc: number) => {
          const pp = p.map((c) => c * sgn) as Vec3;
          const q: Vec3 = [n[1] * pp[2] - n[2] * pp[1], n[2] * pp[0] - n[0] * pp[2], n[0] * pp[1] - n[1] * pp[0]];
          const d = [0, 1, 2].map((k) => Math.cos(inc) * n[k] + Math.sin(inc) * (Math.cos(az) * pp[k] + Math.sin(az) * q[k]));
          const yaw = Math.atan2(d[1], d[0]);
          const pitch = Math.asin(d[2]);
          const b = NavController.dir(yaw, pitch);
          const r = [-Math.sin(yaw), Math.cos(yaw), 0];
          const up = [b[1] * r[2] - b[2] * r[1], b[2] * r[0] - b[0] * r[2], b[0] * r[1] - b[1] * r[0]];
          return { yaw, pitch, upn: (up[0] * n[0] + up[1] * n[1] + up[2] * n[2]) * Math.sign(Math.cos(inc)) };
        };
        // camera on the side of the plane its screen-up points to (the disk is mirror-symmetric, so viewing
        // from below at 180° - i is the same picture): the Luminet orientation, far side lensed above
        const v = [pick(1, i), pick(-1, i), pick(1, Math.PI - i), pick(-1, Math.PI - i)].reduce((m, c) => (c.upn > m.upn ? c : m));
        return { focus: h.xyz.slice(), dist: x * h.rsPc, yaw: v.yaw, pitch: v.pitch };
      },
      /**
       * camera at x r_s on the Earth side of the hole, looking offDeg away from the hole (sideways,
       * in the plane of the line of sight and Galactic +z); the focus is a point lookPc ahead
       */
      lookView: (name: string, x: number, offDeg: number) => {
        const h = this.find(name);
        if (!h) return null;
        const n = Math.hypot(...h.xyz);
        const e = h.xyz.map((c) => -c / n); // hole -> Sun
        let t = [0 - e[2] * e[0], 0 - e[2] * e[1], 1 - e[2] * e[2]];
        const tl = Math.hypot(...t);
        t = t.map((c) => c / tl);
        const a = (offDeg * Math.PI) / 180;
        const look = [0, 1, 2].map((k) => -Math.cos(a) * e[k] + Math.sin(a) * t[k]); // view direction
        const D = 3 * h.rsPc;
        const cam = [0, 1, 2].map((k) => h.xyz[k] + e[k] * x * h.rsPc);
        return { focus: cam.map((c, k) => c + look[k] * D), dist: D, yaw: Math.atan2(-look[1], -look[0]), pitch: Math.asin(-look[2]) };
      },
      normal: (name: string) => this.find(name)?.disk.n ?? null,
      /** CSS-px screen positions of the active hole and of points offset from it toward celestial north / east */
      skyAxes: () => {
        const f = this.lastFrame;
        const h = this.active;
        if (!f || !h || h.entry.ra === undefined || h.entry.dec === undefined) return null;
        const ax = skyAxes(h.entry.ra, h.entry.dec);
        const s = 0.3 * Math.hypot(...this.camRel);
        const m = f.camera.matrixWorldInverse.elements;
        const t = Math.tan((f.camera.fov * Math.PI) / 360);
        const proj = (dir: Vec3 | null) => {
          const p = [0, 1, 2].map((k) => -this.camRel[k] + (dir ? dir[k] * s : 0));
          const vx = m[0] * p[0] + m[4] * p[1] + m[8] * p[2];
          const vy = m[1] * p[0] + m[5] * p[1] + m[9] * p[2];
          const vz = m[2] * p[0] + m[6] * p[1] + m[10] * p[2];
          return { x: (vx / (-vz * t * f.camera.aspect) * 0.5 + 0.5) * f.width, y: (0.5 - (vy / (-vz * t)) * 0.5) * f.height };
        };
        return { c: proj(null), n: proj(ax.north), e: proj(ax.east) };
      },
      setDisk: (name: string, on: boolean) => this.setDisk(name, on),
      setEnvEvery: (ms: number) => (this.envEveryMs = ms),
      setLens: (on: boolean) => {
        this.lensEnabled = on;
        this.onChange();
      },
      setEnvOnly: (on: boolean) => {
        this.lens.uEnvOnly.value = on ? 1 : 0;
        this.onChange();
      },
      setQuality: (q: Quality) => this.setQuality(q),
      setFlamm: (on: boolean) => {
        this.flammOn = on;
        this.onChange();
      },
    };
  }
}

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
