// Capture the viewer at 1 pc, 300 pc, 30 kpc and 1 Gpc with an isolated headless Chrome and
// print backend / FPS / loaded points per view plus any console or HTTP errors.
// usage (dev server running): node scripts/capture_views.mjs [outdir=../figures] [prefix=viewer] [query] [baseUrl]
//   query "?backend=webgl" forces the WebGL2 backend.

// usage: node scales.mjs <outdir> [prefix]
import { chromium } from 'playwright-core';
const [,, outdir = '../figures', prefix = 'viewer', query = '', base = 'http://localhost:5173/'] = process.argv;
const VIEWS = [
  ['1pc', '#v=0,0,0,1,-150,18'],
  ['300pc', '#v=0,0,0,300,-150,22'],
  ['30kpc', '#v=0,0,0,30000,-120,58'],
  ['1Gpc', '#v=0,0,0,1e9,-150,28'],
];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--enable-features=WebGPU'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()} ${m.location()?.url ?? ''}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('response', (r) => { if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url()}`); });
await page.goto(`${base}${query}${VIEWS[0][1]}`);
console.log('navigator.gpu:', await page.evaluate(async () => { if (!navigator.gpu) return 'absent'; const a = await navigator.gpu.requestAdapter(); return a ? (a.info?.vendor + ' ' + a.info?.architecture) : 'no adapter'; }));
await page.waitForTimeout(2500);
for (const [name, hash] of VIEWS) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  // wait until streaming settles (or 15 s)
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(500);
    const s = await page.evaluate(() => window.__atlas.stats());
    if (i > 5 && s.inFlight === 0 && s.queued === 0) break;
  }
  // measure FPS with continuous rendering (the app renders on demand and idles otherwise)
  await page.evaluate(() => window.__atlas.setContinuous(true));
  await page.waitForTimeout(2200);
  const s = await page.evaluate(() => window.__atlas.stats());
  await page.evaluate(() => window.__atlas.setContinuous(false));
  await page.screenshot({ path: `${outdir}/${prefix}-${name}.png` });
  console.log(name, JSON.stringify({ backend: s.backend, fps: +s.fps.toFixed(1), drawnPoints: s.drawnPoints, drawnNodes: s.drawnNodes, loadedNodes: s.loadedNodes, blobs: s.blobs, light: Object.fromEntries(Object.entries(s.light).map(([k, v]) => [k, +v.toFixed(4)])), inFlight: s.inFlight, dist: s.view.dist }));
}
console.log('console/http problems:', logs.length ? logs : 'none');
await browser.close();
