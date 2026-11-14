// Label declutter captures: the Galactic Centre seen from 5 and 7 kpc, and Orion from 400 pc.
// Prints, per view, the visible labels by kind, aggregate badges, and how many visible label
// boxes overlap (measured from the DOM), then saves <outdir>/<prefix>-<view>.png.
// usage (dev or preview server running): node scripts/capture_labels.mjs [outdir=../figures] [prefix=labels] [baseUrl]
import { chromium } from 'playwright-core';

const [,, outdir = '../figures', prefix = 'labels', base = 'http://localhost:5173/'] = process.argv;
// focus x,y,z (pc, Galactic), camera distance, yaw, pitch (deg); yaw 180 = camera on the Sun's side of the GC
const VIEWS = [
  ['gc-7kpc', '#v=8275,0,0,7000,180,12'],
  ['gc-5kpc', '#v=8275,0,0,5000,165,25'],
  // Orion Nebula (M42, ~412 pc at l 209.0, b -19.4) with the camera 400 pc away, near the Sun
  ['orion-400pc', '#v=-333,-200,-137,400,31,19.4'],
];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--enable-features=WebGPU'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text().slice(0, 200)); });
await page.goto(`${base}?lang=en${VIEWS[0][1]}`);
await page.waitForFunction(() => window.__atlas, null, { timeout: 60000 });
for (const [name, hash] of VIEWS) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForTimeout(1200);
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(500);
    const s = await page.evaluate(() => window.__atlas.stats());
    if (i > 3 && s.inFlight === 0 && s.queued === 0 && !s.fading) break;
  }
  await page.waitForTimeout(800); // label fades (300 ms)
  const r = await page.evaluate(() => {
    const els = [...document.querySelectorAll('#labels .label')].filter((e) => getComputedStyle(e).visibility !== 'hidden' && +getComputedStyle(e).opacity > 0.5);
    const rects = els.map((e) => e.getBoundingClientRect());
    let overlaps = 0;
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) overlaps++;
    }
    // kind from the marker colour (kinds.ts), so the baseline build (no data-k) is counted the same way
    const COL = { '#a8f0e0': 'pulsar', '#ffb38a': 'snr', '#ff9fb2': 'nebula', '#ffe9a8': 'cluster', '#f4e6c8': 'star', '#cfe3ff': 'wd',
      '#c9a8ff': 'black_hole', '#9fd8a8': 'exoplanet', '#f0c9a8': 'galaxy', '#ffd1f0': 'message', '#9fe6ff': 'qso' };
    const byKind = {};
    for (const e of els) {
      const k = e.classList.contains('cluster') ? 'badge' : e.dataset.kind === 'model' ? 'model' : COL[e.style.getPropertyValue('--kc')] ?? e.dataset.kind;
      byKind[k] = (byKind[k] ?? 0) + 1;
    }
    return { visible: els.length, overlaps, byKind, badges: els.filter((e) => e.classList.contains('cluster')).map((e) => e.textContent), names: els.slice(0, 60).map((e) => e.textContent) };
  });
  await page.screenshot({ path: `${outdir}/${prefix}-${name}.png` });
  console.log(name, JSON.stringify(r));
}
console.log('problems:', problems.length ? problems : 'none');
await browser.close();
