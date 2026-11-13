// Frame-rate / frame-time benchmark of the point budget at one view (default: 1 Gpc with DESI).
// For each budget it waits until streaming settles, renders continuously, and samples the time
// between completed GPU frames (renders per second with the 2-frames-in-flight cap = GPU-bound
// throughput) plus requestAnimationFrame intervals.
// usage (dev server running):
//   node scripts/perf_budget.mjs [budgetsM=4,8,12] [query] [hash] [baseUrl] [--uncapped]
// --detail=N sets the Detail slider first.
// --uncapped launches Chrome without vsync / frame-rate limit, so headroom above 60 FPS shows.
import { chromium } from 'playwright-core';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const uncapped = process.argv.includes('--uncapped');
const [budgets = '4,8,12', query = '', hash = '#v=0,0,0,1e9,-150,28', base = 'http://localhost:5173/'] = args;
const flags = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--enable-features=WebGPU'];
if (uncapped) flags.push('--disable-gpu-vsync', '--disable-frame-rate-limit');
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: flags });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const problems = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => problems.push(e.message));
await page.goto(`${base}${query}${hash}`);
await page.waitForFunction(() => window.__atlas, null, { timeout: 30000 });
// --detail=N sets the Detail slider (60..400; default 140), so a large budget can actually be filled
const detail = process.argv.find((a) => a.startsWith('--detail='))?.split('=')[1];
if (detail) await page.evaluate((v) => { const el = document.getElementById('detail'); el.value = v; el.dispatchEvent(new Event('input')); }, detail);

for (const b of budgets.split(',').map(Number)) {
  await page.evaluate((v) => { const el = document.getElementById('budget'); el.max = String(Math.max(+el.max, v)); el.value = String(v); el.dispatchEvent(new Event('input')); }, b);
  const t0 = Date.now();
  for (;;) {
    await page.waitForTimeout(500);
    const s = await page.evaluate(() => window.__atlas.stats());
    if ((Date.now() - t0 > 4000 && s.inFlight === 0 && s.queued === 0 && !s.fading) || Date.now() - t0 > 90000) break;
  }
  const r = await page.evaluate(async () => {
    const A = window.__atlas;
    A.setContinuous(true);
    await new Promise((res) => setTimeout(res, 1500)); // warm up
    const raf = [];
    let last = performance.now();
    let on = true;
    const tick = (t) => { raf.push(t - last); last = t; if (on) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    const fps = [];
    for (let i = 0; i < 5; i++) {
      await new Promise((res) => setTimeout(res, 1000));
      fps.push(A.stats().fps);
    }
    on = false;
    A.setContinuous(false);
    const s = A.stats();
    raf.sort((a, b) => a - b);
    const q = (p) => raf[Math.min(raf.length - 1, Math.floor(p * raf.length))];
    return { backend: s.backend, drawnPoints: s.drawnPoints, drawnNodes: s.drawnNodes, blobs: s.blobs, pending: s.pending, fps,
      rafP50: q(0.5), rafP95: q(0.95), rafMax: raf[raf.length - 1] };
  });
  const meanFps = r.fps.reduce((a, b) => a + b, 0) / r.fps.length;
  console.log(JSON.stringify({ budgetM: b, detail: detail ?? 'default', uncapped, backend: r.backend, drawnM: +(r.drawnPoints / 1e6).toFixed(2), drawnNodes: r.drawnNodes,
    fpsMean: +meanFps.toFixed(1), fpsMin: +Math.min(...r.fps).toFixed(1), frameMs: +(1000 / meanFps).toFixed(1),
    rafP50: +r.rafP50.toFixed(1), rafP95: +r.rafP95.toFixed(1), rafMax: +r.rafMax.toFixed(1),
    pendingDesi: r.pending['galaxies-desi'] !== undefined ? +r.pending['galaxies-desi'].toFixed(3) : null }));
}
console.log(JSON.stringify({ problems: problems.length ? problems : 'none' }));
await browser.close();
