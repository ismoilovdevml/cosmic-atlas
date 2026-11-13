/**
 * Static page strings (index.html) and the UZ · EN · RU switcher.
 *
 *   <h2 data-i18n="layers.title">                       textContent
 *   <input data-i18n-attr="placeholder:search.placeholder;aria-label:search.label">
 */

import { LANGS, getLang, onLangChange, setLang, t, type Lang } from './index';

export function applyI18n(root: ParentNode = document) {
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) el.textContent = t(el.dataset.i18n!);
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-attr]')) {
    for (const pair of el.dataset.i18nAttr!.split(';')) {
      const [attr, key] = pair.split(':').map((s) => s.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    }
  }
  const meta = document.querySelector('meta[name="description"]');
  if (meta) meta.setAttribute('content', t('app.description'));
  document.title = t('app.title');
}

/** own-language names, so a reader who cannot read the current UI still finds theirs */
const NATIVE: Record<Lang, string> = { uz: 'Oʻzbekcha', en: 'English', ru: 'Русский' };

export function mountLangSwitch(group: HTMLElement) {
  group.textContent = '';
  for (const l of LANGS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'lang-opt';
    b.lang = l;
    b.dataset.lang = l;
    b.textContent = l.toUpperCase();
    b.setAttribute('aria-label', NATIVE[l]);
    b.title = NATIVE[l];
    b.addEventListener('click', () => {
      setLang(l);
      // ?lang= wins over the saved choice on reload, so keep the URL in step with the switch
      const u = new URL(location.href);
      if (u.searchParams.has('lang')) {
        u.searchParams.set('lang', l);
        history.replaceState(history.state, '', u.toString());
      }
    });
    group.appendChild(b);
  }
  const sync = () => {
    for (const b of group.querySelectorAll<HTMLButtonElement>('.lang-opt')) b.setAttribute('aria-pressed', String(b.dataset.lang === getLang()));
    group.setAttribute('aria-label', t('lang.label'));
  };
  sync();
  onLangChange(sync);
}
