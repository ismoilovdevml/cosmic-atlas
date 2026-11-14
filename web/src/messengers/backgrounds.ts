/**
 * Sky background chooser: the sky layer's `backgrounds` (layers.json) are images in the Gaia sky
 * image's Hammer-Aitoff projection (scripts/build_sky_backgrounds.py). The first entry is the
 * Gaia image the sky layer already loads; picking another one sets the post pass's override
 * texture (src/render/post.ts setSkyOverride), picking Gaia clears it. Images load on first use.
 */

import * as THREE from 'three/webgpu';
import type { PostPass } from '../render/post';
import { t, tOr } from '../i18n';

export interface SkyBackground {
  id: string;
  title: string;
  /** image URL; absent for the default (the sky layer's own Gaia image) */
  image?: string;
  /** linear gain in the post pass (Gaia uses 0.5) */
  gain?: number;
  /** full credit / acknowledgement text (credits panel) */
  credit: string;
  /** one-line credit under the layer row */
  short?: string;
}

export class BackgroundChooser {
  active = 'gaia';
  private readonly cache = new Map<string, THREE.Texture>();
  private token = 0;
  onChange: () => void = () => {};

  constructor(readonly list: SkyBackground[], private readonly post: PostPass) {}

  get current(): SkyBackground | undefined {
    return this.list.find((b) => b.id === this.active) ?? this.list[0];
  }

  title(b: SkyBackground): string {
    return tOr(`sky.bg.${b.id}`, b.title);
  }

  /** switch the sky background; resolves once its image is shown (false if it failed) */
  async set(id: string): Promise<boolean> {
    const b = this.list.find((x) => x.id === id);
    if (!b) return false;
    const my = ++this.token;
    this.active = id;
    this.onChange();
    if (!b.image) {
      this.post.setSkyOverride(null);
      this.onChange();
      return true;
    }
    let tex = this.cache.get(id);
    if (!tex) {
      try {
        tex = await new THREE.TextureLoader().loadAsync(b.image);
      } catch {
        console.warn(`[sky] could not load ${b.image}`);
        if (my === this.token) await this.set(this.list[0].id);
        return false;
      }
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      this.cache.set(id, tex);
    }
    if (my !== this.token) return false;
    const img = tex.image as HTMLImageElement;
    this.post.setSkyOverride(tex, img.width, img.height, b.gain ?? 0.5);
    this.onChange();
    return true;
  }

  /** the <select> under the sky layer's row (re-created when the row is rebuilt) */
  decorate(li: HTMLElement) {
    let sel = li.querySelector<HTMLSelectElement>('select.sky-bg');
    if (!sel) {
      sel = document.createElement('select');
      sel.className = 'sky-bg';
      sel.addEventListener('change', () => void this.set(sel!.value));
      li.querySelector('.meta')?.after(sel);
    }
    sel.setAttribute('aria-label', t('sky.bg.label'));
    const want = this.list.map((b) => `${b.id}:${this.title(b)}`).join('|');
    if (sel.dataset.sig !== want) {
      sel.textContent = '';
      for (const b of this.list) {
        const o = document.createElement('option');
        o.value = b.id;
        o.textContent = this.title(b);
        sel.appendChild(o);
      }
      sel.dataset.sig = want;
    }
    sel.value = this.active;
  }
}
