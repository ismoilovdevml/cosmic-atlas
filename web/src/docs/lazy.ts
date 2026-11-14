/**
 * The docs reader without its code: same surface as DocsPanel (open, close, isOpen, current, hooks),
 * but the reader and its markdown renderer (panel.ts, markdown.ts) are fetched on the first open().
 * Nothing about them is needed for the first frame.
 */

import type { Lang } from '../i18n';
import type { DocsPanel } from './panel';
import type { Article } from './store';

export class LazyDocsPanel {
  onFocus: (name: string) => boolean | Promise<boolean> = () => false;
  onLayer: (id: string) => boolean | Promise<boolean> = () => false;
  onChange: (slug: string | null) => void = () => {};
  private panel: DocsPanel | null = null;
  private loading: Promise<DocsPanel> | null = null;

  get isOpen(): boolean {
    return !(document.getElementById('docs')?.hidden ?? true);
  }

  get current(): string | null {
    return this.panel?.current ?? null;
  }

  private load(): Promise<DocsPanel> {
    this.loading ??= import('./panel').then((m) => {
      const p = new m.DocsPanel();
      p.onFocus = (n) => this.onFocus(n);
      p.onLayer = (id) => this.onLayer(id);
      p.onChange = (s) => this.onChange(s);
      this.panel = p;
      return p;
    });
    return this.loading;
  }

  async open(slug: string, opts: { push?: boolean } = {}): Promise<void> {
    const p = await this.load();
    await p.open(slug, opts);
  }

  close() {
    this.panel?.close();
  }
}

/** article front matter + body for the info card summary (store.ts is fetched with the first card) */
export async function loadArticleLazy(slug: string, lang: Lang): Promise<Article | null> {
  const m = await import('./store');
  return m.loadArticle(slug, lang);
}
