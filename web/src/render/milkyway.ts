/**
 * Procedural face-on Milky Way: a MODEL for context at scales where the 1 kpc Gaia bubble is
 * a speck. It is not data and is labelled as such in the UI.
 *
 * Spiral arms: log-periodic spirals with kinks, Reid et al. 2019, ApJ 885, 131
 * (arXiv:1910.03357), Table 2 and their eq.:  ln(R/R_kink) = -(beta - beta_kink) tan(psi),
 * psi = psi_< for beta <= beta_kink, psi_> otherwise. beta is Galactocentric azimuth, 0 toward
 * the Sun, increasing in the direction of Galactic rotation. In-plane Gaussian 1-sigma width
 * w(R) = w(R_kink) + 0.042 (R - R_kink) kpc (their dw/dR = 42 pc/kpc).
 * Arms are drawn over the beta range of the parallax data and extrapolated (fading) beyond it;
 * the extrapolated parts are this viewer's guess, as are the disc/bar populations below.
 *
 * Sun-GC distance R0 = 8.275 kpc (GRAVITY Collaboration 2021, A&A 647, A59), the same value the
 * catalogue scripts use for the Galactic Centre position. Reid et al. fit
 * R0 = 8.15 kpc; their R_kink values are Galactocentric, so they are used unchanged.
 * Disc: exponential, scale length 2.6 kpc, scale height 0.3 kpc (Bland-Hawthorn & Gerhard 2016).
 * Long bar: half-length ~5 kpc at ~28 deg to the Sun-GC line, near end at positive l
 * (Wegg, Gerhard & Portail 2015).
 *
 * Frame: contract heliocentric Galactic, GC at (+R0, 0, 0). Since beta grows with rotation
 * (+y at the Sun), a point at (R, beta) is at (R0 - R cos beta, R sin beta, z).
 */

import * as THREE from 'three/webgpu';
import { Discard, Fn, If, attribute, clamp, dot, float, length, max, min, modelViewMatrix, select, smoothstep, uniform, uv, varying, vec4 } from 'three/tsl';
import { QUAD, gaussProfile, kneeNode, srgbToLinearNode } from './pointMaterial';
import { REF_PX_PER_RAD } from './brightness';
import type { Vec3 } from '../math/frames';

export const R0_PC = 8275;

interface Arm {
  name: string;
  betaMin: number;
  betaMax: number;
  betaKink: number;
  rKink: number; // kpc
  psiLt: number; // deg
  psiGt: number; // deg
  width: number; // kpc
  major: boolean;
}

// Reid et al. 2019, Table 2 (central values).
export const REID2019_ARMS: Arm[] = [
  { name: '3-kpc arm', betaMin: 15, betaMax: 18, betaKink: 15, rKink: 3.52, psiLt: -4.2, psiGt: -4.2, width: 0.18, major: false },
  { name: 'Norma arm', betaMin: 5, betaMax: 54, betaKink: 18, rKink: 4.46, psiLt: -1.0, psiGt: 19.5, width: 0.14, major: true },
  { name: 'Scutum-Centaurus arm', betaMin: 0, betaMax: 104, betaKink: 23, rKink: 4.91, psiLt: 14.1, psiGt: 12.1, width: 0.23, major: true },
  { name: 'Sagittarius-Carina arm', betaMin: 2, betaMax: 97, betaKink: 24, rKink: 6.04, psiLt: 17.1, psiGt: 1.0, width: 0.27, major: true },
  { name: 'Local arm', betaMin: -8, betaMax: 34, betaKink: 9, rKink: 8.26, psiLt: 11.4, psiGt: 11.4, width: 0.31, major: false },
  { name: 'Perseus arm', betaMin: -23, betaMax: 115, betaKink: 40, rKink: 8.87, psiLt: 10.3, psiGt: 8.7, width: 0.35, major: true },
  { name: 'Outer arm', betaMin: -16, betaMax: 71, betaKink: 18, rKink: 12.24, psiLt: 3.0, psiGt: 9.4, width: 0.65, major: true },
];

const DEG = Math.PI / 180;

export function armRadiusKpc(a: Arm, betaDeg: number): number {
  const psi = (betaDeg <= a.betaKink ? a.psiLt : a.psiGt) * DEG;
  return a.rKink * Math.exp(-(betaDeg - a.betaKink) * DEG * Math.tan(psi));
}

/** heliocentric Galactic position (pc) of Galactocentric (R kpc, beta deg, z pc) */
export function galactocentricToHelio(rKpc: number, betaDeg: number, zPc = 0): Vec3 {
  const b = betaDeg * DEG;
  return [R0_PC - rKpc * 1000 * Math.cos(b), rKpc * 1000 * Math.sin(b), zPc];
}

export interface ModelLabel {
  name: string;
  xyz: Vec3;
  kind: 'model';
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class MilkyWayModel {
  readonly points: THREE.Mesh;
  readonly material: THREE.PointsNodeMaterial;
  private readonly uPxPerRad = uniform(1000);
  private readonly uFade = uniform(1);
  private readonly uDpr = uniform(1);
  readonly labels: ModelLabel[] = [];
  readonly center: Vec3 = [R0_PC, 0, 0];
  visible = true;
  opacity = 1;

  constructor() {
    const rnd = mulberry32(81782019);
    const gauss = () => {
      const u = Math.max(rnd(), 1e-12);
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
    };
    const pos: number[] = [];
    const col: number[] = [];
    const aux: number[] = []; // radius pc, weight
    const push = (p: Vec3, c: [number, number, number], radius: number, w: number) => {
      // stored relative to the GC (the object's centre) so float32 stays precise
      pos.push(p[0] - R0_PC, p[1], p[2]);
      col.push(c[0] / 255, c[1] / 255, c[2] / 255);
      aux.push(radius, w);
    };

    // spiral arms
    for (const a of REID2019_ARMS) {
      const ext = a.major ? 70 : 20;
      const b0 = a.betaMin - ext;
      const b1 = a.betaMax + ext;
      const nSteps = Math.round((b1 - b0) * (a.major ? 700 : 450) / 100);
      for (let i = 0; i < nSteps; i++) {
        const beta = b0 + (b1 - b0) * rnd();
        const R = armRadiusKpc(a, beta);
        if (R < 2.2 || R > 19) continue;
        const outside = beta < a.betaMin ? a.betaMin - beta : beta > a.betaMax ? beta - a.betaMax : 0;
        const fade = 1 - outside / ext;
        if (rnd() > fade) continue;
        const w = Math.max(0.1, a.width + 0.042 * (R - a.rKink));
        const sz = Math.max(0.06, 0.02 + 0.036 * (R - 7));
        const Rr = R + gauss() * w;
        const bb = beta + (gauss() * w * 0.4) / R / DEG;
        const p = galactocentricToHelio(Rr, bb, gauss() * sz * 1000);
        const bright = Math.exp(-R / 6);
        if (rnd() < 0.05) push(p, [255, 140, 165], 60, 5 * bright); // HII regions
        else push(p, [178, 202, 255], 150, 2.6 * bright);
      }
      const mid = (a.betaMin + a.betaMax) / 2 + (a.name.startsWith('Local') ? 8 : 0);
      this.labels.push({ name: a.name, xyz: galactocentricToHelio(armRadiusKpc(a, mid), mid), kind: 'model' });
    }

    // exponential disc
    for (let i = 0; i < 70000; i++) {
      const R = -2.6 * Math.log(Math.max(rnd() * rnd(), 1e-12)); // Gamma(2, 2.6) ∝ R e^{-R/h}
      if (R > 17) continue;
      const beta = rnd() * 360;
      const z = (rnd() < 0.5 ? -1 : 1) * -300 * Math.log(Math.max(rnd(), 1e-9));
      push(galactocentricToHelio(R, beta, z), [255, 226, 188], 240, 0.22);
    }

    // long bar + bulge
    const phi = 28 * DEG; // near end toward +y (positive l)
    const ax: Vec3 = [-Math.cos(phi), Math.sin(phi), 0];
    const ay: Vec3 = [-Math.sin(phi), -Math.cos(phi), 0];
    for (let i = 0; i < 26000; i++) {
      const bulge = rnd() < 0.45;
      const a = bulge ? gauss() * 0.75 : gauss() * 1.9;
      const b = bulge ? gauss() * 0.75 : gauss() * 0.55;
      const z = bulge ? gauss() * 0.55 : gauss() * 0.3;
      const p: Vec3 = [
        R0_PC + (a * ax[0] + b * ay[0]) * 1000,
        (a * ax[1] + b * ay[1]) * 1000,
        z * 1000,
      ];
      push(p, [255, 208, 152], 220, 0.5);
    }

    this.labels.push({ name: 'Galactic bar', xyz: [R0_PC - 2600 * Math.cos(phi), 2600 * Math.sin(phi), 0], kind: 'model' });

    const n = pos.length / 3;
    const g = new THREE.InstancedBufferGeometry();
    g.setIndex(QUAD.index!.clone());
    g.setAttribute('position', QUAD.getAttribute('position').clone());
    g.setAttribute('uv', QUAD.getAttribute('uv').clone());
    g.setAttribute('inst', new THREE.InstancedBufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('col', new THREE.InstancedBufferAttribute(new Float32Array(col), 3));
    g.setAttribute('aux', new THREE.InstancedBufferAttribute(new Float32Array(aux), 2));
    g.instanceCount = n;

    // TSL: physical sprite radius -> pixels; surface brightness per sprite constant with distance
    const inst = attribute('inst', 'vec3');
    const auxA = attribute('aux', 'vec2');
    const mv = modelViewMatrix.mul(vec4(inst, 1.0));
    const r = max(length(mv.xyz), 1e-6);
    const size = auxA.x.div(r).mul(this.uPxPerRad).mul(2.0); // device px
    // energy-conserving below 1.5 reference px (per solid angle, so canvas size does not matter);
    // fade sprites that would cover the screen
    const sizeRef = size.mul(REF_PX_PER_RAD).div(this.uPxPerRad);
    const small = min(1.0, sizeRef.div(1.5).mul(sizeRef.div(1.5)));
    const I = this.uFade.mul(auxA.y).mul(0.03).mul(small).mul(float(1.0).sub(smoothstep(300.0, 900.0, size)));
    const keep = I.greaterThan(1e-5).and(mv.z.lessThan(0.0));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vI: any = varying(I, 'vMwI');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vC: any = varying(srgbToLinearNode(attribute('col', 'vec3')), 'vMwC');
    this.material = new THREE.PointsNodeMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: false,
    });
    this.material.positionNode = inst;
    this.material.sizeNode = select(keep, clamp(size, 1.5, 300.0).div(this.uDpr), float(0.0));
    this.material.colorNode = Fn(() => {
      const p = uv().mul(2.0).sub(1.0);
      const r2 = dot(p, p);
      If(r2.greaterThan(1.0), () => {
        Discard();
      });
      return vC.mul(kneeNode(vI.mul(gaussProfile(r2))));
    })();
    this.material.opacityNode = float(1.0);
    this.points = new THREE.Mesh(g, this.material);
    this.points.frustumCulled = false;
    this.points.name = 'milky-way-model';
  }

  /** Fade in as the camera leaves the Gaia bubble (> ~1.5 kpc from the Sun). */
  static fadeFor(camDistFromSunPc: number): number {
    const t = Math.min(1, Math.max(0, (camDistFromSunPc - 1500) / (5000 - 1500)));
    return t * t * (3 - 2 * t);
  }

  update(camPos: Vec3, pxPerRad: number, dpr: number) {
    const fade = MilkyWayModel.fadeFor(Math.hypot(camPos[0], camPos[1], camPos[2])) * this.opacity;
    this.uFade.value = fade;
    this.uPxPerRad.value = pxPerRad;
    this.uDpr.value = dpr;
    this.points.visible = this.visible && fade > 0.001;
    this.points.position.set(this.center[0] - camPos[0], this.center[1] - camPos[1], this.center[2] - camPos[2]);
    return fade;
  }
}
