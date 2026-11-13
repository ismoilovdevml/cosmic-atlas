/**
 * Docs articles: web/public/docs/<lang>/<slug>.md, fetched on demand and cached per language and slug.
 * A missing article falls back to English (the caller shows a notice). Responses that are not an
 * article (the dev server's SPA fallback answers unknown paths with index.html) count as missing.
 */

import type { Lang } from '../i18n';
import { parseFrontMatter, type DocMeta } from './frontmatter';

export interface Article {
  slug: string;
  /** language the text is in */
  lang: Lang;
  /** language that was asked for; differs when the article fell back to English */
  requested: Lang;
  meta: DocMeta;
  body: string;
}

export const DOC_SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const BASE = 'docs/';
const cache = new Map<string, Promise<{ meta: DocMeta; body: string } | null>>();

function fetchOne(lang: Lang, slug: string): Promise<{ meta: DocMeta; body: string } | null> {
  const key = `${lang}/${slug}`;
  let p = cache.get(key);
  if (!p) {
    p = fetch(`${BASE}${lang}/${slug}.md`)
      .then(async (r) => {
        if (!r.ok) return null;
        if ((r.headers.get('content-type') ?? '').includes('text/html')) return null;
        return parseFrontMatter(await r.text());
      })
      .catch(() => {
        cache.delete(key); // network error: let a later attempt retry
        return null;
      });
    cache.set(key, p);
  }
  return p;
}

export async function loadArticle(slug: string, lang: Lang): Promise<Article | null> {
  if (!DOC_SLUG.test(slug)) return null;
  const own = await fetchOne(lang, slug);
  if (own) return { slug, lang, requested: lang, ...own };
  if (lang === 'en') return null;
  const en = await fetchOne('en', slug);
  return en ? { slug, lang: 'en', requested: lang, ...en } : null;
}

/** the image base for an article's relative image paths */
export function docAssetUrl(lang: Lang, path: string): string {
  return `${BASE}${lang}/${path}`;
}
