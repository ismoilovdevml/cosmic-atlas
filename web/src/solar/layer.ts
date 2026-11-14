/**
 * The Solar System layer: Sun, planets, Pluto, the Moon and the Galilean moons at their real
 * positions for the simulation time, plus orbit lines, Saturn's rings and the interstellar probes.
 *
 * Relative to eye, with one twist. Every object is placed at (position − camPos) in float64, like
 * the tile nodes, but inside `root`, which is scaled by WORLD_PER_PC = 1e9. A perspective
 * projection does not care about a uniform scale around the eye, so the picture is unchanged; the
 * scale only moves these objects' view depth into the range where three.js's logarithmic depth
 * works (it clamps the near plane to >= 1e-6 scene units, 0.2 AU in parsecs). Planets, rings
 * and orbits then depth-test against each other correctly down to metres. Nothing else in the
 * scene depth-tests, so mixing scales does not matter.
 *
 * Drawing order: the point layers are additive and never depth-test, so planets are drawn after
 * them (renderOrder 10, normal blending, depth write), which hides any star behind a planet.
 * The post pass adds the Gaia sky only where the depth buffer is still clear.
 */

import * as THREE from 'three/webgpu';
import {
  Fn, abs, clamp, dot, exp, float, length, max, mix, modelWorldMatrix, mx_fractal_noise_float, normalize, positionLocal,
  positionView, positionWorld, select, smoothstep, texture, uniform, uv, vec3, vec4,
} from 'three/tsl';
import type { Vec3 } from '../math/frames';
import { PC_PER_AU } from '../math/units';
import { srgbToLinear } from '../render/brightness';
import type { LabelItem } from '../render/labels';
import { BODIES, BODY_BY_ID, CRAFT_NAMES, KM_PER_AU, type BodyDef, type BodyId } from './bodies';
import { SimClock } from './clock';
import { astroTime, bodyFrame, sampleOrbit, solarPositions, type BodyFrame } from './ephemeris';
import { interpolateTrack, parseSpacecraft, trackSpan, type CraftEntry } from './spacecraft';
import { labelSizeKm, parseFeatures, viewAltitudeKm, type PlanetFeature } from './features';
import { bodyToGal, galToBody, latLonToBody } from './surface/geo';
import { PlanetSurface, TileCache } from './surface/surface';
import { isSurfaceBody, type SurfaceBody, type SurfaceMode } from './surface/tiles';

/** scene units per parsec inside the Solar System group (see the header) */
export const WORLD_PER_PC = 1e9;
const S = WORLD_PER_PC;
export const PC_PER_KM = PC_PER_AU / KM_PER_AU;
/** the layer fades out between these camera distances from the Sun (pc): 10,000 to 60,000 AU */
const FADE_PC: [number, number] = [0.05, 0.3];
/** focus distances (pc) above which no Solar System label is shown */
export const SOLAR_LABEL_MAX = 0.3;
/** minimum drawn radius in device px (planets / small bodies) */
const MIN_PX = { big: 2.2, small: 1.6 };
/** true radius (CSS px) from which a body's textures are fetched (see queueTex) */
const TEX_MIN_PX = 0.4;
const ORBIT_SAMPLES = { planet: 2048, moon: 512 };
const JD_UNIX0 = 2440587.5;
/** lowest camera altitude over a body with streamed surface imagery (the focus on its surface) */
export const SURFACE_MIN_ALT_KM = 8;

/* eslint-disable @typescript-eslint/no-explicit-any */
type U<T> = { value: T };

interface BodyR {
  def: BodyDef;
  pos: Vec3; // heliocentric pc, live
  rpc: number; // radius in pc
  mesh: THREE.Mesh;
  uSun: U<THREE.Vector3>;
  uDot: U<number>;
  uAlpha: U<number>;
  texNode?: any;
  ring?: { mesh: THREE.Mesh; uAlpha: U<number>; uSun: U<THREE.Vector3>; uCenter: U<THREE.Vector3>; uR: U<number> };
  orbit?: { line: THREE.Line; rel: Float64Array; attr: THREE.BufferAttribute; tc: number; uAlpha: U<number>; uFadeNear: U<number> };
  glow?: { sprite: THREE.Sprite; uGain: U<number> };
  alpha: number;
  screen: { x: number; y: number; rpx: number; dist: number } | null;
  entry: SolarEntry;
  label: LabelItem;
}

interface CraftR {
  entry: SolarEntry;
  data: CraftEntry;
  pos: Vec3;
  vel: Vec3;
  on: boolean;
  sprite: THREE.Sprite;
  trail: THREE.Line;
  trailAttr: THREE.BufferAttribute;
  trailK: number;
  uAlpha: U<number>;
  uTrail: U<number>;
  alpha: number;
  screen: { x: number; y: number; rpx: number; dist: number } | null;
  label: LabelItem;
}

/** a search/label entry for a Solar System object (CatalogEntry-compatible; xyz is live) */
export interface SolarEntry {
  name: string;
  alt: string[];
  kind: string;
  dist_pc: number;
  xyz: Vec3;
  docs: string;
  ref: string;
  /** set on every Solar System entry, so main.ts can route clicks here */
  solar: { type: 'body'; id: BodyId } | { type: 'craft'; id: number } | { type: 'feature'; id: SurfaceBody; index: number };
}

type FeatureLabel = LabelItem & { names: PlanetFeature['names'] };

/** a named surface feature placed on its body (features.ts) */
interface FeatureR {
  f: PlanetFeature;
  /** body-fixed unit vector */
  nB: Vec3;
  entry: SolarEntry;
  label: FeatureLabel;
}

export interface SolarUpdate {
  cam: Vec3;
  camera: THREE.PerspectiveCamera;
  /** device px per radian */
  pxPerRad: number;
  /** camera distance to the focus (pc): orbit lines step back when you zoom in on one body */
  focusDist: number;
  dpr: number;
  width: number;
  height: number;
}

/** sRGB hex -> linear RGB (the scene is summed in linear light, see render/post.ts) */
function linColor(hex: string): THREE.Vector3 {
  const n = parseInt(hex.slice(1), 16);
  return new THREE.Vector3(srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255));
}

function smooth(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

const SPHERE = new THREE.SphereGeometry(1, 96, 48);

export class SolarSystem {
  readonly root = new THREE.Group();
  readonly clock = new SimClock();
  visible = true;
  opacity = 1;
  readonly bodies: BodyR[] = [];
  readonly crafts: CraftR[] = [];
  /** search entries (bodies + probes); their xyz / dist_pc update in place */
  readonly entries: SolarEntry[] = [];
  readonly labelItems: LabelItem[] = [];
  /** body the camera focus is locked to (moves with it), or null */
  followId: BodyId | null = null;
  onSelect: (e: SolarEntry) => void = () => {};
  /** global fade (camera distance from the Sun x opacity), last frame */
  fade = 0;
  private pos!: Record<BodyId, Vec3>;
  private simMs = NaN;
  /** simulation time of the last placed frame (NaN forces a re-render, e.g. after a texture loads) */
  private drawnMs = NaN;
  private advanced = false;
  private lastFollowId: BodyId | null = null;
  private lastScreen = new Map<object, { x: number; y: number }>();
  private earth4k: 'no' | 'loading' | 'yes' = 'no';
  private loader = new THREE.TextureLoader();
  /** texture loads per body, started once the body is resolved on screen (none at the first frame) */
  private texQueue = new Map<BodyId, (() => void)[]>();
  private lastFollow: Vec3 | null = null;
  private orbitCursor = 0;
  /** streamed Moon / Mars surface imagery (surface/surface.ts) */
  readonly tileCache = new TileCache();
  readonly surfaces = new Map<BodyId, PlanetSurface>();
  private surfaceDirty = false;
  /** named surface features (search entries + labels), from planet-features.json */
  readonly features: FeatureR[] = [];
  readonly featureEntries: SolarEntry[] = [];
  readonly featureLabels: FeatureLabel[] = [];
  private lastFrame: { id: BodyId; f: BodyFrame } | null = null;

  constructor(private assetBase = 'solar/') {
    this.root.name = 'solar-system';
    this.root.scale.setScalar(S);
    this.root.matrixAutoUpdate = true;
    this.pos = solarPositions(this.clock.now());
    this.simMs = this.clock.now();
    for (const def of BODIES) this.bodies.push(this.makeBody(def));
    for (const b of this.bodies) if (b.def.periodDays) this.makeOrbit(b);
    for (const b of this.bodies) {
      if (isSurfaceBody(b.def.id)) this.surfaces.set(b.def.id, new PlanetSurface(b.def.id, this.root, this.tileCache, b.uSun, b.uAlpha));
    }
    this.tileCache.onLoad = () => (this.surfaceDirty = true);
  }

  /** photo mosaic or colour-shaded relief on the Moon / Mars */
  setSurfaceMode(id: BodyId, mode: SurfaceMode) {
    this.surfaces.get(id)?.setMode(mode);
    this.surfaceDirty = true;
  }

  /** info-card action: a Photo / Relief switch for the Moon, Mars and their features (null removes it) */
  infoFor(e: SolarEntry | null, actions: HTMLElement, label: (mode: SurfaceMode) => string) {
    let btn = actions.querySelector<HTMLButtonElement>('button.surface-mode');
    const id = e ? this.bodyIdOf(e) : null;
    const surf = id ? this.surfaces.get(id) : undefined;
    if (!id || !surf) {
      btn?.remove();
      return;
    }
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn surface-mode';
      actions.append(btn);
    }
    const b = btn;
    const sync = () => (b.textContent = label(surf.mode === 'photo' ? 'relief' : 'photo'));
    sync();
    b.onclick = () => {
      this.setSurfaceMode(id, surf.mode === 'photo' ? 'relief' : 'photo');
      sync();
    };
  }

  /** load data/tiles/catalogs/planet-features.json (scripts/build_planet_features.py) */
  async loadFeatures(url: string): Promise<number> {
    let json: unknown;
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      json = await r.json();
    } catch (e) {
      console.warn(`[solar] planet features unavailable (${(e as Error).message})`);
      return 0;
    }
    for (const f of parseFeatures(json)) {
      const b = this.bodyR(f.body);
      const xyz: Vec3 = [b.pos[0], b.pos[1], b.pos[2]];
      const index = this.features.length;
      const entry: SolarEntry = {
        name: f.name, alt: [...new Set([...f.alt, f.names.en, f.names.uz, f.names.ru])].filter((n) => n !== f.name), kind: f.kind,
        dist_pc: Math.hypot(...b.pos), xyz, docs: b.def.docs, ref: f.ref, solar: { type: 'feature', id: f.body, index },
      };
      const rKm = labelSizeKm(f) / 2;
      const label: FeatureLabel = {
        name: f.names.en, names: f.names, xyz, kind: f.kind,
        // ranks labels by angular size (LabelLayer: apparent = absMag + 5 log10(r / 10 pc))
        absMag: -5 * Math.log10(rKm) - 30, minScale: 0, maxScale: SOLAR_LABEL_MAX, sizePc: rKm * PC_PER_KM, hidden: true,
        onClick: () => this.onSelect(entry),
      };
      this.features.push({ f, nB: latLonToBody(f.lat, f.lon), entry, label });
      this.featureEntries.push(entry);
      this.featureLabels.push(label);
    }
    // bigger first: LabelLayer keeps array order among equals
    this.featureLabels.sort((a, b) => (b.sizePc ?? 0) - (a.sizePc ?? 0));
    return this.features.length;
  }

  featureOf(e: SolarEntry): PlanetFeature | null {
    return e.solar.type === 'feature' ? this.features[e.solar.index].f : null;
  }

  /** heliocentric pc of a feature at the current simulation time */
  featurePos(e: SolarEntry): Vec3 {
    const fr = this.features[(e.solar as { index: number }).index];
    const b = this.bodyR(fr.f.body);
    const n = bodyToGal(bodyFrame(fr.f.body, astroTime(this.simMs)), fr.nB);
    return [b.pos[0] + n[0] * b.rpc, b.pos[1] + n[1] * b.rpc, b.pos[2] + n[2] * b.rpc];
  }

  // ------------------------------------------------------------------ construction

  /** a body's texture is fetched when it first spans TEX_MIN_PX on screen; until then its flat colour is drawn */
  private queueTex(id: BodyId, file: string, onLoad: (t: THREE.Texture) => void) {
    const q = this.texQueue.get(id) ?? [];
    q.push(() => this.loadTex(file, onLoad));
    this.texQueue.set(id, q);
  }

  private loadTex(file: string, onLoad: (t: THREE.Texture) => void) {
    this.loader.load(`${this.assetBase}${file}`, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.anisotropy = 8;
      onLoad(tex);
    }, undefined, () => console.warn(`[solar] could not load ${file}`));
  }

  private makeBody(def: BodyDef): BodyR {
    const rpc = def.radiusKm * PC_PER_KM;
    const uSun = uniform(new THREE.Vector3());
    const uDot = uniform(0);
    const uAlpha = uniform(1);
    const base = linColor(def.color);
    const base2 = linColor(def.color2 ?? def.color);
    let texNode: any;
    if (def.texture) {
      const ph = new THREE.DataTexture(new Uint8Array([...new THREE.Color(def.color).toArray().map((v) => Math.round(v * 255)), 255]), 1, 1);
      ph.needsUpdate = true;
      texNode = texture(ph, uv());
      this.queueTex(def.id, def.texture, (tex) => {
        texNode.value = tex;
        this.drawnMs = NaN; // re-render
      });
    }
    let nightNode: any;
    if (def.nightTexture) {
      const blk = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
      blk.needsUpdate = true;
      nightNode = texture(blk, uv());
      this.queueTex(def.id, def.nightTexture, (tex) => {
        nightNode.value = tex;
        this.drawnMs = NaN;
      });
    }
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthTest: true, depthWrite: true, blending: THREE.NormalBlending });
    mat.colorNode = Fn(() => {
      // unit sphere: the local position is the surface normal
      let albedo: any;
      if (texNode) albedo = texNode.rgb;
      else {
        const n = mx_fractal_noise_float(positionLocal.mul(3.2), 4, 2.0, 0.5).mul(0.5).add(0.5);
        const bands = mx_fractal_noise_float(vec3(positionLocal.y.mul(9.0), positionLocal.x.mul(1.5), positionLocal.z.mul(1.5)), 2, 2.0, 0.5);
        albedo = mix(vec3(base.x, base.y, base.z), vec3(base2.x, base2.y, base2.z), smoothstep(0.35, 0.8, n.add(bands.mul(0.15))));
      }
      if (def.emissive) {
        // limb darkening (Eddington approximation) on the emissive disc
        const nW = normalize(modelWorldMatrix.mul(vec4(positionLocal, 0.0)).xyz);
        const mu = max(dot(nW, normalize(positionWorld.negate())), 0.0);
        return albedo.mul(float(0.4).add(mu.mul(0.6))).mul(2.6);
      }
      const nW = normalize(modelWorldMatrix.mul(vec4(positionLocal, 0.0)).xyz);
      const L = normalize(uSun.sub(positionWorld));
      const ndl = dot(nW, L);
      const lambert = max(ndl, 0.0);
      let lit = albedo.mul(lambert.mul(1.15).add(0.003));
      if (nightNode) {
        // city lights only where the Sun is down; civil-twilight-wide fade across the terminator
        const night = smoothstep(0.06, -0.10, ndl);
        // the Black Marble map also paints dark-blue land and sea: keep only the bright city lights
        const lum = dot(nightNode.rgb, vec3(0.2126, 0.7152, 0.0722));
        const lights = nightNode.rgb.mul(smoothstep(0.22, 0.65, lum));
        lit = lit.add(lights.mul(night).mul(1.1));
      }
      return mix(lit, albedo.mul(0.75), uDot);
    })();
    mat.opacityNode = uAlpha;
    const mesh = new THREE.Mesh(SPHERE, mat);
    mesh.name = def.id;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = 10;
    mesh.frustumCulled = false;
    this.root.add(mesh);

    const r: BodyR = {
      def, pos: this.pos[def.id], rpc, mesh, uSun, uDot, uAlpha, texNode, alpha: 1, screen: null,
      entry: null as unknown as SolarEntry, label: null as unknown as LabelItem,
    };
    if (def.rings) r.ring = this.makeRing(def, mesh);
    if (def.emissive) r.glow = this.makeGlow(def);

    const entry: SolarEntry = {
      name: def.names.en, alt: [def.names.uz, def.names.ru].filter((n) => n !== def.names.en), kind: def.kind,
      dist_pc: Math.hypot(...r.pos), xyz: r.pos, docs: def.docs,
      ref: 'Position: astronomy-engine 2.1.19. Radius: IAU WGCCRE 2015. Mass, period: NASA fact sheets.',
      solar: { type: 'body', id: def.id },
    };
    r.entry = entry;
    this.entries.push(entry);
    r.label = {
      name: def.names.en, xyz: r.pos, kind: def.kind,
      absMag: def.kind === 'sun' ? -45 : def.kind === 'moon' ? -35 : -40,
      minScale: 0, maxScale: SOLAR_LABEL_MAX, sizePc: 1e-3,
      onClick: () => this.onSelect(entry),
    };
    this.labelItems.push(r.label);
    return r;
  }

  private makeRing(def: BodyDef, planet: THREE.Mesh): BodyR['ring'] {
    const ri = def.rings!.innerKm / def.radiusKm;
    const ro = def.rings!.outerKm / def.radiusKm;
    const g = new THREE.RingGeometry(ri, ro, 256, 1);
    // radial texture coordinate: u = 0 at the inner edge, 1 at the outer edge
    const p = g.getAttribute('position');
    const uvA = g.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      const rr = Math.hypot(p.getX(i), p.getY(i));
      uvA.setXY(i, (rr - ri) / (ro - ri), 0.5);
    }
    g.rotateX(-Math.PI / 2); // into the planet's equator (geometry +Y = north pole)
    const uAlpha = uniform(1);
    const uSun = uniform(new THREE.Vector3());
    const uCenter = uniform(new THREE.Vector3());
    const uR = uniform(1);
    const ph = new THREE.DataTexture(new Uint8Array([200, 180, 150, 0]), 1, 1);
    ph.needsUpdate = true;
    const tex = texture(ph, uv());
    this.queueTex(def.id, def.rings!.texture, (t) => {
      tex.value = t;
      this.drawnMs = NaN;
    });
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthTest: true, depthWrite: false, side: THREE.DoubleSide });
    mat.colorNode = Fn(() => {
      const nW = normalize(modelWorldMatrix.mul(vec4(0.0, 1.0, 0.0, 0.0)).xyz);
      const L = normalize(uSun.sub(positionWorld));
      const V = normalize(positionWorld.negate());
      // Lommel-Seeliger: I ∝ mu0 / (mu0 + mu), the usual first-order law for the rings' particles
      const mu0 = abs(dot(nW, L));
      const mu = abs(dot(nW, V));
      const ls = mu0.div(mu0.add(mu).add(1e-3)).mul(2.0);
      // the planet's shadow on the rings: does the ray toward the Sun pass through the planet?
      const toC = uCenter.sub(positionWorld);
      const tc = dot(toC, L);
      const d2 = dot(toC, toC).sub(tc.mul(tc));
      const shadow = max(smoothstep(uR.mul(uR).mul(0.96), uR.mul(uR).mul(1.04), d2), select(tc.lessThan(0.0), float(1.0), float(0.0)));
      return tex.rgb.mul(ls).mul(shadow).mul(0.95);
    })();
    mat.opacityNode = Fn(() => tex.a.mul(uAlpha))();
    const mesh = new THREE.Mesh(g, mat);
    mesh.renderOrder = 11;
    mesh.frustumCulled = false;
    planet.add(mesh);
    return { mesh, uAlpha, uSun, uCenter, uR };
  }

  private makeGlow(def: BodyDef): BodyR['glow'] {
    const uGain = uniform(1);
    const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthTest: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const c = linColor('#fff1d6');
    mat.colorNode = Fn(() => {
      const p = uv().mul(2.0).sub(1.0);
      const r2 = dot(p, p);
      const I = exp(r2.mul(-9.0)).mul(1.4).add(exp(r2.mul(-2.2)).mul(0.25)).mul(clamp(float(1.0).sub(r2), 0.0, 1.0));
      return vec3(c.x, c.y, c.z).mul(I).mul(uGain);
    })();
    mat.opacityNode = float(1.0);
    const sprite = new THREE.Sprite(mat);
    sprite.renderOrder = 14;
    sprite.frustumCulled = false;
    sprite.name = `${def.id}-glow`;
    this.root.add(sprite);
    return { sprite, uGain };
  }

  private makeOrbit(b: BodyR) {
    const n = b.def.parent ? ORBIT_SAMPLES.moon : ORBIT_SAMPLES.planet;
    const geom = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(new Float32Array((n + 1) * 3), 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    geom.setAttribute('position', attr);
    const uAlpha = uniform(0.3);
    const uFadeNear = uniform(0);
    const col = linColor(b.def.color);
    const mat = new THREE.LineBasicNodeMaterial({ transparent: true, depthTest: true, depthWrite: false, blending: THREE.AdditiveBlending });
    mat.colorNode = vec3(col.x, col.y, col.z).mul(0.8).add(0.08);
    // hide the parts of the polyline so close to the eye that its chords could show (see fadeNear)
    mat.opacityNode = Fn(() => uAlpha.mul(smoothstep(uFadeNear.mul(0.4), uFadeNear, length(positionView))))();
    const line = new THREE.Line(geom, mat);
    line.renderOrder = 12;
    line.frustumCulled = false;
    this.root.add(line);
    b.orbit = { line, rel: new Float64Array(0), attr, tc: NaN, uAlpha, uFadeNear };
    this.resampleOrbit(b, this.simMs);
  }

  private resampleOrbit(b: BodyR, ms: number) {
    const o = b.orbit!;
    const n = o.attr.count - 1;
    o.rel = sampleOrbit(b.def.id, new Date(ms), n);
    const a = o.attr.array as Float32Array;
    // stored relative to the parent's position at the sample centre; float32 is enough for the
    // vertices because the line is placed at (parent − camPos) in float64 every frame
    for (let i = 0; i < o.rel.length; i++) a[i] = o.rel[i];
    o.attr.needsUpdate = true;
    o.tc = ms;
    let rmax = 0;
    for (let i = 0; i <= n; i++) rmax = Math.max(rmax, Math.hypot(o.rel[i * 3], o.rel[i * 3 + 1], o.rel[i * 3 + 2]));
    // chord sagitta of an n-gon of radius R is R π²/(2n²); it is under 0.5 px beyond ~R·π²·900/n² from the eye
    const fadeNearPc = (rmax * Math.PI * Math.PI * 900) / (n * n);
    o.uFadeNear.value = fadeNearPc * S;
  }

  /** load data/tiles/catalogs/spacecraft.json (scripts/build_spacecraft.py) */
  async loadSpacecraft(url: string): Promise<number> {
    let json: unknown;
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      json = await r.json();
    } catch (e) {
      console.warn(`[solar] spacecraft tracks unavailable (${(e as Error).message})`);
      return 0;
    }
    for (const data of parseSpacecraft(json)) {
      const names = CRAFT_NAMES.find((c) => c.horizonsId === data.facts?.horizons_id)?.names ?? { en: data.name, uz: data.name, ru: data.name };
      const pos: Vec3 = [0, 0, 0];
      const entry: SolarEntry = {
        name: names.en, alt: [names.uz, names.ru, ...(data.alt ?? [])].filter((n) => n !== names.en), kind: 'spacecraft',
        dist_pc: 0, xyz: pos, docs: data.docs ?? 'spacecraft', ref: data.ref ?? 'JPL Horizons',
        solar: { type: 'craft', id: data.facts?.horizons_id ?? 0 },
      };
      const uAlpha = uniform(1);
      const smat = new THREE.SpriteNodeMaterial({ transparent: true, depthTest: true, depthWrite: false, blending: THREE.AdditiveBlending });
      const c = linColor('#e8e8e8');
      smat.colorNode = Fn(() => {
        const p = uv().mul(2.0).sub(1.0);
        const r2 = dot(p, p);
        return vec3(c.x, c.y, c.z).mul(exp(r2.mul(-5.0)).mul(clamp(float(1.0).sub(r2), 0.0, 1.0))).mul(uAlpha).mul(1.6);
      })();
      smat.opacityNode = float(1.0);
      const sprite = new THREE.Sprite(smat);
      sprite.renderOrder = 15;
      sprite.frustumCulled = false;
      this.root.add(sprite);
      const n = data.track.n;
      const tgeom = new THREE.BufferGeometry();
      const trailAttr = new THREE.BufferAttribute(new Float32Array((n + 1) * 3), 3);
      trailAttr.setUsage(THREE.DynamicDrawUsage);
      tgeom.setAttribute('position', trailAttr);
      const uTrail = uniform(0.3);
      const tmat = new THREE.LineBasicNodeMaterial({ transparent: true, depthTest: true, depthWrite: false, blending: THREE.AdditiveBlending });
      tmat.colorNode = vec3(0.55, 0.62, 0.72);
      tmat.opacityNode = uTrail;
      const trail = new THREE.Line(tgeom, tmat);
      trail.renderOrder = 12;
      trail.frustumCulled = false;
      this.root.add(trail);
      const label: LabelItem = { name: names.en, xyz: pos, kind: 'spacecraft', absMag: -30, minScale: 0, maxScale: SOLAR_LABEL_MAX, sizePc: 1e-3, onClick: () => this.onSelect(entry) };
      this.crafts.push({ entry, data, pos, vel: [0, 0, 0], on: false, sprite, trail, trailAttr, trailK: -1, uAlpha, uTrail, alpha: 0, screen: null, label });
      this.entries.push(entry);
      this.labelItems.push(label);
    }
    this.drawnMs = NaN;
    return this.crafts.length;
  }

  // ------------------------------------------------------------------ per frame

  /** current positions (heliocentric pc, contract frame) */
  positionOf(id: BodyId): Vec3 {
    return this.pos[id];
  }

  bodyR(id: BodyId) {
    return this.bodies.find((b) => b.def.id === id)!;
  }

  /** positions at the clock's time; called once per frame (by follow() or update()) */
  advance() {
    const ms = this.clock.now();
    if (ms !== this.simMs) {
      solarPositions(ms, this.pos);
      this.simMs = ms;
    }
    this.advanced = true;
  }

  /**
   * Advance to the clock's time and place everything relative to the eye. Returns true when the
   * picture changed enough (> 0.25 px) to need a new frame.
   */
  update(u: SolarUpdate): boolean {
    const { cam, pxPerRad } = u;
    const camSun = Math.hypot(cam[0], cam[1], cam[2]);
    const fade = this.visible ? this.opacity * (1 - smooth(FADE_PC[0], FADE_PC[1], camSun)) : 0;
    const fadeChanged = Math.abs(fade - this.fade) > 1e-4;
    this.fade = fade;
    this.root.visible = fade > 0.002;
    if (!this.advanced) this.advance();
    this.advanced = false;
    const ms = this.simMs;
    const timeChanged = ms !== this.drawnMs;
    this.drawnMs = ms;
    if (!this.root.visible) {
      for (const b of this.bodies) b.screen = null;
      for (const c of this.crafts) c.screen = null;
      return fadeChanged;
    }
    const at = astroTime(ms);
    const jd = ms / 86400000 + JD_UNIX0 + 69.184 / 86400; // UTC -> ~TT; 2 min of ΔT error is invisible at 30-day sampling
    const sunRel = new THREE.Vector3(-cam[0] * S, -cam[1] * S, -cam[2] * S);
    let maxMove = fadeChanged ? 1 : 0;
    const proj = new THREE.Vector3();
    const W = u.width;
    const H = u.height;
    const pxCss = pxPerRad / u.dpr;
    const project = (p: Vec3) => {
      proj.set(p[0] - cam[0], p[1] - cam[1], p[2] - cam[2]).project(u.camera);
      if (proj.z > 1 || proj.z < -1) return null;
      return { x: (proj.x * 0.5 + 0.5) * W, y: (-proj.y * 0.5 + 0.5) * H };
    };

    // one orbit resample per frame at most (moons drift; planets after a full period)
    if (timeChanged) {
      const withOrbit = this.bodies.filter((b) => b.orbit);
      for (let k = 0; k < withOrbit.length; k++) {
        const b = withOrbit[(this.orbitCursor + k) % withOrbit.length];
        const P = (b.def.periodDays ?? 365) * 86400000;
        const limit = b.def.id === 'moon' ? P / 8 : b.def.parent ? P * 2 : P / 2;
        if (Math.abs(ms - b.orbit!.tc) > limit) {
          this.resampleOrbit(b, ms);
          this.orbitCursor = (this.orbitCursor + k + 1) % withOrbit.length;
          break;
        }
      }
    }

    const m = new THREE.Matrix4();
    this.tileCache.begin();
    if (this.surfaceDirty) {
      this.surfaceDirty = false;
      maxMove = Math.max(maxMove, 1);
    }
    const frames = new Map<BodyId, BodyFrame>();
    for (const b of this.bodies) {
      const p = b.pos;
      const rel: Vec3 = [p[0] - cam[0], p[1] - cam[1], p[2] - cam[2]];
      const dist = Math.hypot(...rel);
      const parentPos: Vec3 = b.def.parent ? this.pos[b.def.parent] : [0, 0, 0];
      const sep = Math.hypot(p[0] - parentPos[0], p[1] - parentPos[1], p[2] - parentPos[2]);
      const sepPx = b.def.id === 'sun' ? Infinity : (sep / Math.max(dist, 1e-30)) * pxPerRad;
      // a body merges into its parent when the two are only a few px apart
      const vis = fade * smooth(3, 9, sepPx);
      b.alpha = vis;
      b.uAlpha.value = vis;
      const minR = ((b.def.kind === 'planet' || b.def.kind === 'sun' ? MIN_PX.big : MIN_PX.small) * dist) / pxPerRad;
      const inflate = Math.max(1, minR / b.rpc);
      const s = b.rpc * inflate;
      b.uDot.value = smooth(1.0, 2.5, inflate);
      b.mesh.visible = vis > 0.003 && !(b.def.emissive && inflate > 1.5);
      const f = bodyFrame(b.def.id, at, b.def.parent ? { pos: p, parentPos } : undefined);
      // geometry axes -> body axes: +X = prime meridian, +Y = north pole, −Z = 90° E
      m.set(
        f.x[0] * s, f.z[0] * s, -f.y[0] * s, rel[0],
        f.x[1] * s, f.z[1] * s, -f.y[1] * s, rel[1],
        f.x[2] * s, f.z[2] * s, -f.y[2] * s, rel[2],
        0, 0, 0, 1,
      );
      b.mesh.matrix.copy(m);
      b.mesh.matrixWorldNeedsUpdate = true;
      frames.set(b.def.id, f);
      // --- streamed surface (Moon, Mars): replaces the mesh while the body is big on screen
      const surf = this.surfaces.get(b.def.id);
      if (surf) {
        const rpxDev = inflate > 1.001 ? 0 : (s / dist) * pxPerRad;
        const fading = surf.update({
          rel, f, rpc: b.rpc, camera: u.camera, pxPerRad, rpx: rpxDev, globalTex: (b.texNode?.value as THREE.Texture) ?? null,
          visible: b.mesh.visible, now: performance.now(),
        });
        if (fading) maxMove = Math.max(maxMove, 1);
        if (surf.active) b.mesh.visible = false;
        // the planet's own label sits on its centre, under the surface labels: hide it close up
        b.label.hidden = surf.active && s / dist > 0.4;
      }
      b.uSun.value.copy(sunRel);
      if (b.ring) {
        b.ring.uAlpha.value = vis;
        b.ring.uSun.value.copy(sunRel);
        b.ring.uCenter.value.set(rel[0] * S, rel[1] * S, rel[2] * S);
        b.ring.uR.value = b.rpc * S;
      }
      if (b.glow) {
        const g = b.glow;
        const px = Math.max(26 * u.dpr, ((b.rpc * 7) / Math.max(dist, 1e-30)) * pxPerRad);
        const size = (px / pxPerRad) * dist;
        g.sprite.position.set(rel[0], rel[1], rel[2]);
        g.sprite.scale.set(size, size, 1);
        g.uGain.value = fade;
        g.sprite.visible = fade > 0.003;
      }
      if (b.orbit) {
        const o = b.orbit;
        o.line.position.set(parentPos[0] - cam[0], parentPos[1] - cam[1], parentPos[2] - cam[2]);
        const orbitPx = (sep / Math.max(Math.hypot(parentPos[0] - cam[0], parentPos[1] - cam[1], parentPos[2] - cam[2]), 1e-30)) * pxPerRad;
        // an orbit is context for the scale of its system: it fades when you zoom in on a single body
        o.uAlpha.value = fade * 0.32 * smooth(8, 30, orbitPx) * smooth(sep * 0.01, sep * 0.06, u.focusDist);
        o.line.visible = o.uAlpha.value > 0.003;
      }
      const sc = vis > 0.05 ? project(p) : null;
      b.screen = sc ? { ...sc, rpx: (s / dist) * pxCss, dist } : null;
      // true (not inflated) radius: the texture starts to show through the dot colour below ~1 device px
      if (b.screen && vis > 0.003 && (b.rpc / dist) * pxCss > TEX_MIN_PX) {
        const q = this.texQueue.get(b.def.id);
        if (q) {
          this.texQueue.delete(b.def.id);
          for (const load of q) load();
        }
      }
      b.entry.dist_pc = Math.hypot(...p);
      // labels hide when the body sits within ~10 css px of its parent (LabelLayer: 2·size/r·f < 1)
      b.label.sizePc = b.def.id === 'sun' ? 1e-3 : sep / 20;
      if (timeChanged || fadeChanged) {
        const surf = b.def.id === 'earth' ? 0.465 * PC_PER_KM * ((ms - (this.lastScreenMs || ms)) / 1000) : 0; // rotation at the equator
        const prev = this.lastScreen.get(b);
        if (sc && prev) maxMove = Math.max(maxMove, Math.hypot(sc.x - prev.x, sc.y - prev.y), (surf / dist) * pxCss);
        else if (sc || prev) maxMove = Math.max(maxMove, 1);
      }
      if (sc) this.lastScreen.set(b, sc);
      else this.lastScreen.delete(b);
    }
    this.lastScreenMs = ms;
    this.tileCache.end();
    this.placeFeatures(cam, frames, pxCss, W);

    // Earth: sharper texture once it is big on screen
    const earth = this.bodies.find((b) => b.def.id === 'earth')!;
    if (this.earth4k === 'no' && earth.screen && earth.screen.rpx > 280) {
      this.earth4k = 'loading';
      this.loadTex('earth_4096.jpg', (tex) => {
        earth.texNode.value = tex;
        this.earth4k = 'yes';
        this.drawnMs = NaN;
      });
    }

    for (const c of this.crafts) {
      const r = interpolateTrack(c.data.track, jd, c.pos);
      c.on = !!r;
      if (r) c.vel = r.vel;
      const rel: Vec3 = [c.pos[0] - cam[0], c.pos[1] - cam[1], c.pos[2] - cam[2]];
      const dist = Math.hypot(...rel);
      const rSun = Math.hypot(...c.pos);
      const sepPx = (rSun / Math.max(dist, 1e-30)) * pxPerRad;
      c.alpha = c.on ? fade * smooth(3, 9, sepPx) : 0;
      c.uAlpha.value = c.alpha;
      const size = ((5 * u.dpr) / pxPerRad) * dist;
      c.sprite.position.set(rel[0], rel[1], rel[2]);
      c.sprite.scale.set(size, size, 1);
      c.sprite.visible = c.alpha > 0.003;
      c.entry.dist_pc = rSun;
      c.label.sizePc = c.on ? rSun / 20 : 0;
      // trail: track samples up to now, ending at the current position
      const t = c.data.track;
      const k = Math.floor((jd - t.t0_jd_tdb) / t.step_days);
      if (c.on) {
        const a = c.trailAttr.array as Float32Array;
        if (k !== c.trailK) {
          for (let i = 0; i <= Math.min(k, t.n - 1) * 3 + 2; i++) a[i] = t.xyz_pc[i];
          c.trailK = k;
        }
        const last = Math.min(k, t.n - 1) + 1;
        a[last * 3] = c.pos[0];
        a[last * 3 + 1] = c.pos[1];
        a[last * 3 + 2] = c.pos[2];
        c.trailAttr.needsUpdate = true;
        c.trail.geometry.setDrawRange(0, last + 1);
      }
      c.trail.position.set(-cam[0], -cam[1], -cam[2]);
      c.uTrail.value = c.alpha * 0.28 * smooth(rSun * 0.01, rSun * 0.06, u.focusDist);
      c.trail.visible = c.on && c.alpha > 0.003;
      const sc = c.alpha > 0.05 ? project(c.pos) : null;
      c.screen = sc ? { ...sc, rpx: 2.5, dist } : null;
      if (timeChanged || fadeChanged) {
        const prev = this.lastScreen.get(c);
        if (sc && prev) maxMove = Math.max(maxMove, Math.hypot(sc.x - prev.x, sc.y - prev.y));
        else if (sc || prev) maxMove = Math.max(maxMove, 1);
      }
      if (sc) this.lastScreen.set(c, sc);
      else this.lastScreen.delete(c);
    }
    return maxMove > 0.25;
  }
  private lastScreenMs = 0;

  /** feature labels: on the body at this frame's rotation, shown on the near side when big enough */
  private placeFeatures(cam: Vec3, frames: Map<BodyId, BodyFrame>, pxCss: number, W: number) {
    for (const fr of this.features) {
      const id = fr.f.body;
      const b = this.bodyR(id);
      const xyz = fr.entry.xyz;
      const surf = this.surfaces.get(id);
      const f = frames.get(id);
      if (!surf?.active || !f) {
        xyz[0] = b.pos[0];
        xyz[1] = b.pos[1];
        xyz[2] = b.pos[2];
        fr.label.hidden = true;
        continue;
      }
      const n = bodyToGal(f, fr.nB);
      xyz[0] = b.pos[0] + n[0] * b.rpc;
      xyz[1] = b.pos[1] + n[1] * b.rpc;
      xyz[2] = b.pos[2] + n[2] * b.rpc;
      fr.entry.dist_pc = Math.hypot(...xyz);
      const t: Vec3 = [cam[0] - xyz[0], cam[1] - xyz[1], cam[2] - xyz[2]];
      const r = Math.hypot(...t);
      const above = n[0] * t[0] + n[1] * t[1] + n[2] * t[2] > 0.02 * r;
      const sizePx = ((labelSizeKm(fr.f) * PC_PER_KM) / Math.max(r, 1e-30)) * pxCss;
      fr.label.hidden = !above || sizePx < 22 || sizePx > 3 * W;
    }
  }

  /** the closest drawn surface to the eye (pc), for the near plane */
  nearestSurfacePc(cam: Vec3): number {
    let best = Infinity;
    if (!this.root.visible) return best;
    for (const b of this.bodies) {
      if (b.alpha <= 0) continue;
      best = Math.min(best, Math.max(0, Math.hypot(b.pos[0] - cam[0], b.pos[1] - cam[1], b.pos[2] - cam[2]) - b.rpc * 2.4));
    }
    return best;
  }

  // ------------------------------------------------------------------ following a body

  /**
   * Keep the camera focus on a body while it moves (time running). The offset between focus and
   * body is preserved, so orbiting and zooming still work; flying or panning far away releases it.
   */
  /** lock the focus to a body from now on (the focus must already be on it, at the current time) */
  attach(id: BodyId | null) {
    this.followId = id;
    this.lastFollow = null;
    this.lastFollowId = null;
    this.lastFrame = null; // the view was just set at the current rotation: nothing to turn yet
  }

  follow(nav: { view: { focus: Vec3; dist: number; yaw: number; pitch: number }; flying: boolean; distFloor: number }) {
    this.advance(); // positions for this frame first, so the focus does not lag the body
    const id = this.followId;
    if (!id) {
      nav.distFloor = 0;
      this.lastFollow = null;
      return;
    }
    const p = this.pos[id];
    const b = this.bodyR(id);
    if (nav.flying) {
      // any flight (search, home, tour) releases the body; flights to a body re-attach on arrival
      this.followId = null;
      this.lastFollow = null;
      nav.distFloor = 0;
      return;
    }
    if (this.lastFollowId !== id) {
      this.lastFollow = null;
      this.lastFollowId = id;
    }
    if (this.lastFollow) {
      for (let k = 0; k < 3; k++) nav.view.focus[k] += p[k] - this.lastFollow[k];
    }
    this.lastFollow = [...p] as Vec3;
    let off = Math.hypot(nav.view.focus[0] - p[0], nav.view.focus[1] - p[1], nav.view.focus[2] - p[2]);
    // a focus on the surface turns with the body (a crater stays under the camera while time runs)
    const fr = bodyFrame(id, astroTime(this.simMs));
    const lf = this.lastFrame?.id === id ? this.lastFrame.f : null;
    if (lf && off > 0.5 * b.rpc && off < 1.5 * b.rpc && lf.x[0] !== fr.x[0]) {
      const rel = bodyToGal(fr, galToBody(lf, [nav.view.focus[0] - p[0], nav.view.focus[1] - p[1], nav.view.focus[2] - p[2]]));
      for (let k = 0; k < 3; k++) nav.view.focus[k] = p[k] + rel[k];
      const cp = Math.cos(nav.view.pitch);
      const d = bodyToGal(fr, galToBody(lf, [cp * Math.cos(nav.view.yaw), cp * Math.sin(nav.view.yaw), Math.sin(nav.view.pitch)]));
      nav.view.yaw = Math.atan2(d[1], d[0]);
      nav.view.pitch = Math.asin(Math.max(-1, Math.min(1, d[2])));
      off = Math.hypot(...rel);
    }
    this.lastFrame = { id, f: fr };
    // panned or zoomed away from the body: let it go
    if (off > Math.max(0.5 * nav.view.dist, 3 * b.rpc)) {
      this.followId = null;
      nav.distFloor = 0;
      return;
    }
    // do not let the camera dive into the followed body. With the focus near the centre the camera
    // must stay outside the whole sphere; with the focus on the surface (a place on Earth, looked at
    // from above) it only has to stay a little above the ground.
    // Bodies with streamed imagery (Moon, Mars) let the camera down to SURFACE_MIN_ALT_KM.
    const minAlt = this.surfaces.has(id) ? SURFACE_MIN_ALT_KM * PC_PER_KM : b.rpc * 0.022;
    nav.distFloor = off < 0.5 * b.rpc ? b.rpc * 1.08 : off < b.rpc * 1.02 ? b.rpc - off + minAlt : 0;
  }

  // ------------------------------------------------------------------ picking

  /** CPU pick in css px: the body or probe under the cursor (within 8 px), nearest to the eye first */
  pickAt(x: number, y: number): SolarEntry | null {
    if (!this.root.visible) return null;
    let best: { e: SolarEntry; score: number } | null = null;
    const consider = (e: SolarEntry, s: { x: number; y: number; rpx: number; dist: number } | null) => {
      if (!s) return;
      const d = Math.hypot(s.x - x, s.y - y);
      const reach = Math.max(s.rpx, 8);
      if (d > reach) return;
      // inside a disc: nearest to the eye wins; otherwise the closest to the cursor
      const score = d <= s.rpx ? s.dist * 1e-30 : d;
      if (!best || score < best.score) best = { e, score };
    };
    for (const b of this.bodies) consider(b.entry, b.screen);
    for (const c of this.crafts) consider(c.entry, c.screen);
    return (best as { e: SolarEntry } | null)?.e ?? null;
  }

  // ------------------------------------------------------------------ views

  /** a flight target that frames the body, seen from its day side */
  viewFor(e: SolarEntry): { focus: Vec3; dist: number; yaw: number; pitch: number } {
    this.advance(); // the clock may have jumped since the last frame
    if (e.solar.type === 'craft') {
      const p = e.xyz;
      const r = Math.hypot(...p) || 1;
      return { focus: [...p] as Vec3, dist: 0.6 * PC_PER_AU, yaw: Math.atan2(-p[1] / r, -p[0] / r) + 0.6, pitch: 0.35 };
    }
    if (e.solar.type === 'feature') {
      // straight down onto the feature, from an altitude that frames it
      const fr = this.features[e.solar.index];
      const b = this.bodyR(fr.f.body);
      const focus = this.featurePos(e);
      const n = [0, 1, 2].map((k) => (focus[k] - b.pos[k]) / b.rpc);
      return { focus, dist: viewAltitudeKm(fr.f, b.def.radiusKm) * PC_PER_KM, yaw: Math.atan2(n[1], n[0]), pitch: Math.asin(Math.max(-1, Math.min(1, n[2]))) };
    }
    const id = e.solar.id;
    const def = BODY_BY_ID.get(id)!;
    const p = this.pos[id];
    const r = def.radiusKm * PC_PER_KM;
    const dist = id === 'sun' ? r * 6 : def.rings ? r * 7 : r * 4.2;
    if (id === 'sun') return { focus: [0, 0, 0], dist, yaw: -2.6, pitch: 0.35 };
    // camera 35° off the Sun direction: mostly lit, with a visible terminator
    const sun = [-p[0], -p[1], -p[2]];
    const n = Math.hypot(sun[0], sun[1], sun[2]);
    const yaw = Math.atan2(sun[1] / n, sun[0] / n) + 0.6;
    const pitch = Math.asin(sun[2] / n) + 0.25;
    return { focus: [...p] as Vec3, dist, yaw, pitch };
  }

  bodyIdOf(e: SolarEntry): BodyId | null {
    return e.solar.type === 'body' || e.solar.type === 'feature' ? e.solar.id : null;
  }

  /** where the focus goes once a flight to `e` lands (the body moved meanwhile): its centre, or the feature */
  focusAfterFlight(e: SolarEntry): Vec3 {
    this.advance();
    if (e.solar.type === 'feature') return this.featurePos(e);
    const id = this.bodyIdOf(e);
    return id ? ([...this.pos[id]] as Vec3) : ([...e.xyz] as Vec3);
  }

  /** a view straight down onto (lat, east lon) of a body from `altKm` above its mean sphere */
  surfaceView(id: BodyId, lat: number, lon: number, altKm: number): { focus: Vec3; dist: number; yaw: number; pitch: number } {
    this.advance();
    const b = this.bodyR(id);
    const n = bodyToGal(bodyFrame(id, astroTime(this.simMs)), latLonToBody(lat, lon));
    const focus: Vec3 = [b.pos[0] + n[0] * b.rpc, b.pos[1] + n[1] * b.rpc, b.pos[2] + n[2] * b.rpc];
    return { focus, dist: altKm * PC_PER_KM, yaw: Math.atan2(n[1], n[0]), pitch: Math.asin(Math.max(-1, Math.min(1, n[2]))) };
  }

  /** elevation of the Sun's centre (deg) above the local horizon of a surface point, now */
  sunElevation(id: BodyId, lat: number, lon: number): number {
    this.advance();
    const b = this.bodyR(id);
    const n = bodyToGal(bodyFrame(id, astroTime(this.simMs)), latLonToBody(lat, lon));
    const s = [-b.pos[0], -b.pos[1], -b.pos[2]];
    const r = Math.hypot(s[0], s[1], s[2]);
    return (Math.asin((n[0] * s[0] + n[1] * s[1] + n[2] * s[2]) / r) * 180) / Math.PI;
  }

  craftOf(e: SolarEntry): CraftR | null {
    return e.solar.type === 'craft' ? this.crafts.find((c) => c.entry === e) ?? null : null;
  }

  spanOf(c: CraftR): [number, number] {
    return trackSpan(c.data.track);
  }
}
