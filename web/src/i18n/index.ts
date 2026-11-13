/**
 * UI strings in Uzbek (Latin, default), English and Russian (docs/content-contract.md §1).
 *
 *   t('layers.title')                       flat key lookup: current language > en > the key itself
 *   t('search.lookup', { q: 'M31' })        {name} placeholders
 *   t('unit.ly', { n: 4.2 })                ICU-style plurals: "{n, plural, one {# light-year} other {# light-years}}"
 *                                           (# = n formatted for the language, categories from Intl.PluralRules)
 *
 * Language resolution: ?lang= > saved choice (localStorage) > browser language > uz.
 * Importable in node (tests): every DOM / storage access is guarded.
 */

import en from './en.json';
import ru from './ru.json';
import uz from './uz.json';

export type Lang = 'uz' | 'en' | 'ru';
export const LANGS: Lang[] = ['uz', 'en', 'ru'];
export const DICTS: Record<Lang, Record<string, string>> = { uz, en, ru };
/** BCP 47 locale for plural rules */
export const LOCALES: Record<Lang, string> = { uz: 'uz-Latn-UZ', en: 'en-GB', ru: 'ru-RU' };
/**
 * Locale for number formatting. CLDR uz writes 1 234,5 (no-break space, decimal comma), but Chrome's
 * ICU formats 'uz' / 'uz-Latn-UZ' as 1,234.5 (measured 2026-11-13, headless Chrome), so Uzbek
 * numbers use a locale with the same separators as CLDR uz.
 */
export const NUMBER_LOCALES: Record<Lang, string> = { uz: 'ru-RU', en: 'en-GB', ru: 'ru-RU' };
const STORAGE_KEY = 'cosmic-atlas.lang';

let current: Lang = 'uz';
const listeners = new Set<(l: Lang) => void>();

export function isLang(x: unknown): x is Lang {
  return typeof x === 'string' && (LANGS as string[]).includes(x);
}

/** contract §1 order; every input optional so it is testable */
export function resolveLang(opts: { search?: string; saved?: string | null; browser?: readonly string[] }): Lang {
  const q = new URLSearchParams(opts.search ?? '').get('lang')?.toLowerCase();
  if (isLang(q)) return q;
  if (isLang(opts.saved)) return opts.saved;
  for (const b of opts.browser ?? []) {
    const p = b.toLowerCase();
    if (p.startsWith('ru')) return 'ru';
    if (p.startsWith('uz')) return 'uz';
    if (p) return 'en';
  }
  return 'uz';
}

function savedLang(): string | null {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

/** pick the start language from the page URL, storage and navigator (browser only) */
export function initLang(): Lang {
  const nav = globalThis.navigator;
  current = resolveLang({
    search: globalThis.location?.search,
    saved: savedLang(),
    browser: nav ? (nav.languages?.length ? nav.languages : [nav.language]) : [],
  });
  if (globalThis.document) document.documentElement.lang = current;
  return current;
}

export function getLang(): Lang {
  return current;
}

export function setLang(l: Lang, opts: { persist?: boolean } = {}) {
  if (!isLang(l)) return;
  if (opts.persist !== false) {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, l);
    } catch {
      /* private mode: the choice lasts for this page only */
    }
  }
  if (l === current) return;
  current = l;
  if (globalThis.document) document.documentElement.lang = l;
  for (const f of listeners) f(l);
}

export function onLangChange(f: (l: Lang) => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

export function hasKey(key: string, lang: Lang = current): boolean {
  return key in DICTS[lang];
}

export function t(key: string, vars?: Record<string, string | number>, lang: Lang = current): string {
  const raw = DICTS[lang][key] ?? DICTS.en[key] ?? key;
  return format(raw, vars, lang);
}

/** t() with a fallback text when the key does not exist (layer titles from layers.json, …) */
export function tOr(key: string, fallback: string, vars?: Record<string, string | number>): string {
  return key in DICTS[current] || key in DICTS.en ? t(key, vars) : fallback;
}

// ------------------------------------------------------------------ numbers

const nfCache = new Map<string, Intl.NumberFormat>();
function nf(lang: Lang, digits: number, min = 0): Intl.NumberFormat {
  const k = `${lang}|${digits}|${min}`;
  let f = nfCache.get(k);
  if (!f) {
    f = new Intl.NumberFormat(NUMBER_LOCALES[lang], { maximumFractionDigits: digits, minimumFractionDigits: min });
    nfCache.set(k, f);
  }
  return f;
}

/** a number with fixed decimals in the current language (1 234,5 in uz/ru, 1,234.5 in en) */
export function fmtFixed(x: number, digits: number, lang: Lang = current): string {
  if (!Number.isFinite(x)) return '—';
  return nf(lang, digits, digits).format(x);
}

/** at most `digits` decimals */
export function fmtMax(x: number, digits: number, lang: Lang = current): string {
  if (!Number.isFinite(x)) return '—';
  return nf(lang, digits).format(x);
}

/** the decimal separator of a language ('.' or ',') */
export function decimalSep(lang: Lang = current): string {
  return nf(lang, 1, 1).formatToParts(1.5).find((p) => p.type === 'decimal')?.value ?? '.';
}

// ------------------------------------------------------------------ message format

const prCache = new Map<Lang, Intl.PluralRules>();
function pluralCat(lang: Lang, n: number): string {
  let pr = prCache.get(lang);
  if (!pr) {
    pr = new Intl.PluralRules(LOCALES[lang]);
    prCache.set(lang, pr);
  }
  return pr.select(n);
}

/** default rendering of a numeric var inside a message (3 significant digits, localised) */
function numText(v: string | number, lang: Lang): string {
  if (typeof v !== 'number') return v;
  return Number.isInteger(v) ? nf(lang, 0).format(v) : nf(lang, Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2).format(v);
}

/**
 * {name} placeholders and {n, plural, one {…} few {…} many {…} other {…}} blocks (# = the number).
 * A plural var may be passed preformatted as `${name}Text`, e.g. { n: 4.2, nText: '4,2' }.
 */
export function format(msg: string, vars: Record<string, string | number> | undefined, lang: Lang): string {
  if (!vars || !msg.includes('{')) return msg;
  let out = '';
  let i = 0;
  while (i < msg.length) {
    const open = msg.indexOf('{', i);
    if (open < 0) {
      out += msg.slice(i);
      break;
    }
    out += msg.slice(i, open);
    const close = matchBrace(msg, open);
    if (close < 0) {
      out += msg.slice(open);
      break;
    }
    const body = msg.slice(open + 1, close);
    const m = body.match(/^\s*(\w+)\s*,\s*plural\s*,([\s\S]*)$/);
    if (m) out += plural(m[1], m[2], vars, lang);
    else {
      const name = body.trim();
      out += name in vars ? numText(vars[name], lang) : `{${body}}`;
    }
    i = close + 1;
  }
  return out;
}

function matchBrace(s: string, open: number): number {
  let depth = 0;
  for (let j = open; j < s.length; j++) {
    if (s[j] === '{') depth++;
    else if (s[j] === '}' && --depth === 0) return j;
  }
  return -1;
}

function plural(name: string, spec: string, vars: Record<string, string | number>, lang: Lang): string {
  const n = Number(vars[name]);
  const forms: Record<string, string> = {};
  let j = 0;
  while (j < spec.length) {
    const km = spec.slice(j).match(/^\s*(=\d+|zero|one|two|few|many|other)\s*\{/);
    if (!km) break;
    const open = j + km[0].length - 1;
    const close = matchBrace(spec, open);
    if (close < 0) break;
    forms[km[1]] = spec.slice(open + 1, close);
    j = close + 1;
  }
  const form = forms[`=${n}`] ?? forms[pluralCat(lang, n)] ?? forms.other ?? '';
  const shown = String(vars[`${name}Text`] ?? numText(n, lang));
  return format(form.replace(/#/g, shown), vars, lang);
}
