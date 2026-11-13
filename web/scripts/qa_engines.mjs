// Cross-engine / cross-backend QA run. For one engine and one backend query it visits the four
// scale views, the thin-slab views, the distance-uncertainty mode, a blob-dominated view and a
// grid of GPU picks, and prints one JSON object per check plus every console/HTTP problem.
//
// usage (dev server running):
//   node scripts/qa_engines.mjs <engine=chromium|firefox|webkit> <outdir> <prefix> [query] [baseUrl]
//   e.g. node scripts/qa_engines.mjs chromium /tmp/qa gpu
//        node scripts/qa_engines.mjs chromium /tmp/qa gl '?backend=webgl'
//        node scripts/qa_engines.mjs webkit   /tmp/qa wk
// Screenshots: <outdir>/<prefix>-<view>.png. Pair them with scripts/qa_compare.mjs.
import { chromium, firefox, webkit } from 'playwright-core';

const [,, engine = 'chromium', outdir = '../figures', prefix = 'qa', query = '', base = 'http://localhost:5173/'] = process.argv;
const VIEWS = [
  ['1pc', '#v=0,0,0,1,-150,18'],
  ['300pc', '#v=0,0,0,300,-150,22'],
  ['30kpc', '#v=0,0,0,30000,-120,58'],
  ['1Gpc', '#v=0,0,0,1e9,-150,28'],
  ['200Mpc-slab', '#v=0,0,0,2e8,-150,28&slab=25'],
  ['1Gpc-slab', '#v=0,0,0,1e9,-150,28&slab=75'],
];

const launchers = { chromium, firefox, webkit };
const opts = engine === 'chromium'
  ? { channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--enable-features=WebGPU'] }
  : { headless: true };
const browser = await launchers[engine].launch(opts);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text().slice(0, 400)}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('response', (r) => { if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url()}`); });

const out = (k, v) => console.log(JSON.stringify({ check: k, ...v }));
await page.goto(`${base}${query}${VIEWS[0][1]}`);
const gpu = await page.evaluate(async () => {
  if (!navigator.gpu) return 'navigator.gpu absent';
  try {
    const a = await navigator.gpu.requestAdapter();
    return a ? `adapter ${a.info?.vendor ?? '?'} ${a.info?.architecture ?? ''}` : 'no adapter';
  } catch (e) { return `requestAdapter threw: ${e.message}`; }
});
try {
  await page.waitForFunction(() => window.__atlas, null, { timeout: 30000 });
} catch {
  out('boot', { engine, gpu, ok: false, logs });
  await browser.close();
  process.exit(1);
}
const ua = await page.evaluate(() => navigator.userAgent);
out('boot', { engine, ua, gpu, backend: (await page.evaluate(() => window.__atlas.stats())).backend });

async function settle(maxMs = 20000) {
  const t0 = Date.now();
  await page.waitForTimeout(1500);
  while (Date.now() - t0 < maxMs) {
    const s = await page.evaluate(() => window.__atlas.stats());
    if (s.inFlight === 0 && s.queued === 0 && !s.fading) break;
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(600); // density exposure smoothing / fades
}
async function measure() {
  await page.evaluate(() => window.__atlas.setContinuous(true));
  await page.waitForTimeout(2200);
  const s = await page.evaluate(() => window.__atlas.stats());
  await page.evaluate(() => window.__atlas.setContinuous(false));
  return s;
}
const brief = (s) => ({ backend: s.backend, fps: +s.fps.toFixed(1), drawnPoints: s.drawnPoints, drawnNodes: s.drawnNodes, blobs: s.blobs,
  light: Object.fromEntries(Object.entries(s.light).map(([k, v]) => [k, +v.toFixed(4)])), dist: s.view.dist });
async function go(hash) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await settle();
}

// ---- scales + slab views
for (const [name, hash] of VIEWS) {
  await go(hash);
  const s = await measure();
  const density = await page.evaluate(() => window.__atlas.density());
  await page.screenshot({ path: `${outdir}/${prefix}-${name}.png` });
  out('view', { name, ...brief(s), slab: s.slab, density: { p98: density.p98, k: +density.k.toPrecision(4), kSmoothed: +density.kSmoothed.toPrecision(4) } });
}
await page.evaluate(() => window.__atlas.setSlab(0));

// ---- blob-dominated view: 1 Gpc at the minimum budget (most light is in subtree blobs)
await page.evaluate(() => { const b = document.getElementById('budget'); b.value = '0.5'; b.dispatchEvent(new Event('input')); });
await go('#v=0,0,0,1e9,-150,28');
let s = await measure();
await page.screenshot({ path: `${outdir}/${prefix}-blobs.png` });
out('blobs', { ...brief(s), pending: s.pending });
await page.evaluate(() => { const b = document.getElementById('budget'); b.value = '4'; b.dispatchEvent(new Event('input')); });

// ---- distance uncertainty: off vs on at the same view (stars at 300 pc have 24 B ext records)
await go('#v=0,0,0,300,-150,22');
await page.evaluate(() => window.__atlas.setUncertainty(true));
await settle();
s = await measure();
const unc = { uncNodes: s.uncNodes };
await page.screenshot({ path: `${outdir}/${prefix}-unc.png` });
out('uncertainty', { ...brief(s), unc });
await page.evaluate(() => window.__atlas.setUncertainty(false));

// ---- GPU picking on a fixed grid at 300 pc; the same pixel must give the same id on any backend
await go('#v=0,0,0,300,-150,22');
const picks = [];
for (let gy = 1; gy <= 6; gy++) {
  for (let gx = 1; gx <= 9; gx++) {
    const x = Math.round((1440 * gx) / 10);
    const y = Math.round((900 * gy) / 7);
    await page.evaluate(([px, py]) => window.__atlas.pickAt(px, py), [x, y]);
    const sel = (await page.evaluate(() => window.__atlas.stats())).selection;
    if (sel?.ref) picks.push(`${x},${y}=${sel.ref.layer ?? 'cat'}:${sel.ref.id ?? sel.ref.name}`);
  }
}
// a click on empty sky must clear the card: probe the top-left corner of the canvas
out('pick', { hits: picks.length, of: 54, picks });

console.log(JSON.stringify({ check: 'problems', engine, prefix, logs: logs.length ? logs : 'none' }));
await browser.close();
