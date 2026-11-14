/**
 * The cosmic microwave background as the "last scattering surface": a sphere around the Sun at
 * the Planck18 comoving distance of z = 1090 (13,884 Mpc; test/cosmology.test.ts checks it against
 * astropy). The pixels are ray-traced in the post pass (src/render/post.ts, cmbAt); this module
 * owns the texture, when it shows, and where its label sits.
 *
 * Visibility: only once the camera is beyond the cosmic web. The farthest catalogue light (DESI
 * quasars) sits at ~6.5 Gpc, so the shell fades in between 8 and 12 Gpc of camera distance from
 * the Sun (the camera has then left the catalogued web behind) and is fully drawn from there out
 * to the 30 Gpc zoom limit.
 */

import * as THREE from 'three/webgpu';
import { Z_CMB, comovingDistancePc } from '../math/cosmology';
import type { Vec3 } from '../math/frames';

/** comoving radius of the last scattering surface, pc (Planck18, z = 1090) */
export const CMB_RADIUS_PC = comovingDistancePc(Z_CMB);

const FADE_IN_PC: [number, number] = [8e9, 12e9];

export function cmbFade(camFromSunPc: number): number {
  const k = Math.min(1, Math.max(0, (camFromSunPc - FADE_IN_PC[0]) / (FADE_IN_PC[1] - FADE_IN_PC[0])));
  return k * k * (3 - 2 * k);
}

/** texture uv of a Galactic direction (CPU twin of post.ts cmbAt; three.js v = 0 at the bottom row) */
export function cmbUV(lDeg: number, bDeg: number): [number, number] {
  let l = lDeg;
  if (l > 180) l -= 360;
  return [0.5 - l / 360, 0.5 + bDeg / 180];
}

/**
 * Where the shell's label goes: the point of the visible rim in the camera's "up" direction
 * (outside the shell), or straight above the camera's view on the shell (inside). Written into
 * `out` so a label item holding that array follows it.
 */
export function limbAnchor(cam: Vec3, up: Vec3, R: number, out: Vec3): Vec3 {
  const d = Math.hypot(cam[0], cam[1], cam[2]);
  // up component perpendicular to the Sun-camera line
  const c: Vec3 = d > 0 ? [cam[0] / d, cam[1] / d, cam[2] / d] : [0, 0, 1];
  const k = up[0] * c[0] + up[1] * c[1] + up[2] * c[2];
  let u: Vec3 = [up[0] - k * c[0], up[1] - k * c[1], up[2] - k * c[2]];
  const ul = Math.hypot(u[0], u[1], u[2]);
  u = ul > 1e-9 ? [u[0] / ul, u[1] / ul, u[2] / ul] : [0, 0, 1];
  if (d > R) {
    // tangent point of the rim: (R^2/d) c + R sqrt(1 - R^2/d^2) u
    const a = (R * R) / d;
    const b = R * Math.sqrt(Math.max(0, 1 - (R * R) / (d * d)));
    for (let i = 0; i < 3; i++) out[i] = a * c[i] + b * u[i];
  } else for (let i = 0; i < 3; i++) out[i] = R * u[i];
  return out;
}

export class CmbShell {
  visible = true;
  opacity = 1;
  /** linear gain of the texture in the post pass */
  gain = 0.32;
  tex: THREE.Texture | null = null;
  private loading = false;

  constructor(private readonly url: string, private readonly onLoad: (tex: THREE.Texture, width: number) => void) {}

  /** amount 0..1 for this camera; starts the texture download once the shell is about to show */
  amount(camFromSunPc: number): number {
    const f = this.visible ? cmbFade(camFromSunPc) * this.opacity : 0;
    if (this.visible && !this.tex && !this.loading && camFromSunPc > FADE_IN_PC[0] * 0.6) this.load();
    return this.tex ? f : 0;
  }

  load(): Promise<void> {
    if (this.tex || this.loading) return Promise.resolve();
    this.loading = true;
    return new Promise((resolve) => {
      new THREE.TextureLoader().load(this.url, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.wrapS = THREE.RepeatWrapping;
        this.tex = tex;
        this.onLoad(tex, (tex.image as HTMLImageElement).width);
        resolve();
      }, undefined, () => {
        console.warn(`[cmb] could not load ${this.url}`);
        this.loading = false;
        resolve();
      });
    });
  }
}
