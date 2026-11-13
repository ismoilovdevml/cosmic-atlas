import '@fontsource/spectral/400.css';
import '@fontsource/spectral/400-italic.css';
import '@fontsource/spectral/500.css';
import '@fontsource/spectral/500-italic.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import './style.css';

import * as THREE from 'three/webgpu';
import { isPointLayer, loadCatalogs, loadManifest, loadTilesIndex, type TilesIndex, type CatalogEntry, type LayerConfig, type Manifest } from './data/manifest';
import { resolveSesame, searchCatalog, viewDistanceFor, type Resolved } from './data/resolve';
import { galToLB, galToRadec, type Vec3 } from './math/frames';
import { describeLookback, fmtNum, formatDistance, formatLightTime, formatLy, niceScaleBar } from './math/units';
import { NavController, type View } from './nav/controller';
import { absMagFromLum, appearance } from './render/brightness';
import { LabelLayer, type LabelItem } from './render/labels';
import { MilkyWayModel, R0_PC } from './render/milkyway';
import { PostPass } from './render/post';
import { readExtRecord } from './tiles/format';
import { PointLayer, Streamer, type TileNode } from './tiles/streamer';
import { ScaleRail } from './ui/rail';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const DEG = 180 / Math.PI;

/** auto-exposure: reference magnitude rises with the viewing scale, per layer kind */
const AUTO_EXPOSURE = {
  star: { base: 6.0, perDecade: 0.9 },
  galaxy: { base: -16.5, perDecade: 3.9 },
};

interface Selection {
  xyz: Vec3;
  title: string;
  fly: Partial<View>;
}

class App {
  renderer!: THREE.WebGPURenderer;
  backend: 'WebGPU' | 'WebGL2' = 'WebGL2';
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(55, 1, 1e-9, 1e12);
  nav!: NavController;
  post!: PostPass;
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
  private fpsFrames = 0;
  private fpsT0 = performance.now();
  private lastT = performance.now();
  private dpr = 1;
  private frustum = new THREE.Frustum();
  private pv = new THREE.Matrix4();
  private selection: Selection | null = null;
  private hashTimer = 0;
  private lastUi = 0;
  private tourAbort: (() => void) | null = null;
  private dirty = true;
  private skyAmount = 0;
  private mwFade = 0;

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
    this.nav = new NavController(canvas, this.camera);
    this.labels = new LabelLayer($('labels'));
    this.rail = new ScaleRail($('rail'), $('rail-ticks'), $('rail-mark'));
    this.scene.add(this.mw.points);
    this.resize();
    window.addEventListener('resize', () => this.resize());

    this.wireUi();
    this.nav.onChange = () => (this.dirty = true);
    this.nav.onUserInput = () => this.stopTour();
    this.nav.onClick = (x, y) => this.pick(x, y, false);
    this.nav.onDoubleClick = (x, y) => this.pick(x, y, true);
    this.streamer.onLoaded = () => (this.dirty = true);

    if (!this.readHash()) this.nav.setView({ focus: [0, 0, 0], dist: 6, yaw: (-150 * Math.PI) / 180, pitch: 0.38 });
    window.addEventListener('hashchange', () => this.readHash(true));

    requestAnimationFrame(this.loop);

    try {
      this.manifest = await loadManifest();
    } catch (e) {
      this.status(`Could not load layers.json: ${(e as Error).message}`, 'warn');
      return;
    }
    this.tilesIndex = await loadTilesIndex();
    await this.initLayers();
    void this.initCatalogs();
    this.exposeDebugApi();
  }

  // ------------------------------------------------------------------ layers

  private async initLayers() {
    for (const cfg of this.manifest.layers) {
      if (isPointLayer(cfg)) {
        const L = new PointLayer(cfg);
        this.layers.push(L);
        this.scene.add(L.group);
      } else if (cfg.type === 'milky-way-model') {
        this.mwCfg = cfg;
        this.mw.visible = cfg.visible;
      } else if (cfg.type === 'sky') {
        this.skyCfg = cfg;
        this.sky.visible = cfg.visible;
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
        tex.colorSpace = THREE.NoColorSpace;
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

  private renderLayerPanel() {
    const list = $('layer-list');
    list.textContent = '';
    const missing: string[] = [];
    const row = (opts: {
      id: string; title: string; swatch: string; tag?: [string, string]; meta: string; checked: boolean; opacity: number;
      onToggle: (on: boolean) => void; onOpacity: (v: number) => void; disabled?: boolean;
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
      cb.disabled = !!opts.disabled;
      const rg = li.querySelector<HTMLInputElement>('input[type=range]')!;
      rg.value = String(opts.opacity);
      rg.setAttribute('aria-label', `${opts.title} opacity`);
      rg.hidden = !opts.checked;
      cb.addEventListener('change', () => {
        opts.onToggle(cb.checked);
        rg.hidden = !cb.checked;
        this.dirty = true;
      });
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
      row({
        id: L.cfg.id,
        title: L.cfg.title,
        swatch: L.kind,
        tag: m.synthetic || L.cfg.dev ? ['synthetic', 'synthetic'] : undefined,
        meta: `${fmtNum(m.count / 1e6, 3)} million ${L.kind === 'star' ? 'stars' : 'galaxies'}${L.cfg.credit ? `, ${L.cfg.credit}` : ''}`,
        checked: L.visible,
        opacity: L.opacity,
        onToggle: (on) => {
          L.visible = on;
          if (!on) this.streamer.releaseLayer(L);
        },
        onOpacity: (v) => (L.opacity = v),
      });
    }
    if (this.mwCfg) {
      row({
        id: this.mwCfg.id, title: this.mwCfg.title, swatch: 'model', tag: ['model', 'model'],
        meta: this.mwCfg.credit ?? 'Spiral arms after Reid et al. 2019', checked: this.mw.visible, opacity: this.mw.opacity,
        onToggle: (on) => (this.mw.visible = on), onOpacity: (v) => (this.mw.opacity = v),
      });
    }
    if (this.skyCfg) {
      row({
        id: this.skyCfg.id, title: this.skyCfg.title, swatch: 'sky',
        meta: this.skyCfg.credit ?? '', checked: this.sky.visible, opacity: this.sky.opacity,
        onToggle: (on) => (this.sky.visible = on), onOpacity: (v) => (this.sky.opacity = v),
      });
    }
    $('layer-missing').textContent = missing.length ? `Not built yet: ${missing.join(', ')}.` : '';
    $('credits').innerHTML = '';
    const credits = [
      ...this.layers.filter((L) => L.status === 'ready').map((L) => `${L.cfg.title}: ${L.cfg.credit ?? (L.meta?.synthetic ? 'synthetic development data, not observations' : L.meta?.title ?? '')}`),
      this.mwCfg ? `${this.mwCfg.title}: ${this.mwCfg.credit}` : '',
      this.skyCfg ? `${this.skyCfg.title}: ${this.skyCfg.credit}` : '',
      'Name resolution: CDS Sesame (via the VizieR mirror at CfA). Distances for redshifts use Planck18 comoving distance.',
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
    const items: LabelItem[] = entries.map((e) => {
      const d = e.dist_pc;
      const absMag = e.mag !== null && e.mag !== undefined && d > 0 ? e.mag - 5 * Math.log10(d / 10) : null;
      return {
        name: e.name,
        xyz: e.xyz,
        kind: e.kind,
        absMag: e.name === 'Sun' ? 4.83 : absMag,
        // the Sun is labelled up to Milky Way scale; whole-galaxy entries only beyond it
        ...(e.name === 'Sun' ? { maxScale: 2e5 } : /^milky way/i.test(e.name) ? { minScale: 2e5, maxScale: Infinity } : {}),
        onClick: () => this.showCatalogEntry(e),
      };
    });
    // a "you are here" anchor for extragalactic scales, and the Milky Way model features
    if (!entries.some((e) => /^milky way/i.test(e.name))) items.push({ name: 'Milky Way', xyz: [R0_PC, 0, 0], kind: 'galaxy', absMag: -20.8, minScale: 2e5,
      onClick: () => this.nav.flyTo({ focus: [R0_PC, 0, 0], dist: 6e4, pitch: 1.5 }) });
    for (const m of this.mw.labels) items.push({ name: m.name, xyz: m.xyz, kind: 'model', absMag: null, minScale: 4000, maxScale: 2e5 });
    this.labels.setItems(items);
    this.dirty = true;
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
    this.fpsFrames++;
    if (t - this.fpsT0 > 1000) {
      this.fps = (this.fpsFrames * 1000) / (t - this.fpsT0);
      this.fpsFrames = 0;
      this.fpsT0 = t;
    }
    this.nav.update(dt);
    this.nav.applyToCamera();
    const cam = this.nav.camPos();
    const D = this.nav.view.dist;
    const pxPerRad = this.pxPerRad();

    // frustum in relative-to-eye space
    this.camera.near = 1e-9;
    this.camera.far = 1e12;
    this.camera.updateProjectionMatrix();
    this.pv.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pv);
    const st = this.streamer.update({ camPos: cam, frustum: this.frustum, pxPerRad, frame: this.frame });

    // adaptive near/far from the nearest / farthest drawn node (contract section 5)
    const nearest = Math.min(st.nearestPc, D);
    this.camera.near = Math.max(1e-10, Math.min(nearest * 0.5, D * 1e-3));
    this.camera.far = Math.max(this.camera.near * 1e6, st.farthestPc * 2, D * 1e3, 1e11);
    this.camera.updateProjectionMatrix();

    const logD = Math.log10(Math.max(D, 1e-9));
    for (const L of this.layers) {
      const u = L.uniforms;
      const ae = AUTO_EXPOSURE[L.kind];
      u.mRef.value = ae.base + ae.perDecade * Math.max(-2, logD) + this.exposure + (L.cfg.magOffset ?? 0);
      u.pxPerRad.value = pxPerRad;
      u.dpr.value = this.dpr;
      u.opacity.value = L.opacity;
    }
    this.mwFade = this.mw.update(cam, pxPerRad, this.dpr);
    const camFromSun = Math.hypot(cam[0], cam[1], cam[2]);
    const skyFade = 1 - smoothstep(1500, 2500, camFromSun);
    this.skyAmount = this.sky.visible && this.sky.loaded ? this.sky.opacity * skyFade : 0;

    this.post.render(this.camera, this.skyAmount);

    this.labels.modelOpacity = this.mwFade * (this.mw.visible ? 1 : 0);
    this.labels.update(this.camera, cam, D, window.innerWidth, window.innerHeight, this.occluders());
    this.updateReticle(cam);
    if (t - this.lastUi > 120) {
      this.lastUi = t;
      this.updateReadouts(D, st);
    }
    if (this.dirty) {
      this.dirty = false;
      clearTimeout(this.hashTimer);
      this.hashTimer = window.setTimeout(() => this.writeHash(), 400);
    }
  };

  // ------------------------------------------------------------------ readouts

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
      stats.innerHTML =
        `<span>Renderer</span><b>${this.backend}</b>` +
        `<span>FPS</span><b>${this.fps.toFixed(0)}</b>` +
        `<span>Points drawn</span><b>${fmtNum(st.drawnPoints / 1e6, 3)} M</b>` +
        `<span>Budget</span><b>${fmtNum(this.streamer.pointBudget / 1e6, 3)} M</b>` +
        `<span>Nodes drawn / loaded</span><b>${st.drawnNodes} / ${st.loadedNodes}</b>` +
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

  private updateReticle(cam: Vec3) {
    const r = $('reticle');
    if (!this.selection) {
      r.style.display = 'none';
      return;
    }
    const s = this.selection.xyz;
    const v = new THREE.Vector3(s[0] - cam[0], s[1] - cam[1], s[2] - cam[2]).project(this.camera);
    if (v.z > 1 || v.z < -1) {
      r.style.display = 'none';
      return;
    }
    r.style.display = 'block';
    r.style.transform = `translate(${((v.x * 0.5 + 0.5) * window.innerWidth).toFixed(1)}px, ${((-v.y * 0.5 + 0.5) * window.innerHeight).toFixed(1)}px)`;
  }

  // ------------------------------------------------------------------ picking

  private pick(cx: number, cy: number, fly: boolean) {
    const cam = this.nav.camPos();
    const W = this.renderer.domElement.width;
    const H = this.renderer.domElement.height;
    const px = cx * this.dpr;
    const py = cy * this.dpr;
    const pxPerRad = this.pxPerRad();
    const P = this.camera.projectionMatrix.elements;
    const V = this.camera.matrixWorldInverse.elements;
    // click ray in RTE space for cheap node rejection
    const ndc = new THREE.Vector3((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1, 0.5).unproject(this.camera).normalize();
    let best: { node: TileNode; i: number; score: number; xyz: Vec3 } | null = null;
    const radius = 10 * this.dpr;
    const m = new THREE.Matrix4();
    for (const n of this.streamer.drawn()) {
      if (!n.data) continue;
      const c = n.meta.center;
      const rel = [c[0] - cam[0], c[1] - cam[1], c[2] - cam[2]];
      const along = rel[0] * ndc.x + rel[1] * ndc.y + rel[2] * ndc.z;
      const R = n.meta.half * Math.sqrt(3);
      const perp2 = rel[0] ** 2 + rel[1] ** 2 + rel[2] ** 2 - along * along;
      const slack = (Math.max(along, 0) / pxPerRad) * radius * 2;
      if (along < -R || perp2 > (R + slack) ** 2) continue;
      // MVP for this node in float64
      m.fromArray(P).multiply(new THREE.Matrix4().fromArray(V)).multiply(new THREE.Matrix4().makeTranslation(rel[0], rel[1], rel[2]));
      const e = m.elements;
      const pos = n.data.positions;
      const lum = n.data.rgbl;
      const kind = n.layer.kind;
      const mRef = n.layer.uniforms.mRef.value;
      for (let i = 0, cnt = n.meta.count; i < cnt; i++) {
        const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
        const w = e[3] * x + e[7] * y + e[11] * z + e[15];
        if (w <= 0) continue;
        const sx = ((e[0] * x + e[4] * y + e[8] * z + e[12]) / w * 0.5 + 0.5) * W;
        const sy = (-(e[1] * x + e[5] * y + e[9] * z + e[13]) / w * 0.5 + 0.5) * H;
        const d2 = (sx - px) ** 2 + (sy - py) ** 2;
        if (d2 > radius * radius * 9) continue;
        const r = Math.hypot(rel[0] + x, rel[1] + y, rel[2] + z);
        const a = appearance(absMagFromLum(lum[i * 4 + 3], kind), r, kind, mRef, pxPerRad, this.dpr);
        if (a.intensity < 0.02) continue; // too faint to see: not clickable
        const reach = Math.max(radius, a.sizePx / 2);
        if (d2 > reach * reach) continue;
        const score = Math.min(a.intensity, 50) * a.sizePx / (1 + d2 / (16 * this.dpr * this.dpr));
        if (!best || score > best.score) best = { node: n, i, score, xyz: [c[0] + x, c[1] + y, c[2] + z] };
      }
    }
    if (!best) {
      if (!fly) this.closeInfo();
      return;
    }
    void this.showPoint(best.node, best.i, best.xyz, fly);
  }

  private async showPoint(n: TileNode, i: number, xyz: Vec3, fly: boolean) {
    const L = n.layer;
    const kind = L.kind;
    const lum = n.data ? n.data.rgbl[i * 4 + 3] : 0;
    const M = absMagFromLum(lum, kind);
    const dist = Math.hypot(...xyz);
    const flyView: Partial<View> = { focus: xyz, dist: kind === 'star' ? Math.max(0.2, Math.min(5, dist * 0.02)) : 2e5 };
    this.selection = { xyz, title: '', fly: flyView };
    if (fly) void this.nav.flyTo(flyView);
    const synthetic = !!(L.meta?.synthetic || L.cfg.dev);
    const rows: [string, string][] = [];
    let title = `${L.meta?.idPrefix ?? ''}point ${i}`;
    let ext: { id: bigint; mag: number; color: number } | null = null;
    try {
      ext = readExtRecord(await L.loadExt(n), i);
      title = `${L.meta?.idPrefix ?? ''}${ext.id.toString()}`;
    } catch (e) {
      rows.push(['Catalogue record', `unavailable (${(e as Error).message})`]);
    }
    const lb = galToLB(xyz);
    const rd = galToRadec(xyz);
    if (kind === 'star') {
      if (ext) rows.push(['Apparent G', ext.mag.toFixed(2)], ['BP − RP', isFinite(ext.color) ? ext.color.toFixed(2) : 'n/a']);
      rows.push(['Absolute G', M.toFixed(1)]);
      rows.push(['Distance', `${formatDistance(dist)}${formatLy(dist) ? ` (${formatLy(dist)})` : ''}`]);
    } else {
      if (ext) rows.push(['Apparent r', ext.mag.toFixed(2)], ['Redshift z', ext.color.toFixed(4)]);
      rows.push(['Absolute r', M.toFixed(1)]);
      rows.push(['Comoving distance', formatDistance(dist)]);
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
  }

  private showCatalogEntry(e: CatalogEntry) {
    const rows: [string, string][] = [];
    if (e.alt?.length) rows.push(['Also', e.alt.slice(0, 3).join(', ')]);
    if (e.dist_pc > 0) rows.push(['Distance', `${formatDistance(e.dist_pc)}${formatLy(e.dist_pc) ? ` (${formatLy(e.dist_pc)})` : ''}`]);
    if (e.mag !== null && e.mag !== undefined) rows.push(['Apparent mag', e.mag.toFixed(2)]);
    if (e.dist_pc > 0) {
      const lb = galToLB(e.xyz);
      rows.push(['Galactic l, b', `${lb.l.toFixed(3)}°, ${lb.b.toFixed(3)}°`]);
    }
    if (e.ra !== undefined && e.dec !== undefined && e.dist_pc > 0) rows.push(['RA, Dec (ICRS)', `${e.ra.toFixed(4)}°, ${e.dec >= 0 ? '+' : ''}${e.dec.toFixed(4)}°`]);
    const fly = { focus: e.xyz.slice() as Vec3, dist: viewDistanceFor(e.kind, e.dist_pc) };
    this.selection = { xyz: e.xyz, title: e.name, fly };
    this.openInfo({
      kind: kindLabel(e.kind),
      title: e.name,
      italic: e.kind.includes('galaxy'),
      rows,
      note: e.ref ? `Source: ${e.ref}` : '',
      links: e.name === 'Sun' ? [] : [['SIMBAD', `https://simbad.cds.unistra.fr/simbad/sim-id?Ident=${encodeURIComponent(e.alt?.[0] && e.kind === 'star' ? e.name : e.name)}`]],
      fly,
    });
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
  }

  private closeInfo() {
    $('info').hidden = true;
    document.body.classList.remove('has-info');
    this.selection = null;
  }

  // ------------------------------------------------------------------ search

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
        label: `<span class="n ${s.entry.kind.includes('galaxy') ? 'galaxy' : ''}">${esc(s.entry.name)}</span><span class="d">${s.entry.dist_pc > 0 ? esc(formatDistance(s.entry.dist_pc)) : ''}</span>${s.matched !== s.entry.name ? `<span class="a">${esc(s.matched)}</span>` : `<span class="a">${esc(kindLabel(s.entry.kind))}</span>`}`,
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

    // layers panel collapse
    const tog = $('layers-toggle');
    tog.addEventListener('click', () => tog.setAttribute('aria-expanded', String(tog.getAttribute('aria-expanded') !== 'true')));
    if (window.innerWidth < 640) tog.setAttribute('aria-expanded', 'false');

    // display settings
    const exp = $<HTMLInputElement>('exposure');
    const expOut = $('exposure-out');
    const setExp = () => {
      this.exposure = +exp.value;
      expOut.textContent = `${this.exposure > 0 ? '+' : ''}${this.exposure.toFixed(2)} mag`;
    };
    exp.addEventListener('input', setExp);
    setExp();
    const bud = $<HTMLInputElement>('budget');
    const budOut = $('budget-out');
    const setBud = () => {
      this.streamer.pointBudget = Math.round(+bud.value * 1e6);
      budOut.textContent = `${(+bud.value).toFixed(1)} M`;
    };
    bud.addEventListener('input', setBud);
    setBud();
    const det = $<HTMLInputElement>('detail');
    const detOut = $('detail-out');
    const setDet = () => {
      this.streamer.minNodePx = 460 - +det.value; // right = more detail
      detOut.textContent = `${det.value}`;
    };
    det.addEventListener('input', setDet);
    setDet();
    $<HTMLInputElement>('labels-on').addEventListener('change', (e) => (this.labels.enabled = (e.target as HTMLInputElement).checked));
    $<HTMLInputElement>('stats-on').addEventListener('change', (e) => ($('stats').hidden = !(e.target as HTMLInputElement).checked));

    $('info-close').addEventListener('click', () => this.closeInfo());
    $('tour').addEventListener('click', () => (this.tourAbort ? this.stopTour() : void this.runTour()));
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
      this.stopTour();
      if (commit) void this.nav.flyTo({ dist: Math.pow(10, logD) }, { durationScale: 0.6 });
      else {
        this.nav.cancelFlight();
        this.nav.zoomBy(Math.pow(10, logD) / this.nav.view.dist);
      }
    };
  }

  private goToEntry(e: CatalogEntry) {
    this.stopTour();
    this.showCatalogEntry(e);
    this.status(`${e.name}: ${e.dist_pc > 0 ? formatDistance(e.dist_pc) + ' from the Sun' : 'the origin of the map'}.`);
    void this.nav.flyTo({ focus: e.xyz.slice() as Vec3, dist: viewDistanceFor(e.kind, e.dist_pc) });
  }

  private async sesame(q: string) {
    this.stopTour();
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
    if (r.xyz && r.distPc !== null) {
      const fly = { focus: r.xyz, dist: viewDistanceFor(r.kind, r.distPc) };
      this.selection = { xyz: r.xyz, title: r.name, fly };
      this.openInfo({ kind: `Resolved by Sesame (${r.kind})`, title: r.name, italic: r.kind === 'galaxy', rows,
        note: `Distance from ${r.distSource}.`, links: [['SIMBAD', `https://simbad.cds.unistra.fr/simbad/sim-id?Ident=${encodeURIComponent(q)}`]], fly });
      this.status(`${r.name}: ${formatDistance(r.distPc)} (${r.distSource}).`);
      void this.nav.flyTo(fly);
    } else {
      // direction only: stand at the Sun and look toward it
      const d = r.dir;
      const view: Partial<View> = { focus: [0, 0, 0], dist: 1e-3, yaw: Math.atan2(-d[1], -d[0]), pitch: Math.asin(-d[2]) };
      this.selection = { xyz: [d[0] * 1e3, d[1] * 1e3, d[2] * 1e3], title: r.name, fly: view };
      this.openInfo({ kind: `Resolved by Sesame (${r.kind})`, title: r.name, italic: r.kind === 'galaxy', rows,
        note: `Direction only: ${r.distSource}. The view turns toward it from the Sun.`, links: [['SIMBAD', `https://simbad.cds.unistra.fr/simbad/sim-id?Ident=${encodeURIComponent(q)}`]], fly: view });
      this.status(`${r.name}: no usable distance (${r.distSource}); looking toward it from the Sun.`);
      void this.nav.flyTo(view);
    }
  }

  private status(msg: string, tone: 'info' | 'warn' = 'info') {
    const s = $('search-status');
    s.textContent = msg;
    s.dataset.tone = tone;
  }

  // ------------------------------------------------------------------ tour

  private stopTour() {
    if (this.tourAbort) {
      this.tourAbort();
      this.tourAbort = null;
    }
  }

  private async runTour() {
    const btn = $('tour');
    const cap = $('caption');
    let stopped = false;
    this.tourAbort = () => {
      stopped = true;
      this.nav.cancelFlight();
      cap.hidden = true;
      btn.setAttribute('aria-pressed', 'false');
      btn.querySelector('span')!.textContent = 'Scale tour';
    };
    btn.setAttribute('aria-pressed', 'true');
    btn.querySelector('span')!.textContent = 'Stop tour';
    this.closeInfo();
    const prox = this.catalog.find((e) => e.name === 'Proxima Centauri')?.xyz ?? ([0.9024, -0.9364, -0.0438] as Vec3);
    const m31 = this.catalog.find((e) => /andromeda/i.test(e.name))?.xyz ?? ([-368258, 608681, -281281] as Vec3);
    const lg: Vec3 = [m31[0] * 0.4 + R0_PC * 0.6, m31[1] * 0.4, m31[2] * 0.4];
    const edge = this.layers.filter((L) => L.kind === 'galaxy' && L.active && L.root).reduce((a, L) => Math.max(a, L.root!.meta.half), 0) || 2.5e9;
    const steps: { title: string; text: string; view: Partial<View>; hold: number }[] = [
      { title: 'The Sun', text: 'Home. This view is about 200 AU across; the nearest star is 270,000 times farther than the Earth is from the Sun.',
        view: { focus: [0, 0, 0], dist: 1e-3, pitch: 0.35 }, hold: 3000 },
      { title: 'Proxima Centauri', text: 'The nearest star, 1.30 pc away. Its light takes 4.2 years to reach us.',
        view: { focus: prox, dist: 1.6, pitch: 0.3 }, hold: 3200 },
      { title: 'The solar neighbourhood', text: 'Stars within 1 kpc of the Sun, the reach of Gaia parallaxes in this map. Light crosses it in about 6,500 years.',
        view: { focus: [0, 0, 0], dist: 3200, pitch: 0.45 }, hold: 3800 },
      { title: 'The Milky Way', text: 'Our galaxy seen face-on. This is a model of the spiral arms (Reid et al. 2019), not data. The Sun sits 8.2 kpc from the centre.',
        view: { focus: [R0_PC, 0, 0], dist: 7e4, pitch: 1.53 }, hold: 4200 },
      { title: 'The Local Group', text: 'The Milky Way, Andromeda and their satellites, about 3 Mpc across.',
        view: { focus: lg, dist: 2.6e6, pitch: 0.5 }, hold: 3600 },
      { title: 'The cosmic web', text: `Galaxies trace filaments around empty voids. Light from the far side of this view left ${describeLookback(edge * 0.9).text.replace('light left ', '')}.`,
        view: { focus: [0, 0, 0], dist: edge * 2.4, pitch: 0.5 }, hold: 4500 },
    ];
    for (const s of steps) {
      if (stopped) return;
      cap.innerHTML = '<b></b><span></span>';
      cap.querySelector('b')!.textContent = s.title;
      cap.querySelector('span')!.textContent = s.text;
      cap.hidden = false;
      const ok = await this.nav.flyTo(s.view, { durationScale: 1.15 });
      if (!ok || stopped) return;
      await new Promise((r) => setTimeout(r, this.nav.reducedMotion ? 4000 : s.hold));
    }
    this.stopTour();
  }

  // ------------------------------------------------------------------ deep links

  private writeHash() {
    const v = this.nav.view;
    if (this.nav.flying) return;
    const h = `#v=${v.focus.map((x) => +x.toPrecision(9)).join(',')},${+v.dist.toPrecision(6)},${(v.yaw * DEG).toFixed(2)},${(v.pitch * DEG).toFixed(2)}`;
    if (location.hash !== h) history.replaceState(null, '', h);
  }

  private readHash(animate = false): boolean {
    const m = location.hash.match(/v=([-\d.e+]+),([-\d.e+]+),([-\d.e+]+),([\d.e+-]+),([-\d.]+),([-\d.]+)/i);
    if (!m) return false;
    const n = m.slice(1).map(Number);
    if (n.some((x) => !isFinite(x)) || n[3] <= 0) return false;
    const v: View = { focus: [n[0], n[1], n[2]], dist: n[3], yaw: n[4] / DEG, pitch: n[5] / DEG };
    const cur = this.nav.view;
    const same = Math.abs(Math.log(v.dist / cur.dist)) < 1e-4 && Math.hypot(v.focus[0] - cur.focus[0], v.focus[1] - cur.focus[1], v.focus[2] - cur.focus[2]) < v.dist * 1e-5;
    if (same) return true;
    if (animate) void this.nav.flyTo(v);
    else this.nav.setView(v);
    return true;
  }

  // ------------------------------------------------------------------ test hooks

  private exposeDebugApi() {
    (window as unknown as { __atlas: unknown }).__atlas = {
      stats: () => ({ backend: this.backend, fps: this.fps, ...this.streamer.stats, budget: this.streamer.pointBudget, view: this.nav.view, layers: this.layers.map((L) => ({ id: L.cfg.id, status: L.status, active: L.active })) }),
      setView: (v: Partial<View>) => this.nav.setView(v),
      flyTo: (v: Partial<View>) => this.nav.flyTo(v),
      pickAt: (x: number, y: number) => this.pick(x, y, false),
    };
  }
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
