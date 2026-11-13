import '@fontsource/spectral/400.css';
import '@fontsource/spectral/400-italic.css';
import '@fontsource/spectral/500.css';
import '@fontsource/spectral/500-italic.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import './style.css';
import './ui/okina';

import * as THREE from 'three/webgpu';
import {
  catalogKey, isPointLayer, loadCatalogs, loadManifest, loadTilesIndex, type CatalogEntry, type LayerConfig, type Manifest, type TilesIndex,
} from './data/manifest';
import { DEFAULT_TILE_BASE, applyTileBase, resolveTileBase } from './data/tilebase';
import { normName, resolveSesame, searchCatalog, viewDistanceFor, type Resolved } from './data/resolve';
import { DocsPanel } from './docs/panel';
import { loadArticle } from './docs/store';
import { decimalSep, fmtFixed, getLang, initLang, onLangChange, t, tOr } from './i18n';
import { applyI18n, mountLangSwitch } from './i18n/dom';
import { galToLB, galToRadec, radecDistToGal, type Vec3 } from './math/frames';
import { describeLookback, fmtNum, formatDistance, formatLightTime, formatLy, formatRange, niceScaleBar } from './math/units';
import { docSlugFor, kindFromOtype, kindInfo } from './objects/kinds';
import { NAMED_VIEWS, fold, type NamedView } from './search/aliases';
import { LAYER_VIEWS, resolveFocus } from './search/focus';
import { buildSuggestions, type BodyProvider, type SuggestItem } from './search/suggest';
import { NavController, type View } from './nav/controller';
import { absMagFromLum, galaxyRadiusPc } from './render/brightness';
import { DEFAULT_EXPOSURE, binCounts, exposureFromCounts, smoothExposure, type SamplePoints } from './render/exposure';
import { DENSITY_SPRITE_PX, SLAB_OFF } from './render/pointMaterial';
import { LabelLayer, type LabelItem } from './render/labels';
import { MilkyWayModel, R0_PC } from './render/milkyway';
import { GalaxyShapes, type GalaxyShapesDoc } from './render/galaxyShapes';
import { GpuPicker } from './render/pick';
import { PostPass } from './render/post';
import { formatHash, parseHash, type SelRef } from './state/hash';
import { factRows, planetRows } from './objects/facts';
import { findExtId, nodePath, parseRenderRecords, readExtRecord } from './tiles/format';
import { NodeState, PointLayer, Streamer, type TileNode } from './tiles/streamer';
import { SCALE_TOUR, SHOW_ME_TOUR, needsHere, resolveBeat, resolveTarget, type Beat, type Tour, type TourContext } from './tour/tours';
import { ScaleRail } from './ui/rail';
// --- Solar System hook (web/src/solar): live planets, time control, probes
import { SOLAR_LABEL_MAX, SolarSystem, TimeBar, flyTargetForLatLon, observerGalacticXyz, solarInfo, tr as solarTr, type SolarEntry } from './solar';
// --- Black hole hook (web/src/blackhole): lensing post pass, disk, HUD, approach to 1.5 r_s
import { BlackHoleFeature } from './blackhole';

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
  shapes = new GalaxyShapes();
  mwCfg: LayerConfig | null = null;
  skyCfg: LayerConfig | null = null;
  sky = { visible: true, opacity: 1, loaded: false };
  labels!: LabelLayer;
  rail!: ScaleRail;
  catalog: CatalogEntry[] = [];
  manifest!: Manifest;
  tilesIndex: TilesIndex | null = null;
  tileBase = DEFAULT_TILE_BASE;
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
  private totalRenders = 0;
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
  docs!: DocsPanel;
  /** live Solar System bodies (registered by the Solar System module) */
  bodies: BodyProvider | null = null;
  /** re-renders the open info card (language change) */
  private infoRefresh: (() => void) | null = null;
  private infoToken = 0;
  /** the tour beat on screen, for re-captioning on a language change */
  private tourBeat: Beat | null = null;
  private refreshOutputs: () => void = () => {};
  // --- Solar System hook
  solar = new SolarSystem();
  private timebar!: TimeBar;
  private solarSel: SolarEntry | null = null;
  private solarInfoT = 0;
  // --- Black hole hook
  bh = new BlackHoleFeature();

  async start() {
    initLang();
    applyI18n();
    mountLangSwitch($('lang'));
    this.docs = new DocsPanel();
    this.docs.onFocus = (name) => this.focusByName(name);
    this.docs.onLayer = (id) => this.showLayer(id);
    this.docs.onChange = () => this.scheduleHash();
    onLangChange(() => this.onLang());
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
        // ?gputime: GPU timestamp queries for the perf hooks below (capture scripts)
        trackTimestamp: new URLSearchParams(location.search).has('gputime'),
      });
      await this.renderer.init();
    } catch (e) {
      this.status(t('status.noGpu', { msg: (e as Error).message }), 'warn');
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
    this.nav.addGestureSource($('labels'));
    this.rail = new ScaleRail($('rail'), $('rail-ticks'), $('rail-mark'));
    this.scene.add(this.mw.points);
    this.scene.add(this.shapes.group);
    this.shapes.onChange = () => (this.dirty = true);
    this.shapes.thumbsEnabled = new URLSearchParams(location.search).get('thumbs') !== 'off';
    // --- Solar System hook: the layer, its time bar, and clicks on its labels
    this.scene.add(this.solar.root);
    this.timebar = new TimeBar(this.solar.clock);
    document.body.appendChild(this.timebar.el);
    const onClock = this.solar.clock.onChange;
    this.solar.clock.onChange = () => {
      onClock();
      this.dirty = true;
    };
    this.solar.onSelect = (e) => this.showSolar(e);
    // --- Black hole hook: lens pipeline, HUD; flights and re-renders go through the app
    this.bh.attach(this.post, this.backend);
    this.bh.onChange = () => (this.dirty = true);
    this.bh.onFly = (v) => {
      this.stopTour(false);
      return this.nav.flyTo(v);
    };
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
    if (h.doc) void this.docs.open(h.doc, { push: false });
    window.addEventListener('hashchange', () => this.onHashChange());

    requestAnimationFrame(this.loop);

    try {
      this.manifest = await loadManifest();
    } catch (e) {
      this.status(t('status.noLayers', { msg: (e as Error).message }), 'warn');
      return;
    }
    // tile origin: ?tiles= > VITE_TILE_BASE > layers.json tilesBase > tiles/ (src/data/tilebase.ts)
    this.tileBase = resolveTileBase(location.search, import.meta.env.VITE_TILE_BASE, this.manifest.tilesBase, location.href);
    this.manifest = applyTileBase(this.manifest, this.tileBase);
    this.tilesIndex = await loadTilesIndex(this.tileBase);
    this.layersReady = this.initLayers(h.layers);
    await this.layersReady;
    await this.initCatalogs();
    this.exposeDebugApi();
    if (this.pendingSel) void this.restoreSelection(this.pendingSel);
    if (h.layer) await this.showLayer(h.layer);
    if (h.focus) this.focusByName(h.focus);
    else if (h.at) this.goToAnchor(h.at, h.look);
    if (h.layer || h.focus) this.writeHash(); // drop the one-shot params
  }

  /** the UI language changed: re-render everything built from strings */
  private onLang() {
    applyI18n();
    this.rail?.build();
    if (this.manifest) this.renderLayerPanel();
    if (this.labels) this.buildLabels();
    this.refreshOutputs();
    if (!$('info').hidden) this.infoRefresh?.();
    if (this.tourAbort && this.tourBeat) this.showCaption(this.tourBeat);
    const tb = $('tour').querySelector('span')!;
    tb.textContent = this.tourAbort ? t('tour.stop') : t(SCALE_TOUR.label);
    $('search-status').textContent = '';
    this.dirty = true;
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
    if (hashLayers?.solar !== undefined) this.solar.visible = hashLayers.solar; // --- Solar System hook
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
    out.solar = this.solar.visible; // --- Solar System hook
    return out;
  }

  private setLayerVisible(id: string, on: boolean) {
    const L = this.layers.find((l) => l.cfg.id === id);
    if (L) {
      L.visible = on;
      if (!on) this.streamer.releaseLayer(L);
    } else if (this.mwCfg?.id === id) this.mw.visible = on;
    else if (this.skyCfg?.id === id) this.sky.visible = on;
    else if (id === 'solar') this.solar.visible = on; // --- Solar System hook
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
        <label class="layer-row" for="${cid}">
          <span class="swatch ${opts.swatch}" aria-hidden="true"></span>
          <span class="layer-title"><b></b></span>
          <input id="${cid}" class="toggle" type="checkbox" role="switch" />
        </label>
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
      rg.setAttribute('aria-label', t('layers.opacity', { title: opts.title }));
      rg.hidden = !opts.checked;
      cb.addEventListener('change', () => this.setLayerVisible(opts.id, cb.checked));
      rg.addEventListener('input', () => {
        opts.onOpacity(+rg.value);
        this.dirty = true;
      });
      list.appendChild(li);
    };

    const title = (c: LayerConfig) => layerTitle(c);
    for (const L of this.layers) {
      if (L.status === 'missing' || L.status === 'error') {
        missing.push(L.status === 'error' ? t('layers.invalid', { title: title(L.cfg) }) : title(L.cfg));
        continue;
      }
      if (L.status !== 'ready' || L.superseded) continue;
      const m = L.meta!;
      const fmtCount = (c: number) => (c >= 1e5 ? t('num.million', { n: fmtNum(c / 1e6, 3) }) : fmtFixed(c, 0));
      // lite tile sets (scripts/make_lite_tiles.py) say how much of the full layer they carry
      const what = m.lite && m.fullCount
        ? t('layers.lite', { a: fmtCount(m.count), b: fmtCount(m.fullCount) })
        : t(L.kind === 'star' ? 'layers.stars' : 'layers.galaxies', { n: m.count, nText: fmtCount(m.count) });
      row({
        id: L.cfg.id,
        title: title(L.cfg),
        swatch: L.kind,
        tag: L.cfg.dev ? ['synthetic', t('tag.synthetic')] : m.lite ? ['lite', t('tag.lite')] : undefined,
        meta: `${what}${L.cfg.credit ? `, ${L.cfg.credit}` : ''}`,
        checked: L.visible,
        opacity: L.opacity,
        onOpacity: (v) => (L.opacity = v),
      });
    }
    if (this.mwCfg) {
      row({
        id: this.mwCfg.id, title: title(this.mwCfg), swatch: 'model', tag: ['model', t('tag.model')],
        meta: this.mwCfg.credit ?? t('layers.mwCredit'), checked: this.mw.visible, opacity: this.mw.opacity,
        onOpacity: (v) => (this.mw.opacity = v),
      });
    }
    if (this.skyCfg) {
      row({
        id: this.skyCfg.id, title: title(this.skyCfg), swatch: 'sky',
        meta: this.skyCfg.credit ?? '', checked: this.sky.visible, opacity: this.sky.opacity,
        onOpacity: (v) => (this.sky.opacity = v),
      });
    }
    // --- Solar System hook: its row in the layers panel
    row({
      id: 'solar', title: solarTr('layer.solar'), swatch: 'solar', meta: solarTr('layer.solar.meta'),
      checked: this.solar.visible, opacity: this.solar.opacity, onOpacity: (v) => (this.solar.opacity = v),
    });
    $('layer-missing').textContent = missing.length ? t('layers.notBuilt', { list: missing.join(', ') }) : '';
    $('credits').innerHTML = '';
    const credits = [
      ...this.layers.filter((L) => L.status === 'ready' && !L.superseded).map((L) => `${title(L.cfg)}: ${L.cfg.credit ?? (L.cfg.dev ? t('layers.syntheticCredit') : L.meta?.title ?? '')}`),
      this.mwCfg ? `${title(this.mwCfg)}: ${this.mwCfg.credit}` : '',
      this.skyCfg ? `${title(this.skyCfg)}: ${this.skyCfg.credit}` : '',
      solarTr('solar.credit'), // --- Solar System hook
      t('credits.sesame'),
      t('credits.skymap'),
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
    // --- Solar System hook: probe tracks, then bodies + probes join search (live xyz) and labels
    if (!this.tilesIndex || this.tilesIndex.catalogs.includes('spacecraft.json')) await this.solar.loadSpacecraft(`${this.tileBase}catalogs/spacecraft.json`);
    const solarNames = new Set(this.solar.entries.flatMap((e) => [e.name, ...e.alt]).map(normName));
    this.catalog = [...(this.solar.entries as unknown as CatalogEntry[]), ...entries.filter((e) => !solarNames.has(normName(e.name)))];
    await this.initGalaxyShapes();
    this.bh.setCatalog(this.catalog); // --- Black hole hook
    this.buildLabels();
  }

  /** map labels from the catalogues and the Milky Way model; rebuilt when the language changes */
  private buildLabels() {
    const entries = this.catalog.filter((e) => !(e as unknown as SolarEntry).solar);
    const items: LabelItem[] = [];
    // --- Solar System hook; body labels in the current language (the items are live objects: rename in place)
    for (const it of this.solar.labelItems) {
      const en = SOLAR_LABEL_EN.get(it) ?? it.name;
      SOLAR_LABEL_EN.set(it, en);
      it.name = tOr(`body.${en.toLowerCase()}`, en);
    }
    items.push(...this.solar.labelItems);
    for (const e of entries) {
      if (!e.xyz) continue;
      const d = e.dist_pc;
      const absMag = e.mag !== null && e.mag !== undefined && d > 0 ? e.mag - 5 * Math.log10(d / 10) : null;
      const isMw = /^milky way/i.test(e.name);
      const sizePc = isMw ? 15000 : e.kind === 'galaxy' || e.kind === 'qso' ? (absMag !== null ? galaxyRadiusPc(absMag) : 10000)
        : e.kind === 'lg_galaxy' ? (absMag !== null ? Math.min(galaxyRadiusPc(absMag), 20000) : 1500) : e.kind === 'cluster' ? 5 : undefined;
      items.push({
        sizePc,
        name: displayName(e.name),
        xyz: e.xyz,
        kind: e.kind,
        absMag: e.name === 'Sun' ? 4.83 : absMag,
        // the Sun is labelled up to Milky Way scale (the Solar System layer labels it closer in); whole-galaxy entries only beyond it
        ...(e.name === 'Sun' ? { minScale: SOLAR_LABEL_MAX, maxScale: 2e5 } : /^milky way/i.test(e.name) ? { minScale: 2e5, maxScale: Infinity } : {}),
        onClick: () => this.showCatalogEntry(e),
      });
    }
    if (!entries.some((e) => /^milky way/i.test(e.name))) items.push({ name: t('view.milky-way'), xyz: [R0_PC, 0, 0], kind: 'galaxy', absMag: -20.8, minScale: 2e5, sizePc: 15000,
      onClick: () => this.nav.flyTo({ focus: [R0_PC, 0, 0], dist: 6e4, pitch: 1.5 }) });
    for (const m of this.mw.labels) items.push({ name: tOr(MW_LABEL_KEYS[m.name] ?? '', m.name), xyz: m.xyz, kind: 'model', absMag: null, minScale: 4000, maxScale: 2e5, sizePc: 2000 });
    this.labels.setItems(items);
    this.labelItems = items;
    if (this.hereLabel) items.push(this.hereLabel);
    this.dirty = true;
  }

  /** D25 axes / PA / inclination per catalogue galaxy (scripts/build_galaxy_shapes.py) */
  private async initGalaxyShapes() {
    const file = 'galaxy-shapes.json';
    if (this.tilesIndex && !this.tilesIndex.catalogs.includes(file)) return;
    try {
      const r = await fetch(`${this.tileBase}catalogs/${file}`); // same origin as the other catalogues (tilebase.ts)
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const doc = (await r.json()) as GalaxyShapesDoc;
      this.shapes.setData(doc, this.catalog);
    } catch (e) {
      console.warn(`[galaxy shapes] not loaded: ${(e as Error).message}; galaxies stay points`);
    }
  }

  /** catalogue entry by any name or alias, with catalogue-id normalisation (M81 = MESSIER081) */
  private findEntry(name: string): CatalogEntry | null {
    const k = catalogKey(name);
    return this.catalog.find((e) => [e.name, ...(e.alt ?? [])].some((n) => catalogKey(n) === k)) ?? null;
  }

  private findCatalog(names: string[]): CatalogEntry | null {
    const keys = names.map(normName);
    // own name before alias: "Sgr A*" is also an alias of "Milky Way (Galactic Centre)"
    return this.catalog.find((e) => e.xyz && keys.includes(normName(e.name)))
      ?? this.catalog.find((e) => e.xyz && (e.alt ?? []).some((n) => keys.includes(normName(n)))) ?? null;
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
    this.solar.follow(this.nav); // --- Solar System hook: keep the focus on a moving body
    if (this.here && this.hereLabel) {
      const p = observerGalacticXyz(this.here.lat, this.here.lon, 0, this.solar.clock.now());
      this.hereLabel.xyz[0] = p[0]; this.hereLabel.xyz[1] = p[1]; this.hereLabel.xyz[2] = p[2];
      // close to the ground the planet's own label (at its centre, right under the pin) would win
      const earth = this.solar.bodies.find((b) => b.def.id === 'earth');
      if (earth) earth.label.hidden = this.solar.followId === 'earth' && this.nav.view.dist < 3e-10;
    }
    this.nav.applyToCamera();
    // --- Black hole hook: lens uniforms, HUD, keep the camera outside 1.5 r_s (may move the focus)
    if (this.bh.update({ nav: this.nav, camera: this.camera, pxPerRad: this.pxPerRad(), dt, width: window.innerWidth, height: window.innerHeight })) this.dirty = true;
    const cam = this.nav.camPos();
    const D = this.nav.view.dist;
    // --- Solar System hook: positions at the simulation time; re-render when something moved on screen
    if (this.solar.update({ cam, camera: this.camera, pxPerRad: this.pxPerRad(), focusDist: D, dpr: this.dpr, width: window.innerWidth, height: window.innerHeight })) this.dirty = true;

    // render on demand: only when something changed, a fade is running, or benchmarking
    const settling = this.densityK > 0 && Math.abs(Math.log(this.densityK / (this.densityTarget || this.densityK))) > 0.01;
    const want = this.continuous || this.dirty || moved || this.nav.flying || this.streamer.stats.fading || settling || this.shapes.animating;
    const gpuFree = this.backend !== 'WebGPU' || this.inFlight < MAX_FRAMES_IN_FLIGHT;
    if (want && gpuFree) {
      this.dirty = false;
      this.renderFrame(cam, D, dt);
      this.scheduleHash();
    }
    this.labels.modelOpacity = this.mwFade * (this.mw.visible ? 1 : 0);
    if (want || this.labels.animating) this.labels.update(this.camera, cam, D, window.innerWidth, window.innerHeight, this.occluders(), dt);
    this.updateOverlay(cam);
    if (t - this.lastUi > 120) {
      this.lastUi = t;
      this.updateReadouts(D, this.streamer.stats);
      this.solarUiTick(t); // --- Solar System hook
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
    const ge = AUTO_EXPOSURE.galaxy;
    this.shapes.update({
      cam, camera: this.camera, frustum: this.frustum, pxPerRad, dpr: this.dpr, dt, exposure: this.exposure,
      mRef: ge.base + ge.perDecade * Math.max(-2, logD) + this.exposure,
      // resolved galaxies follow the nearby-galaxy layers' switches
      enabled: this.layers.some((L) => L.kind === 'galaxy' && L.active && L.cfg.id !== 'galaxies-desi' && !L.cfg.dev),
    });
    const camFromSun = Math.hypot(cam[0], cam[1], cam[2]);
    const skyFade = 1 - smoothstep(1500, 2500, camFromSun);
    this.skyAmount = this.sky.visible && this.sky.loaded ? this.sky.opacity * skyFade : 0;

    // --- Black hole hook: environment cube for rays bent out of the frame, then the lensed pipeline
    this.bh.captureEnv(this.renderer, this.scene, (px, dpr) => this.setSpritePx(cam, px, dpr), () => this.setSpritePx(cam, pxPerRad, this.dpr));
    this.post.render(this.camera, this.skyAmount, this.bh.lensActive);
    this.renders++;
    this.totalRenders++;
    // frames-in-flight cap (WebGPU): count submitted work until the queue reports it done
    if (this.backend === 'WebGPU') {
      const dev = (this.renderer as unknown as { backend: { device?: GPUDevice } }).backend.device;
      if (dev) {
        this.inFlight++;
        dev.queue.onSubmittedWorkDone().then(() => (this.inFlight = Math.max(0, this.inFlight - 1)));
      }
    }
  }

  /** --- Black hole hook: sprite scale of the point layers and the Milky Way model for one render */
  private setSpritePx(cam: Vec3, pxPerRad: number, dpr: number) {
    for (const L of this.layers) {
      L.uniforms.pxPerRad.value = pxPerRad;
      L.uniforms.dpr.value = dpr;
    }
    this.mw.update(cam, pxPerRad, dpr);
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
    if (out) out.textContent = `±${this.slabWanted} ${t('unit.Mpc')}`;
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
    this.rail.set(Math.log10(D), t('readout.camera', { d: formatDistance(D) }));

    const f = this.nav.view.focus;
    const fd = Math.hypot(f[0], f[1], f[2]);
    if (fd < Math.max(1e-6, D * 1e-3)) {
      $('focus-where').textContent = t('readout.focusSun');
      $('focus-lookback').textContent = t('readout.cameraAway', { d: formatDistance(D) });
    } else {
      const lb = galToLB(f);
      $('focus-where').textContent = t('readout.focusFrom', { d: formatDistance(fd) });
      const look = describeLookback(fd);
      $('focus-lookback').textContent = t('readout.where', { l: fmtFixed(lb.l, 1), b: fmtFixed(lb.b, 1), look: look.text })
        + (look.z !== undefined ? ` ${t('readout.z', { z: fmtFixed(look.z, 3) })}` : '');
    }

    const stats = $('stats');
    if (!stats.hidden) {
      const gpuMB = (st.loadedPoints * 16) / 1048576;
      const kept = Object.values(st.light).filter(Number.isFinite);
      const pctText = (v: number, d: number) => `${fmtFixed(v * 100, d)} %`;
      const light = kept.length ? pctText(Math.min(...kept), 1) : t('common.na');
      // pending light per layer (resolvable at this view, not loaded within the point budget)
      const pend = Object.entries(st.pending).filter(([, v]) => Number.isFinite(v) && v > 0.0005).sort((a, b) => b[1] - a[1]);
      const short = (id: string) => {
        const L = this.layers.find((l) => l.cfg.id === id);
        return L ? layerTitle(L.cfg).replace(/ galaxies$/i, '') : id;
      };
      const pct = ([id, v]: [string, number]) => `${short(id)} ${pctText(v, v < 0.1 ? 1 : 0)}`;
      const pending = pend.length ? pend.slice(0, 2).map(pct).join(', ') : t('stats.none');
      // lite tile sets: resolvable light whose points were dropped from the set
      const drop = Object.entries(st.dropped).filter(([, v]) => Number.isFinite(v) && v > 0.0005).sort((a, b) => b[1] - a[1]);
      const M = (n: number) => t('num.millionShort', { n: fmtNum(n / 1e6, 3) });
      const row = (k: string, v: string | number) => `<span>${t(k)}</span><b>${v}</b>`;
      stats.innerHTML =
        row('stats.renderer', this.backend) +
        row('stats.fps', this.fps < 0.5 ? t('stats.idle') : this.fps.toFixed(0)) +
        row('stats.points', M(st.drawnPoints)) +
        row('stats.budget', M(this.streamer.pointBudget)) +
        row('stats.nodes', `${st.drawnNodes} / ${st.loadedNodes}`) +
        row('stats.blobs', st.blobs) +
        row('stats.light', light) +
        row('stats.pending', pending) +
        (drop.length ? row('stats.dropped', drop.slice(0, 2).map(pct).join(', ')) : '') +
        (this.slabMpc > 0 ? row('stats.slab', `±${this.slabMpc} ${t('unit.Mpc')}`) : '') +
        row('stats.loading', st.inFlight + st.queued) +
        row('stats.memory', `${gpuMB.toFixed(0)} ${t('unit.MB')}`) +
        row('stats.camDist', formatDistance(D));
    }
  }

  /** screen rectangles covered by UI (labels avoid them) */
  private occluders(): DOMRect[] {
    const out: DOMRect[] = [];
    for (const sel of ['.top .search', '#layers', '#info', '#stats', '.instrument', '#caption', '#timectl']) {
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
    const v = new THREE.Vector3(p[0] - cam[0], p[1] - cam[1], p[2] - cam[2]).applyMatrix4(this.camera.matrixWorldInverse);
    if (v.z >= 0) return null; // behind the camera (NDC z alone rounds to 1 with a tiny near plane)
    v.applyMatrix4(this.camera.projectionMatrix);
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
    lab.textContent = hiD ? t('errbar.range') : t('errbar.lower');
    lab.style.display = len > 24 ? '' : 'none';
  }

  // ------------------------------------------------------------------ picking (GPU)

  private async pick(cx: number, cy: number, fly: boolean) {
    // --- Solar System hook: bodies and probes are picked on the CPU, before the GPU point pick
    const se = this.solar.pickAt(cx, cy);
    if (se) {
      this.showSolar(se);
      if (fly) this.flySolar(se);
      return;
    }
    const hit = await this.picker.pick(cx, cy);
    const L = hit ? this.layers.find((l) => l.code === hit.layerCode) : undefined;
    const n = hit && L ? this.streamer.nodeForSlot(hit.slot) : null;
    if (!hit || !n || n.layer !== L || !n.data || hit.index >= n.meta.count) {
      // a drawn galaxy disk (its points are faded out) is picked on the CPU
      const g = this.shapes.pickAt(cx, cy, this.nav.camPos(), this.camera, window.innerWidth, window.innerHeight);
      if (g) {
        this.showCatalogEntry(g.entry);
        if (fly) void this.nav.flyTo(this.viewFor(g.entry));
      } else if (!fly) this.closeInfo();
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
    let title = `${L.meta?.idPrefix ?? ''}${t('info.pointTitle', { i: String(i) })}`;
    let ext: ReturnType<typeof readExtRecord> | null = null;
    try {
      ext = readExtRecord(await L.loadExt(n), i, L.extStride);
      title = `${L.meta?.idPrefix ?? ''}${ext.id.toString()}`;
    } catch (e) {
      rows.push([t('row.catalogueRecord'), t('row.unavailable', { msg: (e as Error).message })]);
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
        rows.push([t('row.range'), hiOk ? `${formatRange(ext.distLo, ext.distHi)} (±${fmtFixed(frac * 100, frac < 0.1 ? 1 : 0)} %)` : t('row.noUpper', { d: formatDistance(ext.distLo) })]);
      }
    };
    if (kind === 'star') {
      if (ext) rows.push([t('row.apparentG'), fmtFixed(ext.mag, 2)], [t('row.bpRp'), isFinite(ext.color) ? fmtFixed(ext.color, 2) : t('common.na')]);
      distRows(t('row.distMedian'));
      rows.push([t('row.brightnessCode'), t('row.renderingProxy', { m: fmtFixed(M, 1) })]);
    } else {
      if (ext) rows.push([t('row.apparentMag'), fmtFixed(ext.mag, 2)], [t('row.redshift'), fmtFixed(ext.color, 4)]);
      distRows(t('row.comoving'));
      rows.push([t('row.lookback'), describeLookback(dist).ago]);
    }
    rows.push(...this.positionRows(lb, rd.ra, rd.dec));
    const links: [string, string][] = [
      [t('link.simbadPos'), `https://simbad.cds.unistra.fr/simbad/sim-coo?Coord=${rd.ra.toFixed(5)}%20${rd.dec >= 0 ? '%2B' : ''}${rd.dec.toFixed(5)}&CooFrame=ICRS&Radius=10&Radius.unit=arcsec`],
    ];
    if (ext && L.meta?.idPrefix?.startsWith('Gaia DR3')) {
      links.push([t('link.gaia'), `https://vizier.cds.unistra.fr/viz-bin/VizieR-5?-source=I/355/gaiadr3&Source=${ext.id.toString()}`]);
    }
    if (kind === 'galaxy') {
      links.push([t('link.legacy'), `https://www.legacysurvey.org/viewer?ra=${rd.ra.toFixed(5)}&dec=${rd.dec.toFixed(5)}&layer=ls-dr10&zoom=15&mark=${rd.ra.toFixed(5)},${rd.dec.toFixed(5)}`]);
    }
    // the article: the layer's own kind (layers.json `kind`, e.g. lg_galaxy) or its colour mode
    const docKind = (L.cfg as { kind?: string }).kind ?? kind;
    this.infoRefresh = () => void this.showPoint(n, i, xyz, false, lum);
    this.openInfo({
      kind: t(synthetic ? 'info.point.synthetic' : kind === 'star' ? 'info.point.star' : 'info.point.galaxy', { layer: layerTitle(L.cfg) }),
      title,
      italic: kind === 'galaxy',
      rows,
      note: synthetic ? t('info.syntheticNote') : '',
      links,
      fly: flyView,
      doc: docSlugFor({ kind: docKind }),
    });
    this.dirty = true;
  }

  /** Galactic l, b and ICRS RA, Dec rows, in the current number format */
  private positionRows(lb: { l: number; b: number }, ra: number, dec: number): [string, string][] {
    return [
      [t('row.galactic'), `${fmtFixed(lb.l, 3)}°, ${fmtFixed(lb.b, 3)}°`],
      [t('row.radec'), `${fmtFixed(ra, 4)}°, ${dec >= 0 ? '+' : ''}${fmtFixed(dec, 4)}°`],
    ];
  }

  private showCatalogEntry(e: CatalogEntry) {
    if ((e as unknown as SolarEntry).solar) return this.showSolar(e as unknown as SolarEntry); // --- Solar System hook
    const rows: [string, string][] = [];
    if (e.alt?.length) rows.push([t('row.also'), e.alt.slice(0, 3).join(', ')]);
    const has = !!e.xyz && e.dist_pc > 0;
    if (has) {
      rows.push([t('row.distance'), `${formatDistance(e.dist_pc, 4)}${formatLy(e.dist_pc) && e.dist_pc < 1e6 ? ` (${formatLy(e.dist_pc)})` : ''}`]);
      if (Number.isFinite(e.dist_lo_pc) && Number.isFinite(e.dist_hi_pc)) {
        const frac = (e.dist_hi_pc! - e.dist_lo_pc!) / 2 / e.dist_pc;
        rows.push([t('row.range'), `${formatRange(e.dist_lo_pc!, e.dist_hi_pc!)} (±${fmtFixed(frac * 100, frac < 0.1 ? 1 : 0)} %)`]);
      }
    } else rows.push([t('row.distance'), t('row.directionOnly')]);
    if (e.mag !== null && e.mag !== undefined) rows.push([t('row.apparentMag'), fmtFixed(e.mag, 2)]);
    // catalogue facts (labels facts.<key>, units and decimal mark per language) and exoplanets
    const loc = { t: (k: string) => t(k), decimal: decimalSep() };
    rows.push(...factRows(e.facts, loc.t, loc), ...planetRows(e.planets, loc));
    if (e.ra !== undefined && e.dec !== undefined) rows.push(...this.positionRows(galToLB(radecDistToGal(e.ra, e.dec, 1)), e.ra, e.dec));
    let note = e.ref ? t('info.source', { ref: e.ref }) : '';
    const g = e.kind.includes('galaxy') ? this.shapes.shapeFor(e) : null;
    if (g) {
      const src = (k?: string) => (k ? ({ hyperleda: 'HyperLEDA', openngc: 'OpenNGC', leda2003: 'HyperLEDA 2003', ungc: 'UNGC', mcc: 'McConnachie 2012', derived: t('shape.derived') } as Record<string, string>)[k] ?? k : '');
      if (g.major_arcmin) {
        const minor = g.minor_arcmin ?? g.major_arcmin;
        const am = (x: number) => (x >= 100 ? `${fmtFixed(x / 60, 2)}°` : `${fmtNum(x, 3)}′`);
        const size = has ? `${fmtNum((g.major_arcmin * Math.PI / 10800) * e.dist_pc / 1e3, 3)} × ${fmtNum((minor * Math.PI / 10800) * e.dist_pc / 1e3, 3)}\u00a0${t('unit.kpc')}, ` : '';
        rows.push([t('shape.size', { def: g.axes_def ?? 'D25' }), `${size}${am(g.major_arcmin)} × ${am(minor)} (${src(g.axes_src)})`]);
      }
      if (g.morph || (g.t !== null && g.t !== undefined)) rows.push([t('shape.morphology'), `${g.morph ?? ''}${g.t !== null && g.t !== undefined ? `${g.morph ? ', ' : ''}T = ${fmtFixed(g.t, 1)}` : ''} (${src(g.morph_src)})`]);
      if (g.shape === 'disk' && g.incl_deg !== undefined) rows.push([t('shape.inclination'), t('shape.inclinationValue', { deg: g.incl_deg.toFixed(0), src: src(g.incl_src) })]);
      if (g.pa_deg !== undefined) rows.push([t('shape.pa'), t('shape.paValue', { deg: g.pa_deg.toFixed(0), src: src(g.pa_src) })]);
      const ti = this.shapes.thumbInfo(g.name);
      const s = this.shapes.survey;
      const how = ti && 'via' in ti ? (ti.via === 'hips2fits' ? t('shape.how.hips2fits') : t('shape.how.hips', { host: new URL(ti.via).host }))
        : ti && 'error' in ti ? t('shape.how.error', { error: ti.error }) : this.shapes.thumbsEnabled ? t('shape.how.later') : t('shape.how.off');
      note += `${note ? ' ' : ''}${t('shape.note', { survey: s.title, credit: s.credit, how })}`;
    }
    const fly = this.viewFor(e);
    const xyz = e.xyz ?? (radecDistToGal(e.ra ?? 0, e.dec ?? 0, 1e3) as Vec3);
    this.selection = { xyz, title: e.name, fly, ref: { type: 'cat', name: e.name },
      lo: e.dist_lo_pc ?? undefined, hi: e.dist_hi_pc ?? undefined };
    this.infoRefresh = () => this.showCatalogEntry(e);
    this.openInfo({
      kind: t(e.kind === 'exoplanet' ? 'kind.planetary_system' : kindInfo(e.kind).label),
      title: displayName(e.name),
      italic: e.kind.includes('galaxy'),
      rows,
      note,
      links: catalogLinks(e),
      fly,
      doc: e.name === 'Sun' ? 'sun' : docSlugFor(e),
    });
    this.dirty = true;
  }

  /** flight target for a catalogue entry; direction-only entries turn the view from the Sun */
  private viewFor(e: CatalogEntry): Partial<View> {
    if ((e as unknown as SolarEntry).solar) return this.solar.viewFor(e as unknown as SolarEntry); // --- Solar System hook
    if (e.xyz) return { focus: e.xyz.slice() as Vec3, dist: viewDistanceFor(e.kind, e.dist_pc) };
    const d = radecDistToGal(e.ra ?? 0, e.dec ?? 0, 1);
    return { focus: [0, 0, 0], dist: 1e-3, yaw: Math.atan2(-d[1], -d[0]), pitch: Math.asin(-d[2]) };
  }

  private openInfo(o: { kind: string; title: string; italic: boolean; rows: [string, string][]; note: string; links: [string, string][]; fly: Partial<View>; doc?: string }) {
    $('info-kind').textContent = o.kind;
    $('info').dataset.docs = o.doc ?? ''; // docs slug (content contract section 4) for the docs panel
    const ti = $('info-title');
    ti.textContent = o.title;
    ti.classList.toggle('galaxy', o.italic);
    this.showInfoDoc(o.doc, o.title);
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
    this.bh.infoFor(o.title, $('info-fly').parentElement!, this.nav); // --- Black hole hook: "Experience it" button
    $('info').hidden = false;
    document.body.classList.add('has-info');
    this.scheduleHash();
  }

  /** the article summary under the card title and its "Learn more" button (fetched, cached per lang/slug) */
  private showInfoDoc(slug: string | undefined, title: string) {
    const my = ++this.infoToken;
    const sum = $('info-summary');
    const more = $<HTMLButtonElement>('info-more');
    sum.hidden = true;
    more.hidden = !slug;
    if (!slug) return;
    more.setAttribute('aria-label', t('info.learnMoreLabel', { title }));
    more.onclick = () => void this.docs.open(slug);
    void loadArticle(slug, getLang()).then((a) => {
      if (my !== this.infoToken) return;
      if (!a) {
        more.hidden = true;
        return;
      }
      sum.textContent = a.meta.summary;
      sum.lang = a.lang;
      sum.hidden = !a.meta.summary;
    });
  }

  private closeInfo() {
    this.solarSel = null; // --- Solar System hook
    $('info').hidden = true;
    document.body.classList.remove('has-info');
    this.selection = null;
    this.infoRefresh = null;
    this.scheduleHash();
  }

  /** deep-link selection: find the point by stable id along the octree path to its position */
  private async restoreSelection(ref: SelRef) {
    if (ref.type === 'cat') {
      const e = this.findCatalog([ref.name]) ?? this.catalog.find((c) => c.name === ref.name);
      if (e) this.showCatalogEntry(e);
      else this.status(t('status.linkedMissing', { name: ref.name }), 'warn');
      return;
    }
    const L = this.layers.find((l) => l.cfg.id === ref.layer);
    if (!L || L.status !== 'ready' || !L.meta) {
      this.status(t('status.layerMissing', { layer: ref.layer }), 'warn');
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
    this.status(t('status.pointMissing', { id: `${L.meta.idPrefix}${ref.id}` }), 'warn');
  }

  // ------------------------------------------------------------------ Solar System hook

  /** info card for a Solar System body or probe (rows live: refreshed while time runs) */
  private showSolar(e: SolarEntry) {
    const info = solarInfo(this.solar, e);
    const fly = this.solar.viewFor(e);
    this.solarSel = e;
    this.selection = { xyz: e.xyz, title: e.name, fly, ref: { type: 'cat', name: e.name } };
    const title = e.solar.type === 'body' ? tOr(`body.${e.solar.id}`, info.title) : info.title;
    this.infoRefresh = () => this.showSolar(e);
    const rows = info.rows.map(([k, v]) => [k, localNums(v)] as [string, string]);
    this.openInfo({ kind: info.kind, title, italic: false, rows, note: info.note, links: [], fly, doc: info.docs });
    $('info-fly').onclick = () => this.flySolar(e);
    this.dirty = true;
  }

  /** fly to a body, then keep the focus on it while it moves */
  private flySolar(e: SolarEntry, view?: Partial<View>) {
    this.solar.attach(null);
    const id = this.solar.bodyIdOf(e);
    void this.nav.flyTo(view ?? this.solar.viewFor(e)).then((ok) => {
      if (ok && id) {
        this.nav.view.focus = [...this.solar.positionOf(id)] as Vec3;
        this.solar.attach(id);
      }
    });
  }

  private solarUiTick(t: number) {
    const camSun = Math.hypot(...this.nav.camPos());
    const show = this.solar.visible && this.solar.fade > 0.05 && camSun < 0.3;
    if (this.timebar.el.hidden === show) this.timebar.el.hidden = !show;
    if (show) this.timebar.tick();
    if (this.solarSel && !$('info').hidden && this.solar.clock.rate !== 0 && t - this.solarInfoT > 1000) {
      this.solarInfoT = t;
      const info = solarInfo(this.solar, this.solarSel);
      const dds = $('info-rows').querySelectorAll('dd');
      if (dds.length === info.rows.length) info.rows.forEach(([, v], i) => (dds[i].textContent = localNums(v)));
    }
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
    const update = () => {
      active = -1;
      items = buildSuggestions(input.value, this.catalog).map((s) => this.suggestionRow(s));
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
        else if (!items.length && q) {
          items = buildSuggestions(q, this.catalog).map((s) => this.suggestionRow(s));
          choose(0);
        }
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
      if (e.key === 'Escape' && document.activeElement !== input && !this.docs.isOpen) this.closeInfo();
    });
    $('docs-btn').addEventListener('click', () => (this.docs.isOpen ? this.docs.close() : void this.docs.open('index')));

    // panels above the instrument strip are placed from its measured height (it wraps to two rows
    // on narrow screens and grows with the safe-area inset), so they never cover the rail or buttons
    const strip = document.querySelector<HTMLElement>('.instrument')!;
    const setStripH = () => document.documentElement.style.setProperty('--instrument-h', `${Math.ceil(strip.getBoundingClientRect().height)}px`);
    new ResizeObserver(setStripH).observe(strip);
    setStripH();

    const tog = $('layers-toggle');
    tog.addEventListener('click', () => tog.setAttribute('aria-expanded', String(tog.getAttribute('aria-expanded') !== 'true')));
    if (window.innerWidth < 640) tog.setAttribute('aria-expanded', 'false');

    const exp = $<HTMLInputElement>('exposure');
    const expOut = $('exposure-out');
    const setExp = () => {
      this.exposure = +exp.value;
      expOut.textContent = `${this.exposure > 0 ? '+' : ''}${fmtFixed(this.exposure, 2)} ${t('unit.mag')}`;
      this.dirty = true;
    };
    exp.addEventListener('input', setExp);
    setExp();
    const bud = $<HTMLInputElement>('budget');
    const budOut = $('budget-out');
    const setBud = () => {
      this.streamer.pointBudget = Math.round(+bud.value * 1e6);
      budOut.textContent = t('num.millionShort', { n: fmtFixed(+bud.value, 1) });
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
    this.refreshOutputs = () => {
      setExp();
      setBud();
      this.setSlab(this.slabMpc);
    };
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
    $('showme').addEventListener('click', () => void this.showMe());
    $('home').addEventListener('click', () => void this.nav.flyTo({ focus: [0, 0, 0], dist: 6 }));
    $('copy-link').addEventListener('click', async () => {
      this.writeHash();
      try {
        await navigator.clipboard.writeText(location.href);
        this.status(t('status.copied'));
      } catch {
        this.status(t('status.copyFailed'), 'warn');
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
    if ((e as unknown as SolarEntry).solar) { // --- Solar System hook
      this.showSolar(e as unknown as SolarEntry);
      this.flySolar(e as unknown as SolarEntry);
      return;
    }
    this.showCatalogEntry(e);
    const name = displayName(e.name);
    if (e.xyz) this.status(e.dist_pc > 0 ? t('status.goto', { name, d: formatDistance(e.dist_pc) }) : t('status.origin', { name }));
    else this.status(t('status.noDistance', { name }));
    void this.nav.flyTo(this.viewFor(e));
  }

  /** one dropdown row (HTML is built from escaped text only) */
  private suggestionRow(s: SuggestItem): { label: string; run: () => void } {
    const row = (name: string, cls: string, right: string, sub: string) =>
      `<span class="n ${cls}">${esc(name)}</span><span class="d">${esc(right)}</span><span class="a">${esc(sub)}</span>`;
    switch (s.type) {
      case 'catalog': {
        const e = s.entry;
        const dist = e.xyz && e.dist_pc > 0 ? formatDistance(e.dist_pc) : e.xyz ? '' : t('search.directionOnly');
        return {
          label: row(displayName(e.name), e.kind.includes('galaxy') ? 'galaxy' : '', dist, s.matched !== e.name ? s.matched : t(kindInfo(e.kind).label)),
          run: () => this.goToEntry(e),
        };
      }
      case 'alias': {
        const name = t(s.entry.label);
        const sub = s.matched && fold(s.matched) !== fold(name) ? s.matched : t(s.entry.target.type === 'body' ? 'search.body' : 'search.view');
        return { label: row(name, s.entry.target.type === 'view' ? 'galaxy' : '', '', sub), run: () => this.goToAlias(s.entry.target) };
      }
      case 'kind': {
        const doc = s.entry.target.type === 'kind' ? s.entry.target.doc : 'index';
        const count = s.count < 0 ? '' : s.count > 0 ? t('search.kindObjects', { n: s.count }) : t('search.kindNone');
        return {
          label: `<span class="n doc">${esc(t('search.article', { title: t(s.entry.label) }))}</span><span class="d">${esc(count)}</span><span class="a">${esc(t('search.articleHint'))}</span>`,
          run: () => void this.docs.open(doc),
        };
      }
      case 'sesame':
        return {
          label: `<span class="n remote">${esc(t('search.lookup', { q: s.q }))}</span><span class="d"></span><span class="a">${esc(t('search.lookupHint'))}</span>`,
          run: () => void this.sesame(s.q),
        };
    }
  }

  private goToAlias(target: import('./search/aliases').AliasTarget) {
    if (target.type === 'body') this.goToBody(target.id);
    else if (target.type === 'view') this.goToView(target.id);
    else if (target.type === 'catalog') {
      const e = this.findCatalog(target.names);
      if (e) this.goToEntry(e);
    } else void this.docs.open(target.doc);
  }

  /** register live Solar System bodies (called by the Solar System module) */
  registerBodies(p: BodyProvider) {
    this.bodies = p;
  }

  private goToBody(id: string) {
    this.stopTour(false);
    if (this.bodies?.has(id)) {
      this.bodies.focus(id);
      return;
    }
    // the Solar System layer (src/solar): live position, card, and a flight that follows the body
    const se = this.solar.entries.find((e) => e.solar.type === 'body' && e.solar.id === id);
    if (se) {
      if (!this.solar.visible) this.setLayerVisible('solar', true);
      this.showSolar(se);
      this.flySolar(se);
      this.status(t('status.view', { name: tOr(`body.${id}`, se.name) }));
      return;
    }
    const sun = id === 'sun' ? this.findCatalog(['Sun']) : null;
    if (sun) return this.goToEntry(sun);
    this.goToView('solar-system');
    this.status(t('status.bodiesMissing'));
  }

  /** a named view (src/search/aliases.ts): camera only, plus a small card linking its article */
  private goToView(id: string) {
    const v = NAMED_VIEWS[id];
    if (v) this.flyToNamedView(v, () => t(`view.${id}`));
  }

  private flyToNamedView(v: NamedView, title: () => string) {
    this.stopTour(false);
    for (const l of v.show ?? []) if (this.layerVisibility()[l] === false) this.setLayerVisible(l, true);
    const ctx = this.tourContext();
    const focus = resolveTarget(v.target, ctx);
    const dist = typeof v.dist === 'number' ? v.dist : v.dist.galaxyEdge * ctx.galaxyEdgePc();
    const fly: Partial<View> = { focus, dist, pitch: (v.pitchDeg * Math.PI) / 180, ...(v.yawDeg !== undefined ? { yaw: (v.yawDeg * Math.PI) / 180 } : {}) };
    // a view of one catalogue object (Andromeda, M87 …) shows that object's card: facts, links, deep link
    const entry = 'catalog' in v.target ? this.findCatalog(v.target.catalog) : null;
    if (entry) {
      this.showCatalogEntry(entry);
      this.status(t('status.view', { name: displayName(entry.name) }));
      void this.nav.flyTo(fly);
      return;
    }
    const show = () => {
      const name = title();
      const d = Math.hypot(...focus);
      this.selection = { xyz: focus, title: name, fly, ref: null };
      this.infoRefresh = show;
      this.openInfo({
        kind: t('search.view'), title: name, italic: false,
        rows: d > 1e-6 ? [[t('row.distance'), formatDistance(d)]] : [],
        note: v.ref ? t('info.source', { ref: v.ref }) : '', links: [], fly, doc: v.doc,
      });
      this.status(t('status.view', { name }));
    };
    show();
    void this.nav.flyTo(fly);
  }

  /** `#layer=<id>` (docs links, page URLs): switch the layer on and fly to a view that shows it */
  async showLayer(id: string): Promise<boolean> {
    await this.layersReady;
    const vis = this.layerVisibility();
    if (!(id in vis)) {
      this.status(t('status.layerMissing', { layer: id }), 'warn');
      return false;
    }
    if (!vis[id]) this.setLayerVisible(id, true);
    const L = this.layers.find((l) => l.cfg.id === id);
    const cfg = L?.cfg ?? (this.mwCfg?.id === id ? this.mwCfg : this.skyCfg);
    const v = LAYER_VIEWS[id];
    if (v && cfg) this.flyToNamedView({ ...v, ref: cfg.credit }, () => layerTitle(cfg));
    this.scheduleHash();
    return true;
  }

  /**
   * `#focus=<name>` (docs links, page URLs): a Solar System body or view id, a catalogue object by
   * name, alias or slug ("sgr-a-star" ↔ "Sgr A*"), or an exact multilingual alias (src/search/focus.ts).
   */
  focusByName(name: string): boolean {
    const r = resolveFocus(name, this.catalog);
    if (!r) {
      this.status(t('status.focusMissing', { name: name.trim() }), 'warn');
      return false;
    }
    if (r.type === 'catalog') this.goToEntry(r.entry);
    else this.goToAlias(r);
    return true;
  }

  private async sesame(q: string) {
    this.stopTour(false);
    this.status(t('status.sesameLooking', { q }));
    let r: Resolved | null = null;
    try {
      r = await resolveSesame(q);
    } catch (e) {
      this.status(t('status.sesameError', { msg: t('status.sesameUnreachable', { msg: (e as Error).message.replace(/^Sesame unreachable \((.*)\)$/, '$1') }) }), 'warn');
      return;
    }
    if (!r) {
      this.status(t('status.sesameUnknown', { q }), 'warn');
      return;
    }
    this.showResolved(r, q, true);
  }

  private showResolved(r: Resolved, q: string, fly: boolean) {
    const kind = kindFromOtype(r.otype, r.kind);
    const rows: [string, string][] = [[t('row.typeSimbad'), r.otype || t('common.na')], ...this.positionRows(galToLB(r.dir), r.ra, r.dec)];
    rows.push([t('row.distance'), r.distPc !== null ? formatDistance(r.distPc) : t('row.unknown')]);
    const link: [string, string][] = [[t('link.simbad'), `https://simbad.cds.unistra.fr/simbad/sim-id?Ident=${encodeURIComponent(q)}`]];
    const src = sesameSource(r);
    const card = { kind: t('info.sesameKind', { kind: t(kindInfo(kind).label) }), title: r.name, italic: r.kind === 'galaxy', links: link, rows, doc: docSlugFor({ kind }) };
    this.infoRefresh = () => this.showResolved(r, q, false);
    if (r.xyz && r.distPc !== null) {
      const view = { focus: r.xyz, dist: viewDistanceFor(r.kind, r.distPc) };
      this.selection = { xyz: r.xyz, title: r.name, fly: view, ref: null };
      this.openInfo({ ...card, note: t('info.distFrom', { src }), fly: view });
      this.status(t('status.sesameFound', { name: r.name, d: formatDistance(r.distPc), src }));
      if (fly) void this.nav.flyTo(view);
    } else {
      const d = r.dir;
      const view: Partial<View> = { focus: [0, 0, 0], dist: 1e-3, yaw: Math.atan2(-d[1], -d[0]), pitch: Math.asin(-d[2]) };
      this.selection = { xyz: [d[0] * 1e3, d[1] * 1e3, d[2] * 1e3], title: r.name, fly: view, ref: null };
      this.openInfo({ ...card, note: t('info.directionOnly', { src }), fly: view });
      this.status(t('status.sesameDirection', { name: r.name, src }));
      if (fly) void this.nav.flyTo(view);
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
      lookbackText: (d) => describeLookback(d).ago,
      // --- Solar System hook: live body positions for tour beats
      body: (id) => (this.solar.bodies.some((b) => b.def.id === id) ? ([...this.solar.positionOf(id as 'earth')] as Vec3) : null),
      here: () => {
        if (!this.here) return null;
        const v = flyTargetForLatLon(this.here.lat, this.here.lon, this.solar.clock.now());
        return { focus: v.focus, yaw: v.yaw, pitch: v.pitch };
      },
    };
  }

  /** viewer location for "Show me": rounded to 0.01° (~1 km), kept in memory only, never in the URL */
  private here: { lat: number; lon: number } | null = null;
  /** live label pinned to the viewer's place (xyz updated every frame as the Earth moves) */
  private hereLabel: LabelItem | null = null;
  private labelItems: LabelItem[] | null = null;

  /** "Show me": ask for the location (on this click only), then fly cosmic web -> Earth -> here */
  private async showMe() {
    this.stopTour(false);
    if (!this.here && 'geolocation' in navigator) {
      this.status(t('showme.locating'));
      try {
        const pos = await new Promise<GeolocationPosition>((res, rej) =>
          navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 }));
        this.here = { lat: Math.round(pos.coords.latitude * 100) / 100, lon: Math.round(pos.coords.longitude * 100) / 100 };
        this.status('');
        if (!this.hereLabel) {
          this.hereLabel = { name: t('showme.pin'), xyz: [0, 0, 0], kind: 'here', absMag: -60, minScale: 0, maxScale: 5e-7 }; // brightest: wins label culling
          this.labelItems?.push(this.hereLabel);
        }
      } catch (e) {
        this.status(t('showme.denied', { msg: (e as GeolocationPositionError).message || 'denied' }), 'warn');
      }
    } else if (!this.here) {
      this.status(t('showme.denied', { msg: 'no geolocation' }), 'warn');
    }
    const tour = this.here ? SHOW_ME_TOUR : { ...SHOW_ME_TOUR, beats: SHOW_ME_TOUR.beats.filter((b) => !needsHere(b)) };
    await this.runTour(tour);
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
      btn.querySelector('span')!.textContent = t(SCALE_TOUR.label);
      this.tourBeat = null;
      for (const [id, on] of Object.entries(snap.layers)) if (this.layerVisibility()[id] !== on) this.setLayerVisible(id, on);
      if (snap.sel) this.selection = snap.sel;
      if (restoreView) void this.nav.flyTo(snap.view);
    };
    this.tourAbort = restore;
    btn.setAttribute('aria-pressed', 'true');
    btn.querySelector('span')!.textContent = t('tour.stop');
    // on a phone the expanded layers panel would cover the caption and most of the view
    if (window.innerWidth < 640) $('layers-toggle').setAttribute('aria-expanded', 'false');
    this.closeInfo();
    const ctx = this.tourContext();
    for (const beat of tour.beats) {
      if (stopped) return;
      const r = resolveBeat(beat, ctx); // targets resolved now, at playback
      for (const id of beat.show ?? []) this.setLayerVisible(id, true);
      this.showCaption(beat);
      this.solar.attach(null);
      const ok = await this.nav.flyTo({ focus: r.focus, dist: r.dist, pitch: r.pitch, ...(r.yaw !== undefined ? { yaw: r.yaw } : {}) }, { durationScale: 1.15 });
      if (!ok || stopped) return;
      if (beat.follow) this.solar.attach(beat.follow as 'earth'); // moving body: keep the focus on it
      await new Promise((res) => setTimeout(res, this.nav.reducedMotion ? 4000 : beat.dwellMs));
    }
    if (tour.stayAtEnd) {
      // keep the last caption up; the scene (layers) is restored but the camera stays here
      const last = tour.beats[tour.beats.length - 1];
      this.stopTour(false);
      if (last) this.showCaption(last);
      $('caption').hidden = false;
      this.scheduleHash(); // at=Earth: the viewer's own coordinates never go into the URL
      return;
    }
    this.stopTour(true);
  }

  /** caption of a tour beat in the current language */
  private showCaption(beat: Beat) {
    this.tourBeat = beat;
    const r = resolveBeat(beat, this.tourContext());
    const cap = $('caption');
    cap.innerHTML = '<b></b><span></span>';
    cap.querySelector('b')!.textContent = r.title;
    cap.querySelector('span')!.textContent = r.text;
    cap.hidden = false;
  }

  // ------------------------------------------------------------------ deep links

  /** throttled, not debounced: while the focus follows a moving planet the view changes every
   *  frame, and a debounce would never fire, so the URL would never update */
  private scheduleHash() {
    if (this.hashTimer) return;
    this.hashTimer = window.setTimeout(() => {
      this.hashTimer = 0;
      this.writeHash();
    }, 400);
  }

  private writeHash() {
    const v = this.nav.view;
    if (this.tourAbort) return; // a tour ends with its own scheduleHash()
    if (this.nav.flying) return void this.scheduleHash(); // try again once the flight lands
    const at = this.hashAnchor();
    const h = formatHash({
      view: { focus: v.focus, dist: v.dist, yawDeg: v.yaw * DEG, pitchDeg: v.pitch * DEG },
      at: at ?? undefined,
      look: at ? { dist: v.dist, yawDeg: v.yaw * DEG, pitchDeg: v.pitch * DEG } : undefined,
      layers: this.layers.length ? this.layerDiff() : undefined,
      // the anchor already selects its object, so sel=cat:<same name> would only repeat it
      sel: at && this.selection?.ref?.type === 'cat' && this.selection.ref.name === at ? undefined : this.selection?.ref ?? undefined,
      slab: this.slabMpc > 0 ? this.slabMpc : undefined,
      doc: this.docs.current ?? undefined,
    });
    if (location.hash !== h) history.replaceState(null, '', h);
  }

  /** name of the object the camera focus sits on (followed Solar System body, or the selected
   *  catalogue entry when the focus is on it); the URL then stores the name, not raw coordinates */
  private hashAnchor(): string | null {
    const fid = this.solar.followId;
    if (fid) {
      const e = this.solar.entries.find((x) => this.solar.bodyIdOf(x) === fid);
      if (e) return e.name;
    }
    const sel = this.selection;
    if (sel?.ref?.type === 'cat' && sel.xyz) {
      const f = this.nav.view.focus;
      const off = Math.hypot(f[0] - sel.xyz[0], f[1] - sel.xyz[1], f[2] - sel.xyz[2]);
      if (off <= this.nav.view.dist * 1e-3) return sel.ref.name;
    }
    return null;
  }

  /** layer visibility that differs from each layer's default (keeps shared URLs short) */
  private layerDiff(): Record<string, boolean> {
    const def: Record<string, boolean> = {};
    for (const L of this.layers) def[L.cfg.id] = L.cfg.visible;
    if (this.mwCfg) def[this.mwCfg.id] = this.mwCfg.visible;
    if (this.skyCfg) def[this.skyCfg.id] = this.skyCfg.visible;
    def.solar = true;
    const out: Record<string, boolean> = {};
    for (const [id, on] of Object.entries(this.layerVisibility())) if (def[id] !== on) out[id] = on;
    return out;
  }

  /** go to a named anchor (at=) and, once the flight settles, apply the stored distance and angles */
  private goToAnchor(name: string, look?: { dist: number; yawDeg: number; pitchDeg: number }) {
    if (!this.focusByName(name) || !look) return;
    const apply = () => {
      if (this.nav.flying) return void requestAnimationFrame(apply);
      this.nav.setView({ dist: look.dist, yaw: look.yawDeg / DEG, pitch: look.pitchDeg / DEG });
    };
    requestAnimationFrame(apply);
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
    if (h.doc && h.doc !== this.docs.current) void this.docs.open(h.doc);
    else if (!h.doc && this.docs.isOpen && !h.focus && !h.layer) this.docs.close();
    await this.layersReady;
    if (h.layer) await this.showLayer(h.layer);
    if (h.focus) this.focusByName(h.focus);
    else if (h.at && h.at !== this.hashAnchor()) this.goToAnchor(h.at, h.look);
    if (h.focus || h.layer) {
      this.writeHash(); // drop the one-shot focus= from the URL
    }
    if (h.layers) for (const [id, on] of Object.entries(h.layers)) if (this.layerVisibility()[id] !== undefined && this.layerVisibility()[id] !== on) this.setLayerVisible(id, on);
    const cur = this.selection?.ref;
    if (h.sel && JSON.stringify(h.sel) !== JSON.stringify(cur)) void this.restoreSelection(h.sel);
  }

  // ------------------------------------------------------------------ test hooks

  private exposeDebugApi() {
    (window as unknown as { __atlas: unknown }).__atlas = {
      stats: () => ({ backend: this.backend, fps: this.fps, ...this.streamer.stats, budget: this.streamer.pointBudget, view: this.nav.view, slab: this.slabMpc,
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
      shapes: () => this.shapes.stats(),
      /** view of a catalogue galaxy from the Sun's side, its D25 major axis filling `fill` of the height */
      galaxyView: (name: string, fill = 0.6, fromSun = false) => {
        const e = this.findEntry(name);
        const it = e ? this.shapes.itemFor(e) : null;
        if (!e || !e.xyz || !it) return null;
        const d = Math.hypot(...e.xyz);
        const s = e.xyz.map((v) => v / d);
        // fromSun: camera at the Sun (the Earth view); the caller narrows the field with setFov(fovDeg)
        const fovDeg = (2 * Math.atan(it.R / d / fill) * 180) / Math.PI;
        if (fromSun) return { focus: e.xyz.slice(), dist: d * (1 - 1e-9), yaw: Math.atan2(-s[1], -s[0]), pitch: Math.asin(-s[2]), fovDeg };
        const dist = (2 * it.R) / (fill * 2 * Math.tan((this.camera.fov * Math.PI) / 360));
        return { focus: e.xyz.slice(), dist, yaw: Math.atan2(-s[1], -s[0]), pitch: Math.asin(-s[2]) };
      },
      /** CSS-px screen position of a sky offset (arcmin north / east) from a catalogue object, seen from the camera */
      skyPoint: (name: string, northArcmin: number, eastArcmin: number) => {
        const e = this.findEntry(name);
        if (!e || !e.xyz || e.ra === undefined || e.dec === undefined) return null;
        const dec = e.dec + northArcmin / 60;
        const ra = e.ra + eastArcmin / 60 / Math.cos((e.dec * Math.PI) / 180);
        return this.project(radecDistToGal(ra, dec, e.dist_pc), this.nav.camPos());
      },
      /** vertical field of view in degrees (default 55); narrow fields show the Earth view of a galaxy */
      setFov: (deg: number) => {
        this.camera.fov = deg;
        this.camera.updateProjectionMatrix();
        this.dirty = true;
      },
      showEntry: (name: string) => {
        const e = this.findEntry(name);
        if (e) this.showCatalogEntry(e);
        return !!e;
      },
      setSky: (on: boolean) => this.setLayerVisible(this.skyCfg?.id ?? 'gaia-sky', on),
      // --- Solar System hook (captures / tests)
      solar: {
        entries: () => this.solar.entries.map((e) => ({ name: e.name, alt: e.alt, kind: e.kind, distAU: e.dist_pc / 4.84813681109536e-6 })),
        go: (name: string, opts: { dist?: number; yawDeg?: number; pitchDeg?: number; instant?: boolean } = {}) => {
          const e = this.solar.entries.find((x) => x.name === name || x.alt.includes(name));
          if (!e) return false;
          const v = { ...this.solar.viewFor(e), ...(opts.dist ? { dist: opts.dist } : {}) };
          if (opts.yawDeg !== undefined) v.yaw += (opts.yawDeg * Math.PI) / 180;
          if (opts.pitchDeg !== undefined) v.pitch = (opts.pitchDeg * Math.PI) / 180;
          this.showSolar(e);
          if (opts.instant) {
            this.nav.setView(v);
            this.solar.attach(this.solar.bodyIdOf(e));
          } else this.flySolar(e, v);
          return true;
        },
        setTime: (iso: string) => this.solar.clock.set(Date.parse(iso)),
        setSpeed: (s: number) => this.solar.clock.setSpeed(s),
        pause: (p: boolean) => this.solar.clock.setPaused(p),
        now: () => new Date(this.solar.clock.now()).toISOString(),
        pickAt: (x: number, y: number) => this.solar.pickAt(x, y)?.name ?? null,
        screen: () => Object.fromEntries(this.solar.bodies.map((b) => [b.def.id, b.screen])),
        search: (q: string) => searchCatalog(this.catalog, q).map((r) => `${r.entry.name} <- ${r.matched}`),
        layer: this.solar,
        lookDown: (lat: number, lon: number, altKm = 3000) => {
          this.nav.setView(flyTargetForLatLon(lat, lon, this.solar.clock.now(), altKm));
          this.solar.attach('earth');
        },
      },
      // --- Black hole hook (captures / tests)
      bh: { ...this.bh.debugApi(), experience: (name: string) => {
        const h = this.bh.find(name);
        return h ? this.bh.experience(h, this.nav) : Promise.resolve(false);
      }, setView: (v: Partial<View>) => {
        this.nav.minDist = 1e-14; // the black hole hook sets the real floor (1.5 r_s) on the next frame
        this.nav.setView(v);
      },
      /** mean GPU time per rendered frame (ms) over `ms` of continuous rendering; needs ?gputime (timestamp queries) */
      gpuMs: async (ms = 3000) => {
        // three resolves the GPU duration of the most recent frame: sample it once per frame
        this.continuous = true;
        const t0 = performance.now();
        const r0 = this.totalRenders;
        const v: number[] = [];
        while (performance.now() - t0 < ms) {
          await new Promise((res) => requestAnimationFrame(res));
          const d = await this.renderer.resolveTimestampsAsync('render');
          if (typeof d === 'number' && d > 0) v.push(d);
        }
        this.continuous = false;
        v.sort((a, b) => a - b);
        const q = (p: number) => (v.length ? v[Math.min(v.length - 1, Math.floor(p * v.length))] : null);
        return { medianMs: q(0.5), p90Ms: q(0.9), samples: v.length, frames: this.totalRenders - r0, wallMs: performance.now() - t0 };
      } },
      setUncertainty: (on: boolean) => {
        this.streamer.uncertainty = on;
        ($('unc-on') as HTMLInputElement).checked = on;
        this.dirty = true;
      },
    };
  }
}

function smoothstep(a: number, b: number, x: number) {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
}

/** a layer's title in the current language (layer.<id>), else the manifest's */
function layerTitle(c: LayerConfig): string {
  return tOr(`layer.${c.id}`, c.title);
}

/** catalogue names stay as catalogued, except the Sun, which is translated (contract §1) */
function displayName(name: string): string {
  return name === 'Sun' ? t('body.sun') : name;
}

/** English names of the Solar System labels, kept so a language switch can rename them again */
const SOLAR_LABEL_EN = new WeakMap<LabelItem, string>();

/**
 * Numbers written with English separators (src/solar/info.ts) in the current language's form:
 * "6,371 km" → "6 371 km", "0.9896" → "0,9896" for uz/ru. Text without digits is untouched.
 */
function localNums(s: string): string {
  const dec = decimalSep();
  if (dec === '.') return s;
  return s.replace(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d+/g, (m) => m.replace(/,/g, ' ').replace('.', dec));
}

/** Milky Way model label (src/render/milkyway.ts) → i18n key */
const MW_LABEL_KEYS: Record<string, string> = {
  '3-kpc arm': 'mw.3kpc', 'Norma arm': 'mw.norma', 'Scutum-Centaurus arm': 'mw.scutum', 'Sagittarius-Carina arm': 'mw.sagittarius',
  'Local arm': 'mw.local', 'Perseus arm': 'mw.perseus', 'Outer arm': 'mw.outer', 'Galactic bar': 'mw.bar',
};

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** where a Sesame distance came from, in the current language */
function sesameSource(r: Resolved): string {
  const d = r.distInfo;
  if (d.method === 'parallax') return t('sesame.parallax', { plx: fmtFixed(d.plx, 3), err: fmtFixed(d.err, 3) });
  if (d.method === 'redshift') return t('sesame.redshift', { z: fmtFixed(d.z, 5) });
  if (d.method === 'lowz') return t('sesame.lowz', { z: fmtFixed(d.z, 5) });
  return t('sesame.none');
}

/** outbound links of a catalogue entry's info card */
function catalogLinks(e: CatalogEntry): [string, string][] {
  const out: [string, string][] = [];
  if (e.kind === 'exoplanet') out.push([t('link.exoplanetArchive'), `https://exoplanetarchive.ipac.caltech.edu/overview/${encodeURIComponent(e.name)}`]);
  else if (e.name !== 'Sun' && e.kind !== 'message' && e.kind !== 'seti_signal')
    out.push([t('link.simbad'), `https://simbad.cds.unistra.fr/simbad/sim-id?Ident=${encodeURIComponent(e.name)}`]);
  if (e.doi) out.push([t('link.doi'), `https://doi.org/${e.doi}`]);
  return out;
}

const app = new App();
// the Solar System module registers live bodies here: __atlasBodies(provider)
(window as unknown as { __atlasBodies: (p: BodyProvider) => void }).__atlasBodies = (p) => app.registerBodies(p);
void app.start();
