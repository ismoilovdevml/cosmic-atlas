/**
 * 3D dust layer (Edenhofer et al. 2024): data loading, per-frame state, layers-panel controls and
 * the info card for a click on a cloud. Rendering is in shader.ts, the grid maths in grid.ts.
 *
 * main.ts hook: configure() from layers.json (`type: "dust"`), load() once, update() per frame
 * (returns whether the dust pipeline should draw), pick() when a click hits no object.
 */

import type { ModelLayerConfig } from '../data/manifest';
import { fetchJson } from '../data/tilebase';
import { fmtFixed, t } from '../i18n';
import { galToLB, type Vec3 } from '../math/frames';
import { formatDistance } from '../math/units';
import type { PostPass } from '../render/post';
import { DustGrid, dataBounds, type DustMeta, type DustPick } from './grid';
import { DUST_QUALITY, DustShader, type DustQuality } from './shader';

export type DustMode = 'auto' | 'absorb' | 'glow';

/** camera distance (pc) window of the layer: fades in over [IN0, IN1], out over [OUT0, OUT1] */
export const DUST_FADE = { in0: 10, in1: 20, out0: 5000, out1: 8000 };

const smooth = (a: number, b: number, x: number) => {
  const u = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return u * u * (3 - 2 * u);
};

/** layer strength from the camera's distance to the focus */
export function dustFade(D: number): number {
  return smooth(DUST_FADE.in0, DUST_FADE.in1, D) * (1 - smooth(DUST_FADE.out0, DUST_FADE.out1, D));
}

/**
 * Glow weight for mode 'auto': 0 while the camera is inside the map (sphere ∩ slab), rising to 1 as
 * it leaves it (the larger of r/R and |z|/Z from 1.0 to 1.25).
 */
export function glowWeight(meta: DustMeta, cam: Vec3, mode: DustMode): number {
  if (mode === 'glow') return 1;
  if (mode === 'absorb') return 0;
  const { R, Z } = dataBounds(meta);
  const out = Math.max(Math.hypot(cam[0], cam[1], cam[2]) / R, Math.abs(cam[2]) / Z);
  return smooth(1.0, 1.25, out);
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

export class DustFeature {
  cfg: (ModelLayerConfig & { path?: string }) | null = null;
  grid: DustGrid | null = null;
  shader: DustShader | null = null;
  status: 'none' | 'loading' | 'ready' | 'missing' | 'error' = 'none';
  error = '';
  visible = true;
  opacity = 1;
  mode: DustMode = 'auto';
  /** Low by default: 1.8-2.8 ms inside the map at 1440x900 on an M4 Pro, visually the same as Medium (README) */
  quality: DustQuality = 'low';
  /** drawn this frame */
  active = false;
  amount = 0;
  onChange: () => void = () => {};

  configure(cfg: ModelLayerConfig & { path?: string }, visible: boolean) {
    this.cfg = cfg;
    this.visible = visible;
    const q = new URLSearchParams(location.search);
    const dq = q.get('dustq');
    if (dq === 'low' || dq === 'medium' || dq === 'high') this.quality = dq;
    const dm = q.get('dustmode');
    if (dm === 'auto' || dm === 'absorb' || dm === 'glow') this.mode = dm;
  }

  /** fetch meta.json and both textures; `known` = built layers (tiles/_index.json), if listed */
  async load(post: PostPass, known?: Set<string>) {
    if (!this.cfg) return;
    const path = (this.cfg.path ?? 'tiles/dust').replace(/\/$/, '');
    if (known && !known.has(path.split('/').pop()!)) {
      this.status = 'missing';
      return;
    }
    this.status = 'loading';
    try {
      const r = await fetchJson<DustMeta>(`${path}/meta.json`);
      if (r.status !== 'ok') {
        this.status = 'missing';
        return;
      }
      const meta = r.data;
      const [fine, aux] = await Promise.all([fetchBytes(`${path}/${meta.fine.file}`), fetchBytes(`${path}/${meta.aux.file}`)]);
      this.grid = new DustGrid(meta, fine, aux);
      this.shader = new DustShader(this.grid);
      this.shader.setQuality(this.quality);
      post.enableDust((ctx) => this.shader!.build(ctx));
      this.status = 'ready';
    } catch (e) {
      this.status = 'error';
      this.error = (e as Error).message;
      console.error(`[dust] ${this.error}`);
    }
    this.onChange();
  }

  setQuality(q: DustQuality) {
    this.quality = q;
    this.shader?.setQuality(q);
    this.onChange();
  }

  setMode(m: DustMode) {
    this.mode = m;
    this.onChange();
  }

  /** per frame: uniforms; returns true when the dust pipeline should draw */
  update(cam: Vec3, D: number): boolean {
    const s = this.shader;
    this.amount = s && this.visible ? this.opacity * dustFade(D) : 0;
    this.active = !!s && this.amount > 1e-3;
    if (!s || !this.active) return false;
    s.uCam.value.set(cam[0], cam[1], cam[2]);
    s.uAmount.value = this.amount;
    s.uGlow.value = glowWeight(s.grid.meta, cam, this.mode);
    return true;
  }

  /** the cloud under a click (camera position and unit ray direction, contract axes) */
  pick(cam: Vec3, dir: Vec3): DustPick | null {
    if (!this.grid || !this.active) return null;
    return this.grid.pick(cam, dir);
  }

  /** info-card content for a picked cloud */
  card(p: DustPick) {
    const m = this.grid!.meta;
    const f2 = (x: number) => fmtFixed(x, x >= 10 ? 1 : 2);
    const d = Math.hypot(...p.xyz);
    const lb = galToLB(p.xyz);
    const rows: [string, string][] = [
      [t('dust.row.density'), Number.isFinite(p.densityStd)
        ? t('dust.val.density', { v: f2(p.density), e: f2(p.densityStd) }) : t('dust.val.densityNoErr', { v: f2(p.density) })],
      [t('dust.row.coarse'), t('dust.val.density', { v: f2(p.coarseMean), e: f2(p.coarseStd) })],
      [t('row.distance'), formatDistance(d, 3)],
      [t('dust.row.fromCamera'), formatDistance(p.distCam, 3)],
      [t('dust.row.avSun'), t('dust.val.mag', { v: f2(p.avFromSun) })],
      [t('dust.row.avRay'), t('dust.val.avRay', { a: f2(p.avFromCamera), b: f2(p.avRayTotal) })],
      [t('row.galactic'), `${fmtFixed(lb.l, 2)}°, ${fmtFixed(lb.b, 2)}°`],
    ];
    if (p.landmark) rows.unshift([t('dust.row.near'), t('dust.val.near', { name: p.landmark.name, d: fmtFixed(p.landmark.sepPc, 0) })]);
    return {
      kind: t('dust.kind'),
      title: p.landmark ? t('dust.titleNear', { name: p.landmark.name.split(' (')[0] }) : t('dust.title'),
      rows,
      note: t('dust.note', { cite: m.citation, e: fmtFixed(m.eToAv, 1) }),
      links: [[t('dust.link.paper'), `https://doi.org/${m.doi}`], [t('dust.link.data'), 'https://doi.org/10.5281/zenodo.8187943']] as [string, string][],
      fly: { focus: p.xyz, dist: 80 },
    };
  }

  /** mode + quality selects under the layer row */
  controls(li: HTMLElement) {
    const wrap = document.createElement('div');
    wrap.className = 'dust-controls fine';
    const mk = (label: string, opts: [string, string][], value: string, on: (v: string) => void) => {
      const l = document.createElement('label');
      const s = document.createElement('select');
      for (const [v, txt] of opts) {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = txt;
        s.append(o);
      }
      s.value = value;
      s.addEventListener('change', () => on(s.value));
      l.append(document.createTextNode(`${label} `), s);
      wrap.append(l, document.createTextNode(' '));
    };
    mk(t('dust.mode'), [['auto', t('dust.mode.auto')], ['absorb', t('dust.mode.absorb')], ['glow', t('dust.mode.glow')]], this.mode,
      (v) => this.setMode(v as DustMode));
    mk(t('dust.quality'), (Object.keys(DUST_QUALITY) as DustQuality[]).map((q) => [q, t(`dust.quality.${q}`)]), this.quality,
      (v) => this.setQuality(v as DustQuality));
    li.append(wrap);
  }
}
