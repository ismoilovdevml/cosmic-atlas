/**
 * In-app docs reader (#doc=<slug>): a side sheet on wide screens, full screen on phones.
 * Renders one article at a time with its own back stack; `doc:` links open other articles and
 * `#focus=` links ask the app to fly to an object.
 */

import { getLang, onLangChange, t } from '../i18n';
import { classifyLink, escapeHtml, renderMarkdown } from './markdown';
import { DOC_SLUG, docAssetUrl, loadArticle, type Article } from './store';

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const PHONE = '(max-width: 640px)';

export class DocsPanel {
  /** a `#focus=` link was followed; return false when the object was not found */
  onFocus: (name: string) => boolean | Promise<boolean> = () => false;
  /** a `#layer=` link was followed */
  onLayer: (id: string) => boolean | Promise<boolean> = () => false;
  /** the open article changed (null = closed), for the URL hash */
  onChange: (slug: string | null) => void = () => {};

  private root = $('docs');
  private scroll = $('docs-scroll');
  private stack: string[] = [];
  private token = 0;
  private opener: HTMLElement | null = null;
  current: string | null = null;

  constructor() {
    $('docs-close').addEventListener('click', () => this.close());
    $('docs-back').addEventListener('click', () => this.back());
    $('docs-home').addEventListener('click', () => void this.open('index'));
    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.close();
      }
    });
    this.root.addEventListener('click', (e) => this.onClick(e));
    onLangChange(() => {
      if (this.current) void this.render(this.current);
    });
  }

  get isOpen() {
    return !this.root.hidden;
  }

  /** open an article; `push` false replaces the top of the back stack (deep links, language change) */
  async open(slug: string, opts: { push?: boolean } = {}) {
    const s = DOC_SLUG.test(slug) ? slug : 'index';
    if (!this.isOpen) {
      this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      this.stack = [];
    }
    if (this.stack.at(-1) !== s) {
      if (opts.push === false && this.stack.length) this.stack[this.stack.length - 1] = s;
      else this.stack.push(s);
    }
    this.root.hidden = false;
    document.body.classList.add('has-docs');
    await this.render(s);
  }

  back() {
    if (this.stack.length > 1) {
      this.stack.pop();
      void this.render(this.stack.at(-1)!);
    } else this.close();
  }

  close() {
    if (!this.isOpen) return;
    this.root.hidden = true;
    document.body.classList.remove('has-docs');
    this.current = null;
    this.stack = [];
    this.onChange(null);
    this.opener?.focus?.();
  }

  private async render(slug: string) {
    const my = ++this.token;
    this.current = slug;
    this.onChange(slug);
    this.root.setAttribute('aria-busy', 'true');
    const lang = getLang();
    const a = await loadArticle(slug, lang);
    if (my !== this.token) return;
    this.root.removeAttribute('aria-busy');
    const backBtn = $('docs-back');
    const many = this.stack.length > 1;
    backBtn.setAttribute('aria-label', many ? t('docs.back') : t('docs.close'));
    backBtn.title = backBtn.getAttribute('aria-label')!;
    backBtn.hidden = !many;
    $('docs-home').hidden = slug === 'index';
    if (!a) return this.renderMissing(slug);
    this.renderArticle(a);
  }

  private renderMissing(slug: string) {
    this.setNotice(null);
    $('docs-title').textContent = t('docs.missing.title');
    $('docs-lede').textContent = t('docs.missing.text', { slug });
    $('docs-body').innerHTML = slug === 'index' ? '' : `<p><a href="#doc=index" data-doc="index">${escapeHtml(t('docs.index'))}</a></p>`;
    $('docs-related-wrap').hidden = true;
    $('docs-sources-wrap').hidden = true;
    $('docs-updated').textContent = '';
    this.afterRender();
  }

  private renderArticle(a: Article) {
    const notes: string[] = [];
    if (a.lang !== a.requested) notes.push(t('docs.fallback'));
    if (a.meta.placeholder) notes.push(t('docs.placeholder'));
    this.setNotice(notes.length ? notes.join(' ') : null);
    const title = $('docs-title');
    title.textContent = a.meta.title || a.slug;
    title.lang = a.lang;
    $('docs-lede').textContent = a.meta.summary;
    $('docs-lede').lang = a.lang;
    const body = $('docs-body');
    body.lang = a.lang;
    // renderMarkdown escapes all source text and emits only whitelisted tags (see markdown.ts)
    body.innerHTML = renderMarkdown(a.body, { resolveImage: (src) => docAssetUrl(a.lang, src) });

    const rel = a.meta.related.filter((s) => DOC_SLUG.test(s));
    $('docs-related-wrap').hidden = rel.length === 0;
    const chips = $('docs-related');
    chips.textContent = '';
    for (const s of rel) {
      const c = document.createElement('a');
      c.className = 'chip';
      c.href = `#doc=${s}`;
      c.dataset.doc = s;
      c.textContent = s;
      chips.appendChild(c);
      // titles arrive from the (cached) article files
      void loadArticle(s, getLang()).then((r) => {
        if (r?.meta.title) c.textContent = r.meta.title;
        else c.classList.add('missing');
      });
    }

    $('docs-sources-wrap').hidden = a.meta.sources.length === 0;
    const src = $('docs-sources');
    src.textContent = '';
    for (const s of a.meta.sources) {
      const li = document.createElement('li');
      li.innerHTML = linkifySource(s);
      src.appendChild(li);
    }
    $('docs-updated').textContent = a.meta.updated ? t('docs.updated', { date: a.meta.updated }) : '';
    this.afterRender();
  }

  private setNotice(text: string | null) {
    const n = $('docs-notice');
    n.hidden = !text;
    n.textContent = text ?? '';
  }

  private afterRender() {
    this.scroll.scrollTop = 0;
    $('docs-title').focus({ preventScroll: true });
  }

  private onClick(e: MouseEvent) {
    const a = (e.target as HTMLElement).closest('a');
    if (!a || !this.root.contains(a)) return;
    if (a.dataset.doc) {
      e.preventDefault();
      void this.open(a.dataset.doc);
    } else if (a.dataset.focus !== undefined || a.dataset.layer !== undefined) {
      e.preventDefault();
      const run = a.dataset.layer !== undefined ? this.onLayer(a.dataset.layer) : this.onFocus(a.dataset.focus!);
      void Promise.resolve(run).then((ok) => {
        // phones: the sheet covers the map, so step aside to show the flight
        if (ok && window.matchMedia(PHONE).matches) this.close();
      });
    }
  }
}


/** a source line: URLs and doi:… become links, everything else escaped text */
export function linkifySource(s: string): string {
  const doi = (x: string) => `https://doi.org/${x}`;
  // escaped text, with bare URLs and DOIs wrapped in links
  const parts = s.split(/(https?:\/\/[^\s)]+|doi:\s?10\.\d{4,9}\/[^\s)]+)/g);
  return parts
    .map((p, i) => {
      if (i % 2 === 0) return escapeHtml(p);
      const href = p.startsWith('doi:') ? doi(p.replace(/^doi:\s?/, '')) : p;
      const target = classifyLink(href);
      if (target.type !== 'external') return escapeHtml(p);
      return `<a href="${escapeHtml(target.href)}" target="_blank" rel="noopener noreferrer" class="ext">${escapeHtml(p)}</a>`;
    })
    .join('');
}

