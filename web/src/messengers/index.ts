/**
 * Multi-messenger feature: the CMB shell, the sky background chooser, fast radio bursts and
 * high-energy neutrinos. main.ts talks to it through a handful of marked hooks ("--- Messengers
 * hook"); everything else lives here.
 *
 * Layers (web/public/layers.json):
 *   type "cmb"      the last scattering surface (src/messengers/cmb.ts, drawn by the post pass)
 *   type "markers"  sky directions from `data` (a column table in tiles/catalogs/) plus the 3D
 *                   catalogue entries of `kind` (frb-hosts.json, neutrino-sources.json)
 *   the sky layer's `backgrounds` list feeds the background chooser
 */

import * as THREE from 'three/webgpu';
import type { CatalogEntry, ModelLayerConfig } from '../data/manifest';
import { fetchJson } from '../data/tilebase';
import { t, tOr, fmtFixed } from '../i18n';
import type { Vec3 } from '../math/frames';
import type { View } from '../nav/controller';
import { kindColor } from '../objects/kinds';
import type { CmbFrame, PostPass } from '../render/post';
import { BackgroundChooser, type SkyBackground } from './backgrounds';
import { CMB_RADIUS_PC, CmbShell, limbAnchor } from './cmb';
import { frbItems, neutrinoItems, type SkyTable } from './data';
import { GLYPH, MarkerSet, size3d } from './markers';

export interface MessengerHooks {
  post: PostPass;
  scene: THREE.Scene;
  /** tile origin ending in '/' (src/data/tilebase.ts) */
  tileBase: () => string;
  dirty: () => void;
  /** catalogue labels changed (a layer that owns a kind was switched) */
  rebuildLabels: () => void;
  /** layer panel rows changed (counts arrived, background switched) */
  renderPanel: () => void;
}

export interface PanelRow {
  id: string;
  title: string;
  swatch: string;
  meta: string;
  checked: boolean;
  opacity: number;
  onOpacity: (v: number) => void;
  loading?: boolean;
}

interface MarkerLayer {
  cfg: ModelLayerConfig;
  set: MarkerSet;
  kind: string;
  status: 'pending' | 'ready' | 'error';
  n3d: number;
}

export class MessengerFeature {
  cmb: CmbShell | null = null;
  cmbCfg: ModelLayerConfig | null = null;
  readonly markers = new Map<string, MarkerLayer>();
  bg: BackgroundChooser | null = null;
  private skyCfg: ModelLayerConfig | null = null;
  private cmbEntry: CatalogEntry | null = null;
  private cmbAmount = 0;
  private readonly up = new THREE.Vector3();

  constructor(private readonly h: MessengerHooks) {}

  /** layers.json entries this feature owns */
  claims(cfg: { type?: string }): boolean {
    return cfg.type === 'cmb' || cfg.type === 'markers';
  }

  addLayer(cfg: ModelLayerConfig, vis?: boolean) {
    const on = vis ?? cfg.visible;
    if (cfg.type === 'cmb') {
      this.cmbCfg = cfg;
      this.cmb = new CmbShell(cfg.image ?? 'sky/planck_smica_cmb.jpg', (tex, w) => {
        this.h.post.setCmb(tex, w);
        this.h.dirty();
      });
      this.cmb.visible = on;
      return;
    }
    const kind = cfg.kind ?? cfg.id;
    const set = new MarkerSet(cfg.id, kindColor(kind));
    set.visible = on;
    this.markers.set(cfg.id, { cfg, set, kind, status: 'pending', n3d: 0 });
    this.h.scene.add(set.group);
  }

  /** the sky layer: its `backgrounds` list becomes the chooser */
  setSkyConfig(cfg: ModelLayerConfig) {
    this.skyCfg = cfg;
    const list = cfg.backgrounds as SkyBackground[] | undefined;
    if (!list?.length) return;
    this.bg = new BackgroundChooser(list, this.h.post);
    this.bg.onChange = () => {
      this.h.renderPanel();
      this.h.dirty();
    };
  }

  config(id: string): ModelLayerConfig | undefined {
    return this.cmbCfg?.id === id ? this.cmbCfg : this.markers.get(id)?.cfg;
  }

  // ------------------------------------------------------------------ catalogue

  /** 3D markers from the loaded catalogue, then the sky tables (appended to the catalogue for search) */
  async attachCatalog(catalog: CatalogEntry[]) {
    this.cmbEntry = catalog.find((e) => e.kind === 'cmb' && e.xyz) ?? null;
    for (const L of this.markers.values()) {
      const items = catalog.filter((e) => e.kind === L.kind && e.xyz).map((e) => {
        const glyph = L.kind === 'neutrino' ? GLYPH.source : GLYPH.host;
        return { entry: e, xyz: e.xyz as Vec3, glyph, sizePx: size3d(glyph), weight: 1 };
      });
      L.set.set3D(items);
      L.n3d = items.length;
    }
    await Promise.all([...this.markers.values()].map(async (L) => {
      if (!L.cfg.data) {
        L.status = 'ready';
        return;
      }
      const r = await fetchJson<SkyTable>(`${this.h.tileBase()}catalogs/${L.cfg.data}`);
      if (r.status !== 'ok' || !r.data || !Array.isArray(r.data.rows)) {
        L.status = 'error';
        console.warn(`[messengers] ${L.cfg.data} not loaded (${r.status})`);
        return;
      }
      const items = L.kind === 'neutrino' ? neutrinoItems(r.data) : frbItems(r.data);
      L.set.setSky(items);
      catalog.push(...items.map((i) => i.entry));
      L.status = 'ready';
    }));
    this.h.renderPanel();
    this.h.dirty();
  }

  /** catalogue labels of this kind are hidden (their layer is off) */
  hidesKind(kind: string): boolean {
    if (kind === 'cmb') return !!this.cmb && !this.cmb.visible;
    for (const L of this.markers.values()) if (L.kind === kind) return !L.set.visible;
    return false;
  }

  // ------------------------------------------------------------------ panel

  panelRows(): PanelRow[] {
    const rows: PanelRow[] = [];
    const cmb = this.cmb;
    if (this.cmbCfg && cmb) {
      rows.push({
        id: this.cmbCfg.id, title: tOr(`layer.${this.cmbCfg.id}`, this.cmbCfg.title), swatch: 'cmb',
        meta: `${t('layers.cmbMeta', { gpc: fmtFixed(CMB_RADIUS_PC / 1e9, 2) })}, ${this.cmbCfg.credit ?? ''}`,
        checked: cmb.visible, opacity: cmb.opacity, onOpacity: (v) => (cmb.opacity = v),
      });
    }
    for (const L of this.markers.values()) {
      const c = L.set.count();
      const meta = L.status === 'pending' ? t('layers.loading')
        : L.kind === 'frb' ? t('layers.frbMeta', { hosts: c.d3, sky: fmtFixed(c.sky, 0) })
          : t('layers.neutrinoMeta', { alerts: fmtFixed(c.sky, 0), sources: c.d3 });
      rows.push({
        id: L.cfg.id, title: tOr(`layer.${L.cfg.id}`, L.cfg.title), swatch: L.kind,
        meta: `${meta}${L.cfg.credit ? `, ${L.cfg.credit}` : ''}`, checked: L.set.visible, opacity: L.set.opacity,
        onOpacity: (v) => (L.set.opacity = v), loading: L.status === 'pending',
      });
    }
    return rows;
  }

  /** the background chooser goes under the sky layer's row */
  decoratePanel(list: HTMLElement) {
    if (!this.bg || !this.skyCfg) return;
    const li = list.querySelector<HTMLElement>(`li[data-id="${this.skyCfg.id}"]`);
    if (li) this.bg.decorate(li);
  }

  /** the sky row's credit line: the background on show */
  skyCredit(fallback: string): string {
    const b = this.bg?.current;
    return b ? b.short ?? b.credit : fallback;
  }

  credits(): string[] {
    const out: string[] = [];
    if (this.bg) for (const b of this.bg.list) out.push(`${this.bg.title(b)}: ${b.credit}`);
    if (this.cmbCfg?.credit) out.push(`${tOr(`layer.${this.cmbCfg.id}`, this.cmbCfg.title)}: ${this.cmbCfg.credit}`);
    for (const L of this.markers.values()) if (L.cfg.credit) out.push(`${tOr(`layer.${L.cfg.id}`, L.cfg.title)}: ${L.cfg.credit}`);
    return out;
  }

  // ------------------------------------------------------------------ visibility

  setVisible(id: string, on: boolean): boolean {
    if (this.cmbCfg?.id === id && this.cmb) this.cmb.visible = on;
    else {
      const L = this.markers.get(id);
      if (!L) return false;
      L.set.visible = on;
    }
    this.h.rebuildLabels();
    this.h.dirty();
    return true;
  }

  visibility(): Record<string, boolean> {
    const out: Record<string, boolean> = {};
    if (this.cmbCfg && this.cmb) out[this.cmbCfg.id] = this.cmb.visible;
    for (const L of this.markers.values()) out[L.cfg.id] = L.set.visible;
    return out;
  }

  defaults(): Record<string, boolean> {
    const out: Record<string, boolean> = {};
    if (this.cmbCfg) out[this.cmbCfg.id] = this.cmbCfg.visible;
    for (const L of this.markers.values()) out[L.cfg.id] = L.cfg.visible;
    return out;
  }

  // ------------------------------------------------------------------ per frame

  /** marker positions and fades, the CMB label anchor; returns the post pass's CMB parameters */
  frame(cam: Vec3, camera: THREE.PerspectiveCamera, skyFade: number): CmbFrame | undefined {
    for (const L of this.markers.values()) L.set.update(cam, skyFade);
    if (!this.cmb) return undefined;
    const camFromSun = Math.hypot(cam[0], cam[1], cam[2]);
    this.cmbAmount = this.cmb.amount(camFromSun);
    if (this.cmbEntry?.xyz) {
      // the label sits on the rim toward the screen's upper left: straight up is off screen when the
      // shell fills the view at the 30 Gpc zoom limit, and the long text runs to the right
      const m = camera.matrixWorld.elements;
      this.up.set(m[4] - m[0], m[5] - m[1], m[6] - m[2]).normalize();
      limbAnchor(cam, [this.up.x, this.up.y, this.up.z], CMB_RADIUS_PC, this.cmbEntry.xyz);
    }
    return { radiusPc: CMB_RADIUS_PC, camPos: cam, amount: this.cmbAmount, gain: this.cmb.gain };
  }

  pickAt(x: number, y: number, cam: Vec3, camera: THREE.PerspectiveCamera, w: number, h: number): CatalogEntry | null {
    let best: { entry: CatalogEntry; d: number } | null = null;
    for (const L of this.markers.values()) {
      const p = L.set.pickAt(x, y, cam, camera, w, h);
      if (p && (!best || p.d < best.d)) best = p;
    }
    return best?.entry ?? null;
  }

  /** flight target for an entry this feature owns specially (the CMB: the whole shell from outside) */
  viewFor(e: CatalogEntry): Partial<View> | null {
    if (e.kind !== 'cmb') return null;
    return { focus: [0, 0, 0], dist: 3e10, pitch: 0.35 };
  }

  debug() {
    return {
      cmb: this.cmb ? { radiusPc: CMB_RADIUS_PC, amount: this.cmbAmount, loaded: !!this.cmb.tex, anchor: this.cmbEntry?.xyz ?? null } : null,
      background: this.bg?.active ?? null,
      layers: Object.fromEntries([...this.markers].map(([id, L]) => [id, { status: L.status, ...L.set.count() }])),
    };
  }
}
