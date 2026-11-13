import '@fontsource/spectral/400.css';
import '@fontsource/spectral/400-italic.css';
import '@fontsource/spectral/500.css';
import '@fontsource/spectral/500-italic.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import './style.css';

import * as THREE from 'three/webgpu';
import {
  isPointLayer, loadCatalogs, loadManifest, loadTilesIndex, type CatalogEntry, type LayerConfig, type Manifest, type TilesIndex,
} from './data/manifest';
import { normName, resolveSesame, searchCatalog, viewDistanceFor, type Resolved } from './data/resolve';
import { galToLB, galToRadec, radecDistToGal, type Vec3 } from './math/frames';
import { describeLookback, fmtNum, formatDistance, formatLightTime, formatLy, niceScaleBar } from './math/units';
import { NavController, type View } from './nav/controller';
import { absMagFromLum, galaxyRadiusPc } from './render/brightness';
import { DEFAULT_EXPOSURE, binCounts, exposureFromCounts, smoothExposure, type SamplePoints } from './render/exposure';
import { DENSITY_SPRITE_PX, SLAB_OFF } from './render/pointMaterial';
import { LabelLayer, type LabelItem } from './render/labels';
import { MilkyWayModel, R0_PC } from './render/milkyway';
import { GpuPicker } from './render/pick';
import { PostPass } from './render/post';
import { formatHash, parseHash, type SelRef } from './state/hash';
import { findExtId, nodePath, parseRenderRecords, readExtRecord } from './tiles/format';
import { NodeState, PointLayer, Streamer, type TileNode } from './tiles/streamer';
import { SCALE_TOUR, resolveBeat, type Tour, type TourContext } from './tour/tours';
import { ScaleRail } from './ui/rail';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const DEG = 180 / Math.PI;

/** auto-exposure: reference magnitude rises with the viewing scale, per layer kind */
const AUTO_EXPOSURE = {
  star: { base: 5.5, perDecade: 0.9 },
  galaxy: { base: -20.5, perDecade: 3.9 },
};
/** at most this many frames queued on the GPU (WebGPU backend); skymap measured ~7 deep uncapped */
const MAX_FRAMES_IN_FLIGHT = 2;

interface Selection {
  xyz: Vec3;
  title: string;
  fly: Partial<View>;
  ref: SelRef | null;
  /** 16th / 84th percentile distances from the Sun, pc */
  lo?: number;
  hi?: number;
}

class App {
  renderer!: THREE.WebGPURenderer;
  backend: 'WebGPU' | 'WebGL2' = 'WebGL2';
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(55, 1, 1e-9, 1e12);
  nav!: NavController;
  post!: PostPass;
  picker!: GpuPicker;
  streamer = new Streamer();
  layers: PointLayer[] = [];
  mw = new MilkyWayModel();
  mwCfg: LayerConfig | null = null;
  skyCfg: LayerConfig | null = null;
  sky = { visible: true, opacity: 1, loaded: false };
  labels!: LabelLayer;
  rail!: ScaleRail;
  catalog: CatalogEntry[] = [];
  manifest!: Manifest;
  tilesIndex: TilesIndex | null = null;
  exposure = 0;
  frame = 0;
  fps = 0;
  /** render every frame even when nothing changes (benchmarks) */
  continuous = false;
  /** thin slab through the focus, perpendicular to the view: half-thickness in Mpc (0 = off) */
  slabMpc = 0;
  private slabWanted = 80;
  /** galaxy density-mode exposure (smoothed) and when it was last estimated */
  private densityK = 0;
  private densityTarget = 0;
  private lastExposureT = 0;
  private densityInfo = { p98: 0, k: 0 };
  private renders = 0;
  private fpsT0 = performance.now();
  private lastT = performance.now();
  private dpr = 1;
  private frustum = new THREE.Frustum();
  private pv = new THREE.Matrix4();
  private selection: Selection | null = null;
  private hashTimer = 0;
  private lastUi = 0;
  private tourAbort: ((restoreView: boolean) => void) | null = null;
  private dirty = true;
  private skyAmount = 0;
  private mwFade = 0;
  private inFlight = 0;
  private pendingSel: SelRef | null = null;
  private layersReady: Promise<void> = Promise.resolve();

  async start() {
    const canvas = $<HTMLCanvasElement>('view');
    // WebGPU first; three.js falls back to its WebGL2 backend by itself. ?backend=webgl forces it.
    const forceWebGL = new URLSearchParams(location.search).get('backend') === 'webgl';
    try {
      this.renderer = new THREE.WebGPURenderer({
        canvas,
        antialias: false,
        alpha: false,
        logarithmicDepthBuffer: true,
        powerPreference: 'high-performance',
        forceWebGL,
      });
      await this.renderer.init();
    } catch (e) {
      this.status(`Neither WebGPU nor WebGL 2 is available in this browser, so the map cannot be drawn. (${(e as Error).message})`, 'warn');
      return;
    }
    const be = (this.renderer as unknown as { backend: { isWebGPUBackend?: boolean } }).backend;
    this.backend = be.isWebGPUBackend ? 'WebGPU' : 'WebGL2';
    this.renderer.setClearColor(0x000000, 0);
    this.camera.up.set(0, 0, 1);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(this.dpr);
    this.post = new PostPass(this.renderer, this.scene, this.camera);
    this.picker = new GpuPicker(this.renderer, this.camera);
    this.nav = new NavController(canvas, this.camera);
    this.labels = new LabelLayer($('labels'));
    this.rail = new ScaleRail($('rail'), $('rail-ticks'), $('rail-mark'));
    this.scene.add(this.mw.points);
    this.resize();
    window.addEventListener('resize', () => this.resize());

    this.wireUi();
    this.nav.onChange = () => (this.dirty = true);
    this.nav.onUserInput = () => this.stopTour(false);
    this.nav.onClick = (x, y) => void this.pick(x, y, false);
    this.nav.onDoubleClick = (x, y) => void this.pick(x, y, true);
    this.streamer.onLoaded = () => (this.dirty = true);

    const h = parseHash(location.hash);
    if (h.view) this.applyHashView(h.view, false);
    else this.nav.setView({ focus: [0, 0, 0], dist: 6, yaw: (-150 * Math.PI) / 180, pitch: 0.38 });
    this.pendingSel = h.sel ?? null;
    if (h.slab) this.setSlab(h.slab);
    window.addEventListener('hashchange', () => this.onHashChange());

    requestAnimationFrame(this.loop);

    try {
      this.manifest = await loadManifest();
    } catch (e) {
      this.status(`Could not load layers.json: ${(e as Error).message}`, 'warn');
      return;
    }
    this.tilesIndex = await loadTilesIndex();
    this.layersReady = this.initLayers(h.layers);
    await this.layersReady;
    await this.initCatalogs();
    this.exposeDebugApi();
    if (this.pendingSel) void this.restoreSelection(this.pendingSel);
  }

  // ------------------------------------------------------------------ layers

  private async initLayers(hashLayers?: Record<string, boolean>) {
    let code = 1;
    for (const cfg of this.manifest.layers) {
      const vis = hashLayers?.[cfg.id];
      if (isPointLayer(cfg)) {
        const L = new PointLayer(cfg, code++);
        if (vis !== undefined) L.visible = vis;
        this.layers.push(L);
        this.scene.add(L.group);
        this.picker.scene.add(L.pickGroup);
      } else if (cfg.type === 'milky-way-model') {
        this.mwCfg = cfg;
        this.mw.visible = vis ?? cfg.visible;
      } else if (cfg.type === 'sky') {
        this.skyCfg = cfg;
        this.sky.visible = vis ?? cfg.visible;
        this.loadSky(cfg.image ?? 'sky/gaia_dr3_sky_l9.jpg');
      }
    }
    const known = this.tilesIndex ? new Set(this.tilesIndex.layers) : undefined;
    await Promise.all(this.layers.map((L) => L.init(known)));
    // dev layers step aside when the real layer they stand in for exists
    for (const L of this.layers) {
      if (L.cfg.fallbackFor) L.superseded = this.layers.some((o) => o.cfg.id === L.cfg.fallbackFor && o.status === 'ready');
      if (L.status === 'error') console.error(`[layers] ${L.cfg.id}: ${L.error}`);
    }
    this.streamer.layers = this.layers;
    this.renderLayerPanel();
    this.dirty = true;
  }

  private loadSky(url: string) {
    new THREE.TextureLoader().load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace; // decoded to linear on sampling
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        const img = tex.image as HTMLImageElement;
        this.post.setSky(tex, img.width, img.height);
        this.sky.loaded = true;
        this.dirty = true;
      },
      undefined,
      () => console.warn(`[sky] could not load ${url}`),
    );
  }

  private layerVisibility(): Record<string, boolean> {
    const out: Record<string, boolean> = {};
    for (const L of this.layers) if (L.status === 'ready' && !L.superseded) out[L.cfg.id] = L.visible;
    if (this.mwCfg) out[this.mwCfg.id] = this.mw.visible;
    if (this.skyCfg) out[this.skyCfg.id] = this.sky.visible;
    return out;
  }

  private setLayerVisible(id: string, on: boolean) {
    const L = this.layers.find((l) => l.cfg.id === id);
    if (L) {
      L.visible = on;
      if (!on) this.streamer.releaseLayer(L);
    } else if (this.mwCfg?.id === id) this.mw.visible = on;
    else if (this.skyCfg?.id === id) this.sky.visible = on;
    const cb = document.getElementById(`lyr-${id}`) as HTMLInputElement | null;
    if (cb && cb.checked !== on) {
      cb.checked = on;
      const rg = cb.closest('li')?.querySelector<HTMLInputElement>('input[type=range]');
      if (rg) rg.hidden = !on;
    }
    this.dirty = true;
  }

  private renderLayerPanel() {
    const list = $('layer-list');
    list.textContent = '';
    const missing: string[] = [];
    const row = (opts: {
      id: string; title: string; swatch: string; tag?: [string, string]; meta: string; checked: boolean; opacity: number;
      onOpacity: (v: number) => void;
    }) => {
      const li = document.createElement('li');
      li.className = 'layer';
      const cid = `lyr-${opts.id}`;
      li.innerHTML = `
        <div class="layer-row">
          <span class="swatch ${opts.swatch}" aria-hidden="true"></span>
          <label class="layer-title" for="${cid}"><b></b></label>
          <input id="${cid}" class="toggle" type="checkbox" role="switch" />
        </div>
        <p class="fine meta"></p>
        <input type="range" min="0" max="1" step="0.05" aria-label="" />`;
      const b = li.querySelector('b')!;
      b.textContent = opts.title;
      if (opts.tag) {
        const t = document.createElement('span');
        t.className = `tag ${opts.tag[0]}`;
        t.textContent = opts.tag[1];
        b.after(t);
      }
      li.querySelector('.meta')!.textContent = opts.meta;
      const cb = li.querySelector<HTMLInputElement>('.toggle')!;
      cb.checked = opts.checked;
      const rg = li.querySelector<HTMLInputElement>('input[type=range]')!;
      rg.value = String(opts.opacity);
      rg.setAttribute('aria-label', `${opts.title} opacity`);
      rg.hidden = !opts.checked;
      cb.addEventListener('change', () => this.setLayerVisible(opts.id, cb.checked));
      rg.addEventListener('input', () => {
        opts.onOpacity(+rg.value);
        this.dirty = true;
      });
      list.appendChild(li);
    };

    for (const L of this.layers) {
      if (L.status === 'missing' || L.status === 'error') {
        missing.push(L.cfg.title + (L.status === 'error' ? ' (invalid)' : ''));
        continue;
      }
      if (L.status !== 'ready' || L.superseded) continue;
      const m = L.meta!;
      const n = m.count >= 1e5 ? `${fmtNum(m.count / 1e6, 3)} million` : m.count.toLocaleString('en-US');
      row({
        id: L.cfg.id,
        title: L.cfg.title,
        swatch: L.kind,
        tag: L.cfg.dev ? ['synthetic', 'synthetic'] : undefined,
        meta: `${n} ${L.kind === 'star' ? 'stars' : 'galaxies'}${L.cfg.credit ? `, ${L.cfg.credit}` : ''}`,
        checked: L.visible,
        opacity: L.opacity,
        onOpacity: (v) => (L.opacity = v),
      });
    }
    if (this.mwCfg) {
      row({
        id: this.mwCfg.id, title: this.mwCfg.title, swatch: 'model', tag: ['model', 'model'],
        meta: this.mwCfg.credit ?? 'Spiral arms after Reid et al. 2019', checked: this.mw.visible, opacity: this.mw.opacity,
        onOpacity: (v) => (this.mw.opacity = v),
      });
    }
    if (this.skyCfg) {
      row({
        id: this.skyCfg.id, title: this.skyCfg.title, swatch: 'sky',
        meta: this.skyCfg.credit ?? '', checked: this.sky.visible, opacity: this.sky.opacity,
        onOpacity: (v) => (this.sky.opacity = v),
      });
    }
    $('layer-missing').textContent = missing.length ? `Not built yet: ${missing.join(', ')}.` : '';
    $('credits').innerHTML = '';
    const credits = [
      ...this.layers.filter((L) => L.status === 'ready' && !L.superseded).map((L) => `${L.cfg.title}: ${L.cfg.credit ?? (L.cfg.dev ? 'synthetic development data, not observations' : L.meta?.title ?? '')}`),
      this.mwCfg ? `${this.mwCfg.title}: ${this.mwCfg.credit}` : '',
      this.skyCfg ? `${this.skyCfg.title}: ${this.skyCfg.credit}` : '',
      'Name resolution: CDS Sesame (via the VizieR mirror at CfA). Distances for redshifts use Planck18 comoving distance.',
      'Rendering techniques (subtree blobs, solid-angle photometry, GPU picking, label declutter) adapted from skymap by Alexander Rulkens (MIT).',
    ].filter(Boolean);
    for (const c of credits) {
      const p = document.createElement('span');
      p.textContent = c;
      $('credits').append(p, document.createElement('br'));
    }
  }

  // ------------------------------------------------------------------ catalogues & labels

  private async initCatalogs() {
    let urls = this.manifest.catalogs ?? [];
    if (this.tilesIndex) {
      const have = new Set(this.tilesIndex.catalogs);
      urls = urls.filter((u) => have.has(u.split('/').pop()!));
    }
    const { entries } = await loadCatalogs(urls);
    this.catalog = entries;
    const items: LabelItem[] = [];
    for (const e of entries) {
      if (!e.xyz) continue;
      const d = e.dist_pc;
      const absMag = e.mag !== null && e.mag !== undefined && d > 0 ? e.mag - 5 * Math.log10(d / 10) : null;
      const isMw = /^milky way/i.test(e.name);
      const sizePc = isMw ? 15000 : e.kind === 'galaxy' || e.kind === 'qso' ? (absMag !== null ? galaxyRadiusPc(absMag) : 10000)
        : e.kind === 'lg_galaxy' ? (absMag !== null ? Math.min(galaxyRadiusPc(absMag), 20000) : 1500) : e.kind === 'cluster' ? 5 : undefined;
      items.push({
        sizePc,
        name: e.name,
        xyz: e.xyz,
        kind: e.kind,
        absMag: e.name === 'Sun' ? 4.83 : absMag,
        // the Sun is labelled up to Milky Way scale; whole-galaxy entries only beyond it
        ...(e.name === 'Sun' ? { maxScale: 2e5 } : /^milky way/i.test(e.name) ? { minScale: 2e5, maxScale: Infinity } : {}),
        onClick: () => this.showCatalogEntry(e),
      });
    }
    if (!entries.some((e) => /^milky way/i.test(e.name))) items.push({ name: 'Milky Way', xyz: [R0_PC, 0, 0], kind: 'galaxy', absMag: -20.8, minScale: 2e5, sizePc: 15000,
      onClick: () => this.nav.flyTo({ focus: [R0_PC, 0, 0], dist: 6e4, pitch: 1.5 }) });
    for (const m of this.mw.labels) items.push({ name: m.name, xyz: m.xyz, kind: 'model', absMag: null, minScale: 4000, maxScale: 2e5, sizePc: 2000 });
    this.labels.setItems(items);
    this.dirty = true;
  }

  private findCatalog(names: string[]): CatalogEntry | null {
    const keys = names.map(normName);
    return this.catalog.find((e) => e.xyz && [e.name, ...(e.alt ?? [])].some((n) => keys.includes(normName(n)))) ?? null;
  }

  // ------------------------------------------------------------------ frame loop

  private resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  private pxPerRad() {
    return (this.renderer.domElement.height / 2) / Math.tan((this.camera.fov * Math.PI) / 360);
  }

  private loop = (t: number) => {
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (t - this.lastT) / 1000);
    this.lastT = t;
    this.frame++;
    if (t - this.fpsT0 > 1000) {
      this.fps = (this.renders * 1000) / (t - this.fpsT0);
      this.renders = 0;
      this.fpsT0 = t;
    }
    const moved = this.nav.update(dt);
    this.nav.applyToCamera();
    const cam = this.nav.camPos();
    const D = this.nav.view.dist;

    // render on demand: only when something changed, a fade is running, or benchmarking
    const settling = this.densityK > 0 && Math.abs(Math.log(this.densityK / (this.densityTarget || this.densityK))) > 0.01;
    const want = this.continuous || this.dirty || moved || this.nav.flying || this.streamer.stats.fading || settling;
    const gpuFree = this.backend !== 'WebGPU' || this.inFlight < MAX_FRAMES_IN_FLIGHT;
    if (want && gpuFree) {
      this.dirty = false;
      this.renderFrame(cam, D, dt);
      clearTimeout(this.hashTimer);
      this.hashTimer = window.setTimeout(() => this.writeHash(), 400);
    }
    this.labels.modelOpacity = this.mwFade * (this.mw.visible ? 1 : 0);
    if (want || this.labels.animating) this.labels.update(this.camera, cam, D, window.innerWidth, window.innerHeight, this.occluders(), dt);
    this.updateOverlay(cam);
    if (t - this.lastUi > 120) {
      this.lastUi = t;
      this.updateReadouts(D, this.streamer.stats);
    }
  };

  private renderFrame(cam: Vec3, D: number, dt: number) {
    const pxPerRad = this.pxPerRad();
    // frustum in relative-to-eye space
    this.camera.near = 1e-9;
    this.camera.far = 1e12;
    this.camera.updateProjectionMatrix();
    this.pv.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pv);
    const st = this.streamer.update({ camPos: cam, frustum: this.frustum, pxPerRad, frame: this.frame, dt });

    // adaptive near/far from the nearest / farthest drawn node (contract section 5)
    const nearest = Math.min(st.nearestPc, D);
    this.camera.near = Math.max(1e-10, Math.min(nearest * 0.5, D * 1e-3));
    this.camera.far = Math.max(this.camera.near * 1e6, st.farthestPc * 2, D * 1e3, 1e11);
    this.camera.updateProjectionMatrix();

    const logD = Math.log10(Math.max(D, 1e-9));
    // galaxies switch from flux photometry to density mode between 10 and 40 Mpc of camera distance
    const densityMix = smoothstep(7.0, 7.6, logD);
    const slabHalf = this.slabMpc > 0 ? this.slabMpc * 1e6 : SLAB_OFF;
    if (densityMix > 0) this.updateDensityExposure(cam, pxPerRad, dt);
    // view-space Sun, for line-of-sight streaks (float64 rotate, then narrow)
    const sunView = new THREE.Vector3(-cam[0], -cam[1], -cam[2]).applyMatrix4(this.camera.matrixWorldInverse);
    for (const L of this.layers) {
      const u = L.uniforms;
      const ae = AUTO_EXPOSURE[L.kind];
      u.mRef.value = ae.base + ae.perDecade * Math.max(-2, logD) + this.exposure + (L.cfg.magOffset ?? 0);
      u.pxPerRad.value = pxPerRad;
      u.dpr.value = this.dpr;
      u.opacity.value = L.opacity;
      u.sunView.value.copy(sunView);
      u.densityMix.value = L.kind === 'galaxy' ? densityMix : 0;
      u.densityK.value = this.densityK || 0.3;
      u.slabZ.value = -D; // the focus sits at view-space z = −D
      u.slabHalf.value = slabHalf;
    }
    this.mwFade = this.mw.update(cam, pxPerRad, this.dpr);
    const camFromSun = Math.hypot(cam[0], cam[1], cam[2]);
    const skyFade = 1 - smoothstep(1500, 2500, camFromSun);
    this.skyAmount = this.sky.visible && this.sky.loaded ? this.sky.opacity * skyFade : 0;

    this.post.render(this.camera, this.skyAmount);
    this.renders++;
    // frames-in-flight cap (WebGPU): count submitted work until the queue reports it done
    if (this.backend === 'WebGPU') {
      const dev = (this.renderer as unknown as { backend: { device?: GPUDevice } }).backend.device;
      if (dev) {
        this.inFlight++;
        dev.queue.onSubmittedWorkDone().then(() => (this.inFlight = Math.max(0, this.inFlight - 1)));
      }
    }
  }

  /** 98th-percentile screen density of the drawn galaxies → density-mode exposure (4 Hz) */
  private updateDensityExposure(cam: Vec3, pxPerRad: number, dt: number) {
    const now = performance.now();
    if (now - this.lastExposureT > 250 || !this.densityTarget) {
      this.lastExposureT = now;
      const nodes: SamplePoints[] = [];
      for (const n of this.streamer.drawn()) {
        if (n.layer.kind !== 'galaxy' || !n.data || !n.layer.active) continue;
        const c = n.meta.center;
        nodes.push({ rel: [c[0] - cam[0], c[1] - cam[1], c[2] - cam[2]], positions: n.data.positions, count: n.meta.count, alpha: n.ownAlpha });
      }
      const e = this.camera.matrixWorldInverse.elements; // column-major → row-major rotation
      const W = this.renderer.domElement.width;
      const H = this.renderer.domElement.height;
      const bins = binCounts(nodes, {
        rot: [e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]], f: pxPerRad, width: W, height: H,
        slabZ: -this.nav.view.dist, slabHalf: this.slabMpc > 0 ? this.slabMpc * 1e6 : SLAB_OFF,
      }, 150_000);
      const r = exposureFromCounts(bins, W, H, { ...DEFAULT_EXPOSURE, spritePx: DENSITY_SPRITE_PX * this.dpr });
      this.densityTarget = r.k * Math.pow(10, 0.4 * this.exposure);
      this.densityInfo = { p98: r.p98, k: r.k };
    }
    this.densityK = smoothExposure(this.densityK, this.densityTarget, dt);
  }

  setSlab(halfMpc: number) {
    this.slabMpc = halfMpc;
    if (halfMpc > 0) this.slabWanted = halfMpc;
    const cb = document.getElementById('slab-on') as HTMLInputElement | null;
    const rg = document.getElementById('slab') as HTMLInputElement | null;
    if (cb) cb.checked = halfMpc > 0;
    if (rg) {
      rg.value = String(this.slabWanted);
      rg.disabled = !(halfMpc > 0);
    }
    const out = document.getElementById('slab-out');
    if (out) out.textContent = `±${this.slabWanted} Mpc`;
    this.dirty = true;
    this.scheduleHash();
  }

  // ------------------------------------------------------------------ readouts & overlays

  private updateReadouts(D: number, st: Streamer['stats']) {
    const hCss = window.innerHeight;
    const pcPerPx = (2 * D * Math.tan((this.camera.fov * Math.PI) / 360)) / hCss;
    const sb = niceScaleBar(pcPerPx, window.innerWidth < 640 ? 110 : 170);
    ($('bar').style.width = `${Math.max(8, sb.px).toFixed(1)}px`);
    $('bar-label').textContent = sb.label;
    $('bar-light').textContent = sb.pc < 0.05 ? formatLightTime(sb.pc) : formatLy(sb.pc) || formatLightTime(sb.pc);
    this.rail.set(Math.log10(D), `Camera ${formatDistance(D)} from focus`);

    const f = this.nav.view.focus;
    const fd = Math.hypot(f[0], f[1], f[2]);
    if (fd < Math.max(1e-6, D * 1e-3)) {
      $('focus-where').textContent = 'Focus on the Sun';
      $('focus-lookback').textContent = `Camera ${formatDistance(D)} away`;
    } else {
      const lb = galToLB(f);
      $('focus-where').textContent = `Focus ${formatDistance(fd)} from the Sun`;
      const look = describeLookback(fd);
      $('focus-lookback').textContent = `l ${lb.l.toFixed(1)}°, b ${lb.b.toFixed(1)}°; ${look.text}${look.z !== undefined ? ` (z ${look.z.toFixed(3)})` : ''}`;
    }

    const stats = $('stats');
    if (!stats.hidden) {
      const gpuMB = (st.loadedPoints * 16) / 1048576;
      const kept = Object.values(st.light).filter(Number.isFinite);
      const light = kept.length ? `${(Math.min(...kept) * 100).toFixed(1)} %` : 'n/a';
      // pending light per layer (resolvable at this view, not loaded within the point budget)
      const pend = Object.entries(st.pending).filter(([, v]) => Number.isFinite(v) && v > 0.0005).sort((a, b) => b[1] - a[1]);
      const short = (id: string) => (this.layers.find((l) => l.cfg.id === id)?.cfg.title ?? id).replace(/ galaxies$/i, '');
      const pending = pend.length ? pend.slice(0, 2).map(([id, v]) => `${short(id)} ${(v * 100).toFixed(v < 0.1 ? 1 : 0)} %`).join(', ') : 'none';
      stats.innerHTML =
        `<span>Renderer</span><b>${this.backend}</b>` +
        `<span>FPS</span><b>${this.fps < 0.5 ? 'idle' : this.fps.toFixed(0)}</b>` +
        `<span>Points drawn</span><b>${fmtNum(st.drawnPoints / 1e6, 3)} M</b>` +
        `<span>Budget</span><b>${fmtNum(this.streamer.pointBudget / 1e6, 3)} M</b>` +
        `<span>Nodes drawn / loaded</span><b>${st.drawnNodes} / ${st.loadedNodes}</b>` +
        `<span>Subtree blobs</span><b>${st.blobs}</b>` +
        `<span>Light kept (unresolved)</span><b>${light}</b>` +
        `<span>Light pending</span><b>${pending}</b>` +
        (this.slabMpc > 0 ? `<span>Slab</span><b>±${this.slabMpc} Mpc</b>` : '') +
        `<span>Loading</span><b>${st.inFlight + st.queued}</b>` +
        `<span>Point memory</span><b>${gpuMB.toFixed(0)} MB</b>` +
        `<span>Camera distance</span><b>${formatDistance(D)}</b>`;
    }
  }

  /** screen rectangles covered by UI (labels avoid them) */
  private occluders(): DOMRect[] {
    const out: DOMRect[] = [];
    for (const sel of ['.top .search', '#layers', '#info', '#stats', '.instrument', '#caption']) {
      const el = document.querySelector<HTMLElement>(sel);
      if (!el || el.hidden) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // the instrument strip fades out at the top; only its lower part blocks labels
      out.push(sel === '.instrument' ? new DOMRect(r.x, r.y + 8, r.width, r.height) : r);
    }
    return out;
  }

  private project(p: Vec3, cam: Vec3): { x: number; y: number } | null {
    const v = new THREE.Vector3(p[0] - cam[0], p[1] - cam[1], p[2] - cam[2]).project(this.camera);
    if (v.z > 1 || v.z < -1) return null;
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
  }

  /** reticle + the selected object's line-of-sight distance error bar (dist_lo → dist_hi) */
  private updateOverlay(cam: Vec3) {
    const r = $('reticle');
    const svg = $('errbar') as unknown as SVGSVGElement;
    const s = this.selection;
    const c = s ? this.project(s.xyz, cam) : null;
    if (!s || !c) {
      r.style.display = 'none';
      svg.style.display = 'none';
      return;
    }
    r.style.display = 'block';
    r.style.transform = `translate(${c.x.toFixed(1)}px, ${c.y.toFixed(1)}px)`;
    const d = Math.hypot(...s.xyz);
    if (!(s.lo && s.lo > 0 && d > 0)) {
      svg.style.display = 'none';
      return;
    }
    const hiD = s.hi && Number.isFinite(s.hi) ? s.hi : null;
    const at = (k: number): Vec3 => [s.xyz[0] * k, s.xyz[1] * k, s.xyz[2] * k];
    const a = this.project(at(s.lo / d), cam);
    const b = this.project(at((hiD ?? d * 3) / d), cam);
    if (!a || !b) {
      svg.style.display = 'none';
      return;
    }
    svg.style.display = 'block';
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * 6;
    const ny = (dx / len) * 6;
    const tick = (p: { x: number; y: number }) => `M${(p.x - nx).toFixed(1)},${(p.y - ny).toFixed(1)}L${(p.x + nx).toFixed(1)},${(p.y + ny).toFixed(1)}`;
    const line = svg.querySelector('#eb-line') as SVGPathElement;
    line.setAttribute('d', `M${a.x.toFixed(1)},${a.y.toFixed(1)}L${b.x.toFixed(1)},${b.y.toFixed(1)}`);
    line.setAttribute('stroke-dasharray', hiD ? '' : '5 4');
    (svg.querySelector('#eb-ticks') as SVGPathElement).setAttribute('d', tick(a) + (hiD ? tick(b) : ''));
    const lab = svg.querySelector('#eb-label') as SVGTextElement;
    // caption under the bar's midpoint (the bar's ends can sit under the info card)
    const side = ny >= 0 ? 1 : -1;
    lab.setAttribute('x', ((a.x + b.x) / 2 + nx * 2.4 * side).toFixed(1));
    lab.setAttribute('y', ((a.y + b.y) / 2 + Math.abs(ny) * 2.4 + 14).toFixed(1));
    lab.setAttribute('text-anchor', 'middle');
    lab.textContent = hiD ? '16–84 % distance range' : 'lower bound only';
    lab.style.display = len > 24 ? '' : 'none';
  }

  // ------------------------------------------------------------------ picking (GPU)

  private async pick(cx: number, cy: number, fly: boolean) {
    const hit = await this.picker.pick(cx, cy);
    const L = hit ? this.layers.find((l) => l.code === hit.layerCode) : undefined;
    const n = hit && L ? this.streamer.nodeForSlot(hit.slot) : null;
    if (!hit || !n || n.layer !== L || !n.data || hit.index >= n.meta.count) {
      if (!fly) this.closeInfo();
      return;
    }
    const p = n.data.positions;
    const c = n.meta.center;
    const xyz: Vec3 = [c[0] + p[hit.index * 3], c[1] + p[hit.index * 3 + 1], c[2] + p[hit.index * 3 + 2]];
    await this.showPoint(n, hit.index, xyz, fly, n.data.rgbl[hit.index * 4 + 3]);
  }

  private async showPoint(n: TileNode, i: number, xyz: Vec3, fly: boolean, lum: number) {
    const L = n.layer;
    const kind = L.kind;
    const M = absMagFromLum(lum, kind);
    const dist = Math.hypot(...xyz);
    const flyView: Partial<View> = { focus: xyz, dist: kind === 'star' ? Math.max(0.2, Math.min(5, dist * 0.02)) : 2e5 };
    if (fly) void this.nav.flyTo(flyView);
    const synthetic = !!L.cfg.dev;
    const rows: [string, string][] = [];
    let title = `${L.meta?.idPrefix ?? ''}point ${i}`;
    let ext: ReturnType<typeof readExtRecord> | null = null;
    try {
      ext = readExtRecord(await L.loadExt(n), i, L.extStride);
      title = `${L.meta?.idPrefix ?? ''}${ext.id.toString()}`;
    } catch (e) {
      rows.push(['Catalogue record', `unavailable (${(e as Error).message})`]);
    }
    const ref: SelRef | null = ext ? { type: 'point', layer: L.cfg.id, id: ext.id.toString(), xyz } : null;
    this.selection = { xyz, title, fly: flyView, ref, lo: ext?.distLo, hi: ext?.distHi };
    const lb = galToLB(xyz);
    const rd = galToRadec(xyz);
    const distRows = (label: string) => {
      rows.push([label, `${formatDistance(dist, 4)}${kind === 'star' && formatLy(dist) ? ` (${formatLy(dist)})` : ''}`]);
      if (ext && Number.isFinite(ext.distLo)) {
        const hiOk = Number.isFinite(ext.distHi);
        const frac = hiOk ? (ext.distHi - ext.distLo) / 2 / dist : NaN;
        rows.push(['16–84 % range', hiOk ? `${formatRange(ext.distLo, ext.distHi)} (±${(frac * 100).toFixed(frac < 0.1 ? 1 : 0)} %)` : `> ${formatDistance(ext.distLo)} (no upper bound)`]);
      }
    };
    if (kind === 'star') {
      if (ext) rows.push(['Apparent G', ext.mag.toFixed(2)], ['BP − RP', isFinite(ext.color) ? ext.color.toFixed(2) : 'n/a']);
      distRows('Distance (median)');
      rows.push(['Brightness code M', `${M.toFixed(1)} (rendering proxy)`]);
    } else {
      if (ext) rows.push(['Apparent mag', ext.mag.toFixed(2)], ['Redshift z', ext.color.toFixed(4)]);
      distRows('Comoving distance');
      rows.push(['Lookback', describeLookback(dist).text.replace('light left ', '')]);
    }
    rows.push(['Galactic l, b', `${lb.l.toFixed(3)}°, ${lb.b.toFixed(3)}°`]);
    rows.push(['RA, Dec (ICRS)', `${rd.ra.toFixed(4)}°, ${rd.dec >= 0 ? '+' : ''}${rd.dec.toFixed(4)}°`]);
    const links: [string, string][] = [
      ['SIMBAD at this position', `https://simbad.cds.unistra.fr/simbad/sim-coo?Coord=${rd.ra.toFixed(5)}%20${rd.dec >= 0 ? '%2B' : ''}${rd.dec.toFixed(5)}&CooFrame=ICRS&Radius=10&Radius.unit=arcsec`],
    ];
    if (ext && L.meta?.idPrefix?.startsWith('Gaia DR3')) {
      links.push(['Gaia DR3 record (VizieR)', `https://vizier.cds.unistra.fr/viz-bin/VizieR-5?-source=I/355/gaiadr3&Source=${ext.id.toString()}`]);
    }
    if (kind === 'galaxy') {
      links.push(['Legacy Surveys / DESI viewer', `https://www.legacysurvey.org/viewer?ra=${rd.ra.toFixed(5)}&dec=${rd.dec.toFixed(5)}&layer=ls-dr10&zoom=15&mark=${rd.ra.toFixed(5)},${rd.dec.toFixed(5)}`]);
    }
    this.openInfo({
      kind: `${synthetic ? 'Synthetic ' : ''}${kind === 'star' ? 'star' : 'galaxy'} in ${L.cfg.title}`,
      title,
      italic: kind === 'galaxy',
      rows,
      note: synthetic ? 'Synthetic development point: there is no real object behind this id. Position links search the real sky in that direction.' : '',
      links,
      fly: flyView,
    });
    this.dirty = true;
  }

  private showCatalogEntry(e: CatalogEntry) {
    const rows: [string, string][] = [];
    if (e.alt?.length) rows.push(['Also', e.alt.slice(0, 3).join(', ')]);
    const has = !!e.xyz && e.dist_pc > 0;
    if (has) {
      rows.push(['Distance', `${formatDistance(e.dist_pc, 4)}${formatLy(e.dist_pc) && e.dist_pc < 1e6 ? ` (${formatLy(e.dist_pc)})` : ''}`]);
      if (Number.isFinite(e.dist_lo_pc) && Number.isFinite(e.dist_hi_pc)) {
        const frac = (e.dist_hi_pc! - e.dist_lo_pc!) / 2 / e.dist_pc;
        rows.push(['16–84 % range', `${formatRange(e.dist_lo_pc!, e.dist_hi_pc!)} (±${(frac * 100).toFixed(frac < 0.1 ? 1 : 0)} %)`]);
      }
    } else rows.push(['Distance', 'unknown (direction only)']);
    if (e.mag !== null && e.mag !== undefined) rows.push(['Apparent mag', e.mag.toFixed(2)]);
    if (e.ra !== undefined && e.dec !== undefined) {
      const lb = galToLB(radecDistToGal(e.ra, e.dec, 1));
      rows.push(['Galactic l, b', `${lb.l.toFixed(3)}°, ${lb.b.toFixed(3)}°`]);
      rows.push(['RA, Dec (ICRS)', `${e.ra.toFixed(4)}°, ${e.dec >= 0 ? '+' : ''}${e.dec.toFixed(4)}°`]);
    }
    const fly = this.viewFor(e);
    const xyz = e.xyz ?? (radecDistToGal(e.ra ?? 0, e.dec ?? 0, 1e3) as Vec3);
    this.selection = { xyz, title: e.name, fly, ref: { type: 'cat', name: e.name },
      lo: e.dist_lo_pc ?? undefined, hi: e.dist_hi_pc ?? undefined };
    this.openInfo({
      kind: kindLabel(e.kind),
      title: e.name,
      italic: e.kind.includes('galaxy'),
      rows,
      note: e.ref ? `Source: ${e.ref}` : '',
      links: e.name === 'Sun' ? [] : [['SIMBAD', `https://simbad.cds.unistra.fr/simbad/sim-id?Ident=${encodeURIComponent(e.name)}`]],
      fly,
    });
    this.dirty = true;
  }

  /** flight target for a catalogue entry; direction-only entries turn the view from the Sun */
  private viewFor(e: CatalogEntry): Partial<View> {
    if (e.xyz) return { focus: e.xyz.slice() as Vec3, dist: viewDistanceFor(e.kind, e.dist_pc) };
    const d = radecDistToGal(e.ra ?? 0, e.dec ?? 0, 1);
    return { focus: [0, 0, 0], dist: 1e-3, yaw: Math.atan2(-d[1], -d[0]), pitch: Math.asin(-d[2]) };
  }

  private openInfo(o: { kind: string; title: string; italic: boolean; rows: [string, string][]; note: string; links: [string, string][]; fly: Partial<View> }) {
    $('info-kind').textContent = o.kind;
    const t = $('info-title');
    t.textContent = o.title;
    t.classList.toggle('galaxy', o.italic);
    const dl = $('info-rows');
    dl.textContent = '';
    for (const [k, v] of o.rows) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      dl.append(dt, dd);
    }
    $('info-note').textContent = o.note;
    const links = $('info-links');
    links.textContent = '';
    for (const [label, href] of o.links) {
      const a = document.createElement('a');
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener';
      a.innerHTML = `<span></span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>`;
      a.querySelector('span')!.textContent = label;
      links.appendChild(a);
    }
    $('info-fly').onclick = () => void this.nav.flyTo(o.fly);
    $('info').hidden = false;
    document.body.classList.add('has-info');
    this.scheduleHash();
  }

  private closeInfo() {
    $('info').hidden = true;
    document.body.classList.remove('has-info');
    this.selection = null;
    this.scheduleHash();
  }

  /** deep-link selection: find the point by stable id along the octree path to its position */
  private async restoreSelection(ref: SelRef) {
    if (ref.type === 'cat') {
      const e = this.findCatalog([ref.name]) ?? this.catalog.find((c) => c.name === ref.name);
      if (e) this.showCatalogEntry(e);
      else this.status(`The linked object “${ref.name}” is not in the loaded catalogues.`, 'warn');
      return;
    }
    const L = this.layers.find((l) => l.cfg.id === ref.layer);
    if (!L || L.status !== 'ready' || !L.meta) {
      this.status(`The linked layer “${ref.layer}” is not available.`, 'warn');
      return;
    }
    const metaByName = new Map(L.meta.nodes.map((m) => [m.name, m]));
    const id = BigInt(ref.id);
    for (const name of nodePath(metaByName, ref.xyz)) {
      const n = L.byName.get(name)!;
      let buf: ArrayBuffer;
      try {
        buf = await L.loadExt(n);
      } catch {
        continue;
      }
      const i = findExtId(buf, id, L.extStride);
      if (i < 0) continue;
      let lum = 0;
      let xyz = ref.xyz;
      if (n.state === NodeState.Loaded && n.data) lum = n.data.rgbl[i * 4 + 3];
      else {
        const r = await fetch(L.url(`n/${n.meta.name}.bin`));
        const rec = parseRenderRecords(await r.arrayBuffer(), n.meta.count);
        lum = rec.rgbl[i * 4 + 3];
        const c = n.meta.center;
        xyz = [c[0] + rec.positions[i * 3], c[1] + rec.positions[i * 3 + 1], c[2] + rec.positions[i * 3 + 2]];
      }
      await this.showPoint(n, i, xyz, false, lum);
      return;
    }
    this.status(`The linked object ${L.meta.idPrefix}${ref.id} was not found near the linked position.`, 'warn');
  }

  // ------------------------------------------------------------------ search & UI

  private wireUi() {
    const input = $<HTMLInputElement>('search');
    const list = $('suggest');
    let active = -1;
    let items: { label: string; run: () => void }[] = [];

    const render = () => {
      list.textContent = '';
      items.forEach((it, i) => {
        const li = document.createElement('li');
        li.id = `sg-${i}`;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', String(i === active));
        li.innerHTML = it.label;
        li.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          choose(i);
        });
        list.appendChild(li);
      });
      list.hidden = items.length === 0;
      input.setAttribute('aria-expanded', String(items.length > 0));
      input.setAttribute('aria-activedescendant', active >= 0 ? `sg-${active}` : '');
    };
    const choose = (i: number) => {
      const it = items[i];
      items = [];
      render();
      it?.run();
    };
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    const update = () => {
      const q = input.value.trim();
      active = -1;
      items = searchCatalog(this.catalog, q).map((s) => ({
        label: `<span class="n ${s.entry.kind.includes('galaxy') ? 'galaxy' : ''}">${esc(s.entry.name)}</span><span class="d">${s.entry.xyz && s.entry.dist_pc > 0 ? esc(formatDistance(s.entry.dist_pc)) : s.entry.xyz ? '' : 'direction only'}</span>${s.matched !== s.entry.name ? `<span class="a">${esc(s.matched)}</span>` : `<span class="a">${esc(kindLabel(s.entry.kind))}</span>`}`,
        run: () => this.goToEntry(s.entry),
      }));
      if (q.length >= 2) {
        items.push({
          label: `<span class="n remote">Look up “${esc(q)}” in CDS Sesame</span><span class="d"></span><span class="a">SIMBAD, NED and VizieR names</span>`,
          run: () => void this.sesame(q),
        });
      }
      render();
    };
    input.addEventListener('input', update);
    input.addEventListener('focus', update);
    input.addEventListener('blur', () => setTimeout(() => ((items = []), render()), 120));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') active = Math.min(items.length - 1, active + 1);
      else if (e.key === 'ArrowUp') active = Math.max(-1, active - 1);
      else if (e.key === 'Enter') {
        e.preventDefault();
        const q = input.value.trim();
        if (active >= 0) choose(active);
        else if (items.length > 1 || (items.length === 1 && !searchCatalog(this.catalog, q).length)) choose(0);
        input.blur();
        return;
      } else if (e.key === 'Escape') {
        items = [];
        render();
        input.blur();
        return;
      } else return;
      e.preventDefault();
      render();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== input && !(e.target as HTMLElement).closest('input,textarea')) {
        e.preventDefault();
        input.focus();
      }
      if (e.key === 'Escape' && document.activeElement !== input) this.closeInfo();
    });

    const tog = $('layers-toggle');
    tog.addEventListener('click', () => tog.setAttribute('aria-expanded', String(tog.getAttribute('aria-expanded') !== 'true')));
    if (window.innerWidth < 640) tog.setAttribute('aria-expanded', 'false');

    const exp = $<HTMLInputElement>('exposure');
    const expOut = $('exposure-out');
    const setExp = () => {
      this.exposure = +exp.value;
      expOut.textContent = `${this.exposure > 0 ? '+' : ''}${this.exposure.toFixed(2)} mag`;
      this.dirty = true;
    };
    exp.addEventListener('input', setExp);
    setExp();
    const bud = $<HTMLInputElement>('budget');
    const budOut = $('budget-out');
    const setBud = () => {
      this.streamer.pointBudget = Math.round(+bud.value * 1e6);
      budOut.textContent = `${(+bud.value).toFixed(1)} M`;
      this.dirty = true;
    };
    bud.addEventListener('input', setBud);
    setBud();
    const det = $<HTMLInputElement>('detail');
    const detOut = $('detail-out');
    const setDet = () => {
      this.streamer.minNodePx = 460 - +det.value; // right = more detail
      detOut.textContent = `${det.value}`;
      this.dirty = true;
    };
    det.addEventListener('input', setDet);
    setDet();
    $<HTMLInputElement>('labels-on').addEventListener('change', (e) => {
      this.labels.enabled = (e.target as HTMLInputElement).checked;
      this.dirty = true;
    });
    $<HTMLInputElement>('unc-on').addEventListener('change', (e) => {
      this.streamer.uncertainty = (e.target as HTMLInputElement).checked;
      this.dirty = true;
    });
    $<HTMLInputElement>('slab-on').addEventListener('change', (e) => this.setSlab((e.target as HTMLInputElement).checked ? this.slabWanted : 0));
    $<HTMLInputElement>('slab').addEventListener('input', (e) => {
      this.slabWanted = +(e.target as HTMLInputElement).value;
      this.setSlab(this.slabMpc > 0 ? this.slabWanted : 0);
    });
    $<HTMLInputElement>('stats-on').addEventListener('change', (e) => ($('stats').hidden = !(e.target as HTMLInputElement).checked));

    $('info-close').addEventListener('click', () => this.closeInfo());
    $('tour').addEventListener('click', () => (this.tourAbort ? this.stopTour(true) : void this.runTour(SCALE_TOUR)));
    $('home').addEventListener('click', () => void this.nav.flyTo({ focus: [0, 0, 0], dist: 6 }));
    $('copy-link').addEventListener('click', async () => {
      this.writeHash();
      try {
        await navigator.clipboard.writeText(location.href);
        this.status('Link to this view copied.');
      } catch {
        this.status('Copy failed; the link is in the address bar.', 'warn');
      }
    });
    const help = $<HTMLDialogElement>('help');
    $('help-btn').addEventListener('click', () => help.showModal());

    this.rail.onPick = (logD, commit) => {
      this.stopTour(false);
      if (commit) void this.nav.flyTo({ dist: Math.pow(10, logD) }, { durationScale: 0.6 });
      else {
        this.nav.cancelFlight();
        this.nav.zoomBy(Math.pow(10, logD) / this.nav.view.dist);
      }
    };
  }

  private goToEntry(e: CatalogEntry) {
    this.stopTour(false);
    this.showCatalogEntry(e);
    if (e.xyz) this.status(`${e.name}: ${e.dist_pc > 0 ? formatDistance(e.dist_pc) + ' from the Sun' : 'the origin of the map'}.`);
    else this.status(`${e.name}: no distance in the catalogue; looking toward it from the Sun.`);
    void this.nav.flyTo(this.viewFor(e));
  }

  private async sesame(q: string) {
    this.stopTour(false);
    this.status(`Looking up “${q}” in CDS Sesame…`);
    let r: Resolved | null = null;
    try {
      r = await resolveSesame(q);
    } catch (e) {
      this.status(`${(e as Error).message}. Local names still work.`, 'warn');
      return;
    }
    if (!r) {
      this.status(`Sesame does not know “${q}”. Check the spelling or try a catalogue id such as HIP 32349.`, 'warn');
      return;
    }
    const rows: [string, string][] = [
      ['Type (SIMBAD)', r.otype || 'n/a'],
      ['RA, Dec (ICRS)', `${r.ra.toFixed(4)}°, ${r.dec >= 0 ? '+' : ''}${r.dec.toFixed(4)}°`],
    ];
    const lb = galToLB(r.dir);
    rows.push(['Galactic l, b', `${lb.l.toFixed(3)}°, ${lb.b.toFixed(3)}°`]);
    rows.push(['Distance', r.distPc !== null ? formatDistance(r.distPc) : 'unknown']);
    const link: [string, string][] = [['SIMBAD', `https://simbad.cds.unistra.fr/simbad/sim-id?Ident=${encodeURIComponent(q)}`]];
    if (r.xyz && r.distPc !== null) {
      const fly = { focus: r.xyz, dist: viewDistanceFor(r.kind, r.distPc) };
      this.selection = { xyz: r.xyz, title: r.name, fly, ref: null };
      this.openInfo({ kind: `Resolved by Sesame (${r.kind})`, title: r.name, italic: r.kind === 'galaxy', rows, note: `Distance from ${r.distSource}.`, links: link, fly });
      this.status(`${r.name}: ${formatDistance(r.distPc)} (${r.distSource}).`);
      void this.nav.flyTo(fly);
    } else {
      const d = r.dir;
      const view: Partial<View> = { focus: [0, 0, 0], dist: 1e-3, yaw: Math.atan2(-d[1], -d[0]), pitch: Math.asin(-d[2]) };
      this.selection = { xyz: [d[0] * 1e3, d[1] * 1e3, d[2] * 1e3], title: r.name, fly: view, ref: null };
      this.openInfo({ kind: `Resolved by Sesame (${r.kind})`, title: r.name, italic: r.kind === 'galaxy', rows,
        note: `Direction only: ${r.distSource}. The view turns toward it from the Sun.`, links: link, fly: view });
      this.status(`${r.name}: no usable distance (${r.distSource}); looking toward it from the Sun.`);
      void this.nav.flyTo(view);
    }
  }

  private status(msg: string, tone: 'info' | 'warn' = 'info') {
    const s = $('search-status');
    s.textContent = msg;
    s.dataset.tone = tone;
  }

  // ------------------------------------------------------------------ tours (data in tour/tours.ts)

  private stopTour(restoreView: boolean) {
    if (this.tourAbort) {
      const f = this.tourAbort;
      this.tourAbort = null;
      f(restoreView);
    }
  }

  private tourContext(): TourContext {
    return {
      catalog: (names) => this.findCatalog(names)?.xyz ?? null,
      galacticCentre: [R0_PC, 0, 0],
      galaxyEdgePc: () => {
        const halves = this.layers.filter((L) => L.kind === 'galaxy' && L.active && L.root).map((L) => {
          // radius holding the bulk of the light, from the root aggregate's extent
          return L.root!.meta.half;
        });
        return halves.length ? Math.min(Math.max(...halves), 3e9) : 2.5e9;
      },
      lookbackText: (d) => describeLookback(d).text.replace('light left ', ''),
    };
  }

  private async runTour(tour: Tour) {
    const btn = $('tour');
    const cap = $('caption');
    // snapshot the scene; restored when the tour ends
    const snap = {
      view: { ...this.nav.view, focus: [...this.nav.view.focus] as Vec3 },
      layers: this.layerVisibility(),
      sel: this.selection,
    };
    let stopped = false;
    const restore = (restoreView: boolean) => {
      stopped = true;
      this.nav.cancelFlight();
      cap.hidden = true;
      btn.setAttribute('aria-pressed', 'false');
      btn.querySelector('span')!.textContent = tour.label;
      for (const [id, on] of Object.entries(snap.layers)) if (this.layerVisibility()[id] !== on) this.setLayerVisible(id, on);
      if (snap.sel) this.selection = snap.sel;
      if (restoreView) void this.nav.flyTo(snap.view);
    };
    this.tourAbort = restore;
    btn.setAttribute('aria-pressed', 'true');
    btn.querySelector('span')!.textContent = 'Stop tour';
    this.closeInfo();
    const ctx = this.tourContext();
    for (const beat of tour.beats) {
      if (stopped) return;
      const r = resolveBeat(beat, ctx); // targets resolved now, at playback
      for (const id of beat.show ?? []) this.setLayerVisible(id, true);
      cap.innerHTML = '<b></b><span></span>';
      cap.querySelector('b')!.textContent = r.title;
      cap.querySelector('span')!.textContent = r.text;
      cap.hidden = false;
      const ok = await this.nav.flyTo({ focus: r.focus, dist: r.dist, pitch: r.pitch, ...(r.yaw !== undefined ? { yaw: r.yaw } : {}) }, { durationScale: 1.15 });
      if (!ok || stopped) return;
      await new Promise((res) => setTimeout(res, this.nav.reducedMotion ? 4000 : beat.dwellMs));
    }
    this.stopTour(true);
  }

  // ------------------------------------------------------------------ deep links

  private scheduleHash() {
    clearTimeout(this.hashTimer);
    this.hashTimer = window.setTimeout(() => this.writeHash(), 400);
  }

  private writeHash() {
    const v = this.nav.view;
    if (this.nav.flying || this.tourAbort) return;
    const h = formatHash({
      view: { focus: v.focus, dist: v.dist, yawDeg: v.yaw * DEG, pitchDeg: v.pitch * DEG },
      layers: this.layers.length ? this.layerVisibility() : undefined,
      sel: this.selection?.ref ?? undefined,
      slab: this.slabMpc > 0 ? this.slabMpc : undefined,
    });
    if (location.hash !== h) history.replaceState(null, '', h);
  }

  private applyHashView(hv: NonNullable<ReturnType<typeof parseHash>['view']>, animate: boolean) {
    const v: View = { focus: hv.focus, dist: hv.dist, yaw: hv.yawDeg / DEG, pitch: hv.pitchDeg / DEG };
    const cur = this.nav.view;
    const same = Math.abs(Math.log(v.dist / cur.dist)) < 1e-4 && Math.hypot(v.focus[0] - cur.focus[0], v.focus[1] - cur.focus[1], v.focus[2] - cur.focus[2]) < v.dist * 1e-5;
    if (same) return;
    if (animate) void this.nav.flyTo(v);
    else this.nav.setView(v);
  }

  private async onHashChange() {
    const h = parseHash(location.hash);
    if (h.view) this.applyHashView(h.view, true);
    if ((h.slab ?? 0) !== this.slabMpc) this.setSlab(h.slab ?? 0);
    await this.layersReady;
    if (h.layers) for (const [id, on] of Object.entries(h.layers)) if (this.layerVisibility()[id] !== undefined && this.layerVisibility()[id] !== on) this.setLayerVisible(id, on);
    const cur = this.selection?.ref;
    if (h.sel && JSON.stringify(h.sel) !== JSON.stringify(cur)) void this.restoreSelection(h.sel);
  }

  // ------------------------------------------------------------------ test hooks

  private exposeDebugApi() {
    (window as unknown as { __atlas: unknown }).__atlas = {
      stats: () => ({ backend: this.backend, fps: this.fps, ...this.streamer.stats, budget: this.streamer.pointBudget, view: this.nav.view,
        selection: this.selection ? { title: this.selection.title, ref: this.selection.ref, lo: this.selection.lo, hi: this.selection.hi } : null,
        layers: this.layers.map((L) => ({ id: L.cfg.id, status: L.status, active: L.active, count: L.meta?.count ?? 0 })) }),
      setView: (v: Partial<View>) => this.nav.setView(v),
      flyTo: (v: Partial<View>) => this.nav.flyTo(v),
      pickAt: (x: number, y: number) => this.pick(x, y, false),
      setContinuous: (on: boolean) => (this.continuous = on),
      setSlab: (halfMpc: number) => this.setSlab(halfMpc),
      density: () => ({ ...this.densityInfo, kSmoothed: this.densityK }),
      setExposure: (mag: number) => {
        this.exposure = mag;
        this.dirty = true;
      },
      setLayer: (id: string, on: boolean) => this.setLayerVisible(id, on),
      setSky: (on: boolean) => this.setLayerVisible(this.skyCfg?.id ?? 'gaia-sky', on),
      setUncertainty: (on: boolean) => {
        this.streamer.uncertainty = on;
        ($('unc-on') as HTMLInputElement).checked = on;
        this.dirty = true;
      },
    };
  }
}

function formatRange(lo: number, hi: number): string {
  const u = formatDistance(hi).split(' ')[1];
  const a = formatDistance(lo, 3);
  const b = formatDistance(hi, 3);
  return a.endsWith(u) ? `${a.replace(` ${u}`, '')} – ${b}` : `${a} – ${b}`;
}

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function kindLabel(kind: string): string {
  return (
    { star: 'Star', wd: 'White dwarf', cluster: 'Star cluster', bh: 'Supermassive black hole', lg_galaxy: 'Local Group galaxy', galaxy: 'Galaxy', qso: 'Quasar' } as Record<string, string>
  )[kind] ?? kind;
}

void new App().start();
