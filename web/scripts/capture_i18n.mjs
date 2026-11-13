// Capture the UI in uz / en / ru, the docs reader (desktop and a 390 px phone), an info card with
// "Learn more" and the multilingual search, with the same headless WebGPU Chrome as capture_views.mjs.
// Also checks each capture for horizontal overflow, clipped text and the text contrast of key UI.
// usage (dev server running): node scripts/capture_i18n.mjs [outdir=../figures] [baseUrl=http://localhost:5173/]
import { chromium } from 'playwright-core';

const [,, outdir = '../figures', base = 'http://localhost:5173/'] = process.argv;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--enable-features=WebGPU'] });
const problems = [];
const VIEW_MW = '#v=8275,0,0,52000,-120,70';

async function open(lang, hash, viewport = { width: 1440, height: 900 }, dsf = 1) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: dsf, locale: 'en-US' });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`[${lang}] console: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`[${lang}] pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`[${lang}] http ${r.status()} ${r.url()}`); });
  await page.goto(`${base}?lang=${lang}${hash}`);
  await page.waitForFunction(() => window.__atlas?.stats, null, { timeout: 20000 });
  await page.waitForTimeout(2500);
  return { ctx, page };
}

/** text that is cut off (scrollWidth > clientWidth on a nowrap/hidden element) or pushes the page sideways */
async function audit(page, name) {
  const r = await page.evaluate(() => {
    const out = { overflowX: document.documentElement.scrollWidth > window.innerWidth + 1, clipped: [], lowContrast: [] };
    const lum = (c) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const [r, g, b, a = 1] = m[1].split(',').map(Number);
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return { L: 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b), a };
    };
    const sel = '.layer-title, .meta, .kind, #info-title, .summary, .rows dt, .rows dd, .btn, .lang-opt, .tick-label, .landmark, .bar-label, #focus-where, .docs-article h1, .docs-lede, .docs-body p, .docs-body li, .docs-notice, .chip, .suggest li span, .status, .docs-home, .docs-bar-title';
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (!r.width || el.closest('[hidden]')) continue;
      const cs = getComputedStyle(el);
      if (el.scrollWidth > el.clientWidth + 1 && cs.overflow !== 'visible' && cs.textOverflow !== 'ellipsis') out.clipped.push(`${el.className || el.tagName}: ${el.textContent.trim().slice(0, 40)}`);
      if (r.right > window.innerWidth + 1 || r.left < -1) out.clipped.push(`off-screen ${el.className || el.tagName}: ${el.textContent.trim().slice(0, 40)}`);
      // contrast against the panel behind it (walk up to the first opaque-ish background; the void otherwise)
      const fg = lum(cs.color);
      let bgL = 0.0019; // --void #04060b
      for (let p = el; p; p = p.parentElement) {
        const b = lum(getComputedStyle(p).backgroundColor);
        if (b && b.a > 0.5) { bgL = b.L; break; }
      }
      if (fg) {
        const ratio = (Math.max(fg.L, bgL) + 0.05) / (Math.min(fg.L, bgL) + 0.05);
        if (ratio < 4.5) out.lowContrast.push(`${el.className || el.tagName} ${ratio.toFixed(2)}: ${el.textContent.trim().slice(0, 30)}`);
      }
    }
    return out;
  });
  const line = `${name}: overflowX=${r.overflowX} clipped=${r.clipped.length} lowContrast=${r.lowContrast.length}`;
  console.log(line);
  if (r.overflowX) problems.push(`${name}: horizontal page overflow`);
  for (const c of r.clipped) problems.push(`${name}: clipped ${c}`);
  for (const c of [...new Set(r.lowContrast)]) problems.push(`${name}: contrast ${c}`);
}

async function shot(page, name) {
  await page.screenshot({ path: `${outdir}/i18n-${name}.png` });
  await audit(page, name);
}

// 1. the whole UI in each language: Milky Way scale, layers open, an info card with "Learn more"
for (const lang of ['uz', 'en', 'ru']) {
  const { ctx, page } = await open(lang, `${VIEW_MW}&sel=cat:Sirius`);
  await page.waitForSelector('#info:not([hidden])', { timeout: 15000 });
  await page.waitForSelector('#info-summary:not([hidden])', { timeout: 10000 });
  await shot(page, `ui-${lang}`);
  await ctx.close();
}

// 2. multilingual search: a kind word lists objects + the article; a Cyrillic Uzbek name finds the view
for (const [lang, q, name] of [['uz', 'qora tuynuk', 'search-uz-kind'], ['ru', 'Земля', 'search-ru-earth'], ['uz', 'Сомон йўли', 'search-uz-cyrillic']]) {
  const { ctx, page } = await open(lang, VIEW_MW);
  await page.fill('#search', q);
  await page.waitForSelector('#suggest:not([hidden])');
  await page.waitForTimeout(300);
  await shot(page, name);
  await ctx.close();
}

// 2b. "Yer" picks the live Earth (Solar System layer) and its card carries the Earth article
{
  const { ctx, page } = await open('uz', VIEW_MW);
  await page.fill('#search', 'Yer');
  await page.waitForSelector('#suggest:not([hidden])');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#info-summary:not([hidden])', { timeout: 15000 });
  await page.waitForTimeout(6000);
  await shot(page, 'search-uz-earth-card');
  console.log('Yer →', await page.evaluate(() => [document.getElementById('info-title').textContent, document.getElementById('info-kind').textContent, document.getElementById('info-summary').textContent.slice(0, 60)]));
  await ctx.close();
}

// 3. info card with "Learn more", then the article it opens (desktop)
{
  const { ctx, page } = await open('en', VIEW_MW);
  await page.fill('#search', 'Andromeda Galaxy');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#info-more:not([hidden])', { timeout: 10000 });
  await page.waitForSelector('#info-summary:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(2500);
  await shot(page, 'infocard-learn-more-en');
  await page.click('#info-more');
  await page.waitForSelector('#docs:not([hidden]):not([aria-busy])');
  await page.waitForTimeout(500);
  await shot(page, 'docs-from-card-en');
  // the hash is written 400 ms after the last change and never mid-flight
  await page.waitForFunction(() => /doc=local-group/.test(location.hash) && /sel=cat:/.test(location.hash), null, { timeout: 20000 });
  console.log('hash after Learn more:', await page.evaluate(() => location.hash));
  await ctx.close();
}

// 4. docs reader on desktop (contents in uz) and on a 390 px phone (an article, ru; contents, uz)
{
  const { ctx, page } = await open('uz', `${VIEW_MW}&doc=index`);
  await page.waitForSelector('#docs:not([hidden]):not([aria-busy])');
  await page.waitForTimeout(500);
  await shot(page, 'docs-desktop-uz');
  // follow a doc: link inside the article, then Back
  await page.click('#docs-body a[data-doc="parallax"]');
  await page.waitForFunction(() => document.getElementById('docs-title').textContent === 'Parallaks');
  await page.waitForFunction(() => /doc=parallax/.test(location.hash), null, { timeout: 5000 });
  console.log('after doc: link →', await page.evaluate(() => [document.getElementById('docs-title').textContent, location.hash.match(/doc=[^&]*/)?.[0]]));
  await page.click('#docs-back');
  await page.waitForFunction(() => document.getElementById('docs-title').textContent === 'Atlas qoʻllanmasi');
  console.log('after Back →', await page.evaluate(() => document.getElementById('docs-title').textContent));
  // a #focus= link flies the map (index has none yet: inject one through the hash, as a docs link would)
  await page.evaluate(() => { location.hash = '#focus=sgr-a-star&doc=index'; });
  await page.waitForTimeout(1500);
  console.log('focus=sgr-a-star →', await page.evaluate(() => [document.getElementById('info-title').textContent, document.getElementById('search-status').textContent]));
  await page.evaluate(() => { location.hash = '#focus=Andromeda%20Galaxy'; });
  await page.waitForTimeout(1500);
  console.log('focus=Andromeda Galaxy →', await page.evaluate(() => [document.getElementById('info-title').textContent, !document.getElementById('docs').hidden]));
  // a real article (written by the docs agents) on desktop, and a click on one of its #focus= links
  await page.evaluate(() => { location.hash = '#doc=sgr-a-star'; });
  await page.waitForFunction(() => !document.getElementById('docs').hidden && !document.getElementById('docs').hasAttribute('aria-busy') && document.querySelector('#docs-body a[data-focus]'));
  await page.waitForTimeout(400);
  await shot(page, 'docs-article-desktop-uz');
  await page.click('#docs-body a[data-focus]');
  await page.waitForTimeout(1200);
  console.log('click #focus= in article →', await page.evaluate(() => [document.querySelector('#docs-body a[data-focus]').dataset.focus, document.getElementById('info-title').textContent]));
  // #layer= as a page URL: the layer is switched on and the view flies to it
  await page.evaluate(() => { window.__atlas.setLayer('local-volume', false); location.hash = '#layer=local-volume'; });
  await page.waitForTimeout(1500);
  console.log('layer=local-volume →', await page.evaluate(() => [window.__atlas.stats().layers.find((l) => l.id === 'local-volume')?.active, document.getElementById('info-title').textContent, Math.round(window.__atlas.stats().view.dist)]));
  // Escape closes the docs sheet
  await page.evaluate(() => { location.hash = '#doc=units'; });
  await page.waitForSelector('#docs:not([hidden]):not([aria-busy])');
  await page.focus('#docs-close');
  await page.keyboard.press('Escape');
  console.log('Escape closes docs →', await page.evaluate(() => document.getElementById('docs').hidden));
  await ctx.close();
}
for (const [lang, slug] of [['ru', 'mars'], ['uz', 'index'], ['ru', 'black-hole']]) {
  const { ctx, page } = await open(lang, `${VIEW_MW}&doc=${slug}`, { width: 390, height: 844 }, 2);
  await page.waitForSelector('#docs:not([hidden]):not([aria-busy])');
  await page.waitForTimeout(500);
  await shot(page, `docs-phone-${lang}-${slug}`);
  await ctx.close();
}
// phone: the map UI with an info card and Learn more
{
  const { ctx, page } = await open('uz', `${VIEW_MW}&sel=cat:Sirius`, { width: 390, height: 844 }, 2);
  await page.waitForSelector('#info-summary:not([hidden])', { timeout: 15000 });
  await shot(page, 'phone-uz-infocard');
  await ctx.close();
}

// 5. language switch at runtime keeps state and re-renders strings; it is remembered
{
  const { ctx, page } = await open('en', `${VIEW_MW}&sel=cat:Sirius`);
  await page.waitForSelector('#info-summary:not([hidden])', { timeout: 15000 });
  await page.evaluate(() => history.replaceState(null, '', location.pathname + location.hash)); // drop ?lang= so the saved choice applies
  await page.click('.lang-opt[data-lang="ru"]');
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => ({ html: document.documentElement.lang, layers: document.getElementById('layers-title').textContent, kind: document.getElementById('info-kind').textContent, more: document.querySelector('#info-more span').textContent, saved: localStorage.getItem('cosmic-atlas.lang') }));
  console.log('runtime switch →', JSON.stringify(after));
  await page.reload();
  await page.waitForFunction(() => window.__atlas?.stats, null, { timeout: 20000 });
  console.log('after reload lang =', await page.evaluate(() => document.documentElement.lang));
  await ctx.close();
}

console.log('problems:', problems.length ? problems : 'none');
await browser.close();
