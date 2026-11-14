// Capture the streamed Moon / Mars surfaces (src/solar/surface) with an isolated headless Chrome
// (same GPU flags as capture_views.mjs): Tycho, the Apollo 11 site, Olympus Mons and Gale crater,
// each straight down from a few altitudes, centred on the gazetteer coordinates. A thin ring marks
// the screen centre (= the target point). For each feature the simulation clock is set to the first
// time after START when the Sun stands 20-45 deg above that spot, so relief shows in daylight.
// Prints, per view: tile requests made, cache size, leaves drawn, the deepest level, labels shown,
// and any console/HTTP problems.
// usage (dev server running): node scripts/capture_surface.mjs [outdir=../figures] [baseUrl] [only=tycho,gale]
import { chromium } from 'playwright-core';

const [,, outdir = '../figures', base = 'http://localhost:5173/', only = ''] = process.argv;
const START = '2026-11-13T00:00:00Z';
const TARGETS = [
  { file: 'tycho', body: 'moon', name: 'Tycho', lat: -43.31, lon: -11.36, alts: [1500, 300, 60] },
  { file: 'apollo11', body: 'moon', name: 'Apollo 11', lat: 0.674, lon: 23.473, alts: [300, 60, 12] },
  { file: 'olympus-mons', body: 'mars', name: 'Olympus Mons', lat: 18.65, lon: 226.2, alts: [2500, 800, 150] },
  { file: 'gale', body: 'mars', name: 'Gale crater', lat: -5.4, lon: 137.8, alts: [800, 200, 30, 12] },
];
const RELIEF = [
  { file: 'tycho', body: 'moon', alt: 300 },
  { file: 'olympus-mons', body: 'mars', alt: 2500 },
];

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--enable-features=WebGPU'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('response', (r) => { if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url()}`); });
await page.goto(`${base}#v=0,0,0,0.0003,-150,30`);
await page.waitForFunction(() => window.__atlas?.solar?.surface?.feature('Tycho'), null, { timeout: 60000 });
console.log('navigator.gpu:', await page.evaluate(async () => { if (!navigator.gpu) return 'absent'; const a = await navigator.gpu.requestAdapter(); return a ? (a.info?.vendor + ' ' + a.info?.architecture) : 'no adapter'; }));
await page.evaluate(() => {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:50%;top:50%;width:22px;height:22px;margin:-11px 0 0 -11px;border:1px solid rgba(255,90,60,.85);border-radius:50%;pointer-events:none;z-index:99';
  document.body.append(d);
  document.getElementById('info')?.setAttribute('hidden', '');
  const lp = document.getElementById('layers'); if (lp) lp.style.display = 'none'; // the layer panel would cover a fifth of the view
});

/** first time from START (Moon: 2 h steps, Mars: 10 min) with the Sun 20-45 deg up at (lat, lon) */
async function daylight(t) {
  return page.evaluate(({ t, START }) => {
    const a = window.__atlas.solar;
    const step = t.body === 'moon' ? 2 * 3600e3 : 600e3;
    let ms = Date.parse(START);
    for (let i = 0; i < 2000; i++, ms += step) {
      a.setTime(new Date(ms).toISOString());
      const e = a.surface.sunElev(t.body, t.lat, t.lon);
      if (e > 20 && e < 45) return { iso: new Date(ms).toISOString(), sunElev: +e.toFixed(1) };
    }
    return null;
  }, { t, START });
}

async function settle() {
  // wait for the tile queue to drain: idle on 3 checks in a row, at most 90 s
  let ok = 0;
  const t0 = Date.now();
  await page.evaluate(() => window.__atlas.setContinuous(true));
  while (Date.now() - t0 < 90000) {
    await page.waitForTimeout(400);
    ok = (await page.evaluate(() => window.__atlas.solar.surface.idle())) ? ok + 1 : 0;
    if (ok >= 3) break;
  }
  await page.waitForTimeout(700); // last cross-fades (350 ms)
  await page.evaluate(() => window.__atlas.setContinuous(false));
  return Date.now() - t0;
}

const rows = [];
await page.evaluate(() => window.__atlas.solar.pause(true));
for (const t of TARGETS.filter((x) => !only || only.split(',').includes(x.file))) {
  const day = await daylight(t);
  const f = await page.evaluate((n) => window.__atlas.solar.surface.feature(n), t.name);
  console.log(`${t.name}: gazetteer ${JSON.stringify(f)}; time ${day?.iso} (Sun ${day?.sunElev} deg up)`);
  for (const alt of t.alts) {
    const before = await page.evaluate(() => window.__atlas.solar.surface.stats().cache.requests);
    await page.evaluate(({ t, alt }) => window.__atlas.solar.surface.lookDown(t.body, t.lat, t.lon, alt), { t, alt });
    const ms = await settle();
    const s = await page.evaluate(() => window.__atlas.solar.surface.stats());
    const labels = await page.evaluate(() => window.__atlas.solar.surface.labels());
    const path = `${outdir}/surface-${t.file}-${alt}km.png`;
    await page.screenshot({ path });
    const row = { view: `${t.file} ${alt} km`, requests: s.cache.requests - before, settle_s: +(ms / 1000).toFixed(1), leaves: s[t.body].leaves, ownTile: s[t.body].withOwnTile, maxLevel: s[t.body].maxLevel, resident: s.cache.resident, residentMB: s.cache.residentMB, failed: s.cache.failed, labels: labels.slice(0, 8).join(' | ') };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
}
for (const r of RELIEF.filter((x) => !only || only.split(',').includes(x.file))) {
  const t = TARGETS.find((x) => x.file === r.file);
  await daylight(t);
  await page.evaluate(({ t, r }) => { const s = window.__atlas.solar.surface; s.setMode(t.body, 'relief'); s.lookDown(t.body, t.lat, t.lon, r.alt); }, { t, r });
  await settle();
  await page.screenshot({ path: `${outdir}/surface-${r.file}-${r.alt}km-relief.png` });
  await page.evaluate(({ t }) => window.__atlas.solar.surface.setMode(t.body, 'photo'), { t });
  console.log(`relief ${r.file} ${r.alt} km saved`);
}
const s = await page.evaluate(() => window.__atlas.solar.surface.stats());
console.log('cache totals:', JSON.stringify(s.cache));
const hosts = await page.evaluate(() => { const m = {}; for (const u of window.__atlas.solar.surface.log()) { const h = new URL(u).host + new URL(u).pathname.split('/').slice(0, 5).join('/'); m[h] = (m[h] ?? 0) + 1; } return m; });
console.log('requests by layer:', JSON.stringify(hosts));
console.log('search:', JSON.stringify(await page.evaluate(() => ['Olympus Mons', 'Tixo', 'Тихо', 'Apollo 11', 'Аполлон-11', 'Curiosity', 'Gale', 'Ulugʻbek'].map((q) => [q, window.__atlas.solar.search(q)[0] ?? null]))));
console.log('console/http problems:', logs.length ? logs.slice(0, 20) : 'none');
await browser.close();
