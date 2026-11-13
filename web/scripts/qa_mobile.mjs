// Phone-layout QA with touch emulation (Chromium): horizontal overflow, tap-target sizes, text
// contrast, focus ring, and the layers panel / search / info card / tour / scale rail / pinch zoom /
// one-finger orbit flows. Prints one JSON object per check; screenshots to <outdir>/<prefix>-*.png.
// usage (dev server running): node scripts/qa_mobile.mjs <outdir> [prefix=qa-phone] [baseUrl]
import { chromium } from 'playwright-core';

const [,, outdir = '../figures', prefix = 'qa-phone', base = 'http://localhost:5173/'] = process.argv;
const SIZES = [[390, 844], [360, 740]];
const MIN_TAP = 44;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
const out = (k, v) => console.log(JSON.stringify({ check: k, ...v }));
let failures = 0;
const verdict = (ok) => { if (!ok) failures++; return ok ? 'pass' : 'FAIL'; };

for (const [W, H] of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => logs.push(e.message));
  await page.goto(`${base}#v=0,0,0,300,-150,22`);
  await page.waitForFunction(() => window.__atlas, null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  const tag = `${W}x${H}`;
  const cdp = await ctx.newCDPSession(page);
  // fresh touch ids per gesture, like a real screen
  let gid = 0;
  const touch = (type, pts) => {
    if (type === 'touchStart' && pts.length === 1) gid += 10;
    return cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: gid + i })) });
  };

  // ---- static audit: overflow, tap targets, contrast (with the layers panel open, so its controls count)
  const toggle = page.locator('#layers-toggle');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.tap();
  await page.locator('#layers-body details.settings summary').tap();
  await page.waitForTimeout(300);
  const audit = await page.evaluate((MIN) => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && !el.closest('[hidden]'); };
    // a control's tap target is its own box, or its <label>'s box when the label wraps it
    const target = (el) => {
      const lab = el.closest('label') ?? (el.id && document.querySelector(`label[for="${el.id}"]`)?.closest('.layer-row, label'));
      const rects = [el.getBoundingClientRect()];
      if (lab) rects.push(lab.getBoundingClientRect());
      return rects.reduce((a, r) => (r.width * r.height > a.width * a.height ? r : a));
    };
    const small = [];
    for (const el of document.querySelectorAll('button, a[href], input, summary, [role="slider"], [tabindex="0"]')) {
      if (!vis(el) || el.id === 'view' || el.classList.contains('label')) continue;
      const r = target(el);
      if (r.width < MIN - 0.5 || r.height < MIN - 0.5) small.push(`${el.id || el.className || el.tagName}${el.type ? '[' + el.type + ']' : ''} ${r.width.toFixed(0)}x${r.height.toFixed(0)}`);
    }
    // contrast of visible text against the nearest opaque-ish background, composited over the void
    const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 }; };
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
    const over = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
    const bgOf = (el) => {
      const stack = [];
      for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) stack.push(c); }
      let bg = { r: 4, g: 6, b: 11, a: 1 }; // --void behind everything
      for (const c of stack.reverse()) bg = over(c, bg);
      return bg;
    };
    const low = [];
    let checked = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    while (walker.nextNode()) {
      const el = walker.currentNode.parentElement;
      if (!el || seen.has(el) || !walker.currentNode.textContent.trim() || !vis(el) || el.closest('svg, noscript, .sr-only, dialog:not([open])')) continue;
      seen.add(el);
      const fg = parse(getComputedStyle(el).color);
      if (!fg) continue;
      const bg = bgOf(el);
      const f = over(fg, bg);
      const L1 = lum(f), L2 = lum(bg);
      const cr = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      checked++;
      if (cr < 4.5) low.push(`${el.className || el.tagName} "${walker.currentNode.textContent.trim().slice(0, 24)}" ${cr.toFixed(2)}`);
    }
    const doc = document.documentElement;
    return { scrollW: Math.max(doc.scrollWidth, document.body.scrollWidth), innerW: innerWidth, small, low, checked };
  }, MIN_TAP);
  out('overflow', { size: tag, scrollWidth: audit.scrollW, innerWidth: audit.innerW, result: verdict(audit.scrollW <= audit.innerW) });
  out('tap-targets', { size: tag, min: MIN_TAP, tooSmall: audit.small, result: verdict(audit.small.length === 0) });
  out('contrast', { size: tag, textNodes: audit.checked, below45: audit.low, result: verdict(audit.low.length === 0) });

  // ---- layers panel: open, usable (fits on screen, scrolls inside), toggles a layer
  const lp = await page.evaluate(() => {
    const r = document.getElementById('layers').getBoundingClientRect();
    const body = document.getElementById('layers-body');
    const search = document.querySelector('.top .search').getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, scrolls: document.getElementById('layers').scrollHeight > document.getElementById('layers').clientHeight || body.scrollHeight > body.clientHeight,
      overlapsSearch: r.top < search.bottom, overlapsInstrument: r.bottom > document.querySelector('.instrument').getBoundingClientRect().top + 1 };
  });
  const firstToggle = page.locator('#layer-list .toggle').first();
  const before = await firstToggle.isChecked();
  await firstToggle.tap();
  const after = await firstToggle.isChecked();
  await firstToggle.tap();
  await page.screenshot({ path: `${outdir}/${prefix}-${tag}-layers.png` });
  out('layers-panel', { size: tag, ...lp, toggled: before !== after, result: verdict(before !== after && lp.top >= 0 && lp.right <= W && !lp.overlapsInstrument && !lp.overlapsSearch) });
  await toggle.tap(); // close

  // ---- search: type, suggestion list visible and inside the screen, choose → info card
  await page.locator('#search').tap();
  await page.keyboard.type('Sirius');
  await page.waitForTimeout(300);
  const sg = await page.evaluate(() => { const l = document.getElementById('suggest'); const r = l.getBoundingClientRect(); return { shown: !l.hidden, items: l.children.length, right: r.right, bottom: r.bottom }; });
  await page.locator('#suggest li').first().tap();
  await page.waitForTimeout(800);
  const card = await page.evaluate(() => {
    const el = document.getElementById('info');
    const r = el.getBoundingClientRect();
    const fly = document.getElementById('info-fly').getBoundingClientRect();
    const close = document.getElementById('info-close').getBoundingClientRect();
    const ins = document.querySelector('.instrument').getBoundingClientRect();
    const onScreen = (b) => b.top >= 0 && b.bottom <= innerHeight && b.left >= 0 && b.right <= innerWidth;
    return { open: !el.hidden, title: document.getElementById('info-title').textContent, top: r.top, bottom: r.bottom, flyVisible: onScreen(fly), closeVisible: onScreen(close), overlapsInstrument: r.bottom > ins.top + 1, overlapsSearch: r.top < document.querySelector('.top .search').getBoundingClientRect().bottom };
  });
  out('search', { size: tag, ...sg, result: verdict(sg.shown && sg.items > 0 && sg.right <= W) });
  await page.screenshot({ path: `${outdir}/${prefix}-${tag}-info.png` });
  out('info-card', { size: tag, ...card, result: verdict(card.open && card.flyVisible && card.closeVisible && !card.overlapsInstrument && !card.overlapsSearch) });
  await page.locator('#info-close').tap();
  await page.waitForTimeout(1500);

  // ---- tour: start, caption on screen and not under the panels, stop
  await page.locator('#tour').tap();
  await page.waitForTimeout(1200);
  const tour = await page.evaluate(() => {
    const c = document.getElementById('caption');
    const r = c.getBoundingClientRect();
    const ins = document.querySelector('.instrument').getBoundingClientRect();
    const hit = (sel) => { const o = document.querySelector(sel); if (!o || o.hidden) return false; const q = o.getBoundingClientRect(); return q.width > 0 && !(q.right <= r.left || q.left >= r.right || q.bottom <= r.top || q.top >= r.bottom); };
    return { pressed: document.getElementById('tour').getAttribute('aria-pressed'), captionShown: !c.hidden, top: r.top, bottom: r.bottom, left: r.left, right: r.right,
      overlapsInstrument: r.bottom > ins.top + 1, overlapsLayers: hit('#layers'), overlapsSearch: hit('.top .search'), tourBtnH: document.getElementById('tour').getBoundingClientRect().height };
  });
  await page.screenshot({ path: `${outdir}/${prefix}-${tag}-tour.png` });
  await page.locator('#tour').tap();
  await page.waitForTimeout(400);
  const stopped = await page.evaluate(() => document.getElementById('tour').getAttribute('aria-pressed'));
  out('tour', { size: tag, ...tour, stoppedPressed: stopped, result: verdict(tour.pressed === 'true' && tour.captionShown && tour.left >= 0 && tour.right <= W && !tour.overlapsInstrument && !tour.overlapsLayers && !tour.overlapsSearch && tour.tourBtnH < 50 && stopped === 'false') });
  await page.evaluate(() => window.__atlas.setView({ focus: [0, 0, 0], dist: 300, yaw: -150 * Math.PI / 180, pitch: 22 * Math.PI / 180 }));
  await page.waitForTimeout(500);

  // ---- scale rail: one-finger drag to the right zooms out
  const rail = await page.locator('#rail').boundingBox();
  const d0 = (await page.evaluate(() => window.__atlas.stats())).view.dist;
  const ry = rail.y + rail.height / 2;
  await touch('touchStart', [[rail.x + rail.width * 0.5, ry]]);
  for (let i = 1; i <= 8; i++) await touch('touchMove', [[rail.x + rail.width * (0.5 + 0.04 * i), ry]]);
  await touch('touchEnd', []);
  await page.waitForTimeout(2500);
  const d1 = (await page.evaluate(() => window.__atlas.stats())).view.dist;
  out('scale-rail', { size: tag, railW: +rail.width.toFixed(0), railH: +rail.height.toFixed(0), distBefore: d0, distAfter: +d1.toPrecision(4), result: verdict(d1 > d0 * 10) });
  await page.evaluate(() => window.__atlas.setView({ focus: [0, 0, 0], dist: 300, yaw: -150 * Math.PI / 180, pitch: 22 * Math.PI / 180 }));
  await page.waitForTimeout(300);

  // ---- one-finger orbit on the canvas
  const v0 = (await page.evaluate(() => window.__atlas.stats())).view;
  const cx = W / 2, cy = H * 0.45;
  await touch('touchStart', [[cx, cy]]);
  for (let i = 1; i <= 10; i++) await touch('touchMove', [[cx + 8 * i, cy + 3 * i]]);
  await touch('touchEnd', []);
  await page.waitForTimeout(200);
  const v1 = (await page.evaluate(() => window.__atlas.stats())).view;
  const dYaw = (v1.yaw - v0.yaw) * 180 / Math.PI;
  out('one-finger-orbit', { size: tag, dYawDeg: +dYaw.toFixed(1), dPitchDeg: +((v1.pitch - v0.pitch) * 180 / Math.PI).toFixed(1), distRatio: +(v1.dist / v0.dist).toFixed(3), result: verdict(Math.abs(dYaw) > 10 && Math.abs(v1.dist / v0.dist - 1) < 0.01) });

  // ---- pinch: fingers apart → zoom in (distance falls by the span ratio)
  const p0 = (await page.evaluate(() => window.__atlas.stats())).view.dist;
  await touch('touchStart', [[cx - 40, cy], [cx + 40, cy]]);
  for (let i = 1; i <= 10; i++) await touch('touchMove', [[cx - 40 - 8 * i, cy], [cx + 40 + 8 * i, cy]]);
  await touch('touchEnd', []);
  await page.waitForTimeout(200);
  const p1 = (await page.evaluate(() => window.__atlas.stats())).view.dist;
  out('pinch-no-click', { size: tag, result: verdict(await page.evaluate(() => document.getElementById('info').hidden)) });
  out('pinch-zoom', { size: tag, distBefore: p0, distAfter: +p1.toPrecision(4), ratio: +(p1 / p0).toFixed(3), expected: +(80 / 240).toFixed(3), result: verdict(Math.abs(p1 / p0 - 80 / 240) < 0.05) });
  // pinch with the first finger on a map label: the label must not swallow the gesture
  await page.evaluate(() => window.__atlas.setView({ focus: [0, 0, 0], dist: 300, yaw: -150 * Math.PI / 180, pitch: 22 * Math.PI / 180 }));
  await page.waitForTimeout(1200);
  const lab = await page.evaluate(() => {
    const ok = [...document.querySelectorAll('#labels .label')].map((e) => e.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.top > 120 && r.bottom < innerHeight * 0.6 && r.left > 20 && r.left + 80 < innerWidth
        && document.elementFromPoint(r.left + 6, r.top + r.height / 2)?.classList.contains('label'));
    return ok.length ? { x: ok[0].left + 6, y: ok[0].top + ok[0].height / 2 } : null;
  });
  if (lab) {
    const q0 = (await page.evaluate(() => window.__atlas.stats())).view.dist;
    const other = [lab.x + 60, lab.y + 60];
    gid += 10;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: lab.x, y: lab.y, id: gid }, { x: other[0], y: other[1], id: gid + 1 }] });
    for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: lab.x - 3 * i, y: lab.y - 3 * i, id: gid }, { x: other[0] + 3 * i, y: other[1] + 3 * i, id: gid + 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(300);
    const q1 = (await page.evaluate(() => window.__atlas.stats())).view.dist;
    const hidden = await page.evaluate(() => document.getElementById('info').hidden);
    out('pinch-on-label', { size: tag, distBefore: q0, distAfter: +q1.toPrecision(4), ratio: +(q1 / q0).toFixed(3), infoHidden: hidden, result: verdict(q1 < q0 * 0.6 && hidden) });
    // a plain tap on a label still opens its card
    await page.evaluate(() => window.__atlas.setView({ focus: [0, 0, 0], dist: 300, yaw: -150 * Math.PI / 180, pitch: 22 * Math.PI / 180 }));
    await page.waitForTimeout(1200);
    const lab2 = await page.evaluate(() => { const e = [...document.querySelectorAll('#labels .label')].find((l) => { const r = l.getBoundingClientRect(); return r.width > 0 && r.top > 120 && r.bottom < innerHeight * 0.6 && r.left > 10 && r.left + 40 < innerWidth && +getComputedStyle(l).opacity > 0.5 && document.elementFromPoint(r.left + 20, r.top + r.height / 2) === l; }); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2, name: e.textContent }; });
    await page.touchscreen.tap(lab2.x, lab2.y);
    await page.waitForTimeout(500);
    const t = await page.evaluate(() => ({ open: !document.getElementById('info').hidden, title: document.getElementById('info-title').textContent }));
    out('tap-label', { size: tag, label: lab2.name, ...t, result: verdict(t.open && t.title === lab2.name) });
    await page.locator('#info-close').tap();
  } else out('pinch-on-label', { size: tag, result: 'skipped: no label on screen' });

  // pinch must not also have fired a click (info card stays closed)

  // ---- keyboard focus ring visible on a control
  await page.locator('#home').focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  const ring = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return { id: document.activeElement.id, outline: `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}` }; });
  out('focus-visible', { size: tag, ...ring, result: verdict(ring.outline.startsWith('solid') && parseFloat(ring.outline.split(' ')[1]) >= 2) });

  await page.screenshot({ path: `${outdir}/${prefix}-${tag}.png` });
  out('problems', { size: tag, logs: logs.length ? logs : 'none', result: verdict(logs.length === 0) });
  await ctx.close();
}
out('summary', { failures });
await browser.close();
process.exit(failures ? 1 : 0);
