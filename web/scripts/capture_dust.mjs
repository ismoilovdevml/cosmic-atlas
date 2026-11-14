// 3D dust layer: captures, on/off pairs, the Sun-side null test and GPU time per quality.
// usage (dev server up): node scripts/capture_dust.mjs [outdir=../figures] [baseUrl=http://localhost:5173/]
//   writes <outdir>/dust-<view>.png (dust on) and dust-<view>-off.png (dust layer hidden);
//   prints GPU ms per frame (timestamp queries) with the dust off / low / medium / high.
import { chromium } from 'playwright-core';

const [,, outdir = '../figures', base = 'http://localhost:5173/'] = process.argv;
const url = `${base}${base.includes('?') ? '&' : '?'}gputime`;
// Taurus as the map places it (meta.json landmarks): (-136, 25, -40) pc. The inside view looks at it
// from 110 pc off the Sun-Taurus line, so the cloud stands against the sky toward l ≈ 80° (Cygnus).
const VIEWS = [
  ['300pc', { focus: [0, 0, 0], dist: 300, yawDeg: -150, pitchDeg: 22 }],
  ['1kpc', { focus: [0, 0, 0], dist: 1000, yawDeg: -150, pitchDeg: 35 }],
  ['3kpc', { focus: [0, 0, 0], dist: 3000, yawDeg: -120, pitchDeg: 40 }],
  ['taurus-inside', { focus: [-136, 25, -40], dist: 110, yawDeg: -100.4, pitchDeg: 10 }],
  // camera AT the Sun (focus 30 pc toward the anticentre): the relative extinction must change nothing
  ['sun-null', { focus: [-30, 0, 0], dist: 30, yawDeg: 0, pitchDeg: 0 }],
];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--enable-features=WebGPU'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('response', (r) => { if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url()}`); });
await page.goto(url);
await page.waitForFunction(() => window.__atlas?.dust?.state().status === 'ready', null, { timeout: 60000, polling: 250 });
console.log('backend', await page.evaluate(() => window.__atlas.stats().backend), 'dust', JSON.stringify(await page.evaluate(() => window.__atlas.dust.state())));
const settle = async () => {
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(400);
    const s = await page.evaluate(() => window.__atlas.stats());
    if (i > 4 && s.inFlight === 0 && s.queued === 0) break;
  }
  await page.evaluate(() => window.__atlas.setContinuous(true));
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__atlas.setContinuous(false));
  await page.waitForTimeout(300);
};
const only = process.env.DUST_VIEWS ? process.env.DUST_VIEWS.split(',') : null;
for (const [name, v] of VIEWS) {
  if (only && !only.includes(name)) continue;
  await page.evaluate((v) => window.__atlas.setView({ focus: v.focus, dist: v.dist, yaw: (v.yawDeg * Math.PI) / 180, pitch: (v.pitchDeg * Math.PI) / 180 }), v);
  await page.evaluate(() => window.__atlas.setLayer('dust', true));
  await settle();
  const st = await page.evaluate(() => window.__atlas.dust.state());
  await page.screenshot({ path: `${outdir}/dust-${name}.png` });
  const gpu = {};
  for (const q of ['low', 'medium', 'high']) {
    await page.evaluate((q) => window.__atlas.dust.setQuality(q), q);
    gpu[q] = await page.evaluate(() => window.__atlas.bh.gpuMs(2500));
  }
  await page.evaluate(() => window.__atlas.dust.setQuality('low'));
  await page.evaluate(() => window.__atlas.setLayer('dust', false));
  await settle();
  await page.screenshot({ path: `${outdir}/dust-${name}-off.png` });
  gpu.off = await page.evaluate(() => window.__atlas.bh.gpuMs(2500));
  await page.evaluate(() => window.__atlas.setLayer('dust', true));
  const f = (g) => (g?.medianMs ? `${g.medianMs.toFixed(2)}/${g.p90Ms.toFixed(2)}` : 'n/a');
  console.log(`${name}: amount ${st.amount.toFixed(2)} active ${st.active}; GPU ms median/p90 per frame: off ${f(gpu.off)}, low ${f(gpu.low)}, medium ${f(gpu.medium)}, high ${f(gpu.high)}`);
}
// a click on Taurus in the inside view: the info card
if (!only || only.includes('taurus-inside')) {
  const v = VIEWS.find((x) => x[0] === 'taurus-inside')[1];
  await page.evaluate((v) => window.__atlas.setView({ focus: v.focus, dist: v.dist, yaw: (v.yawDeg * Math.PI) / 180, pitch: (v.pitchDeg * Math.PI) / 180 }), v);
  await settle();
  const title = await page.evaluate(() => window.__atlas.dust.pickAt(720, 450));
  const rows = await page.evaluate(() => [...document.querySelectorAll('#info-rows dt')].map((dt) => `${dt.textContent}: ${dt.nextElementSibling?.textContent}`));
  console.log('pick at screen centre:', title, JSON.stringify(rows));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${outdir}/dust-taurus-card.png` });
}
console.log('console/http problems:', logs.length ? logs : 'none');
await browser.close();
