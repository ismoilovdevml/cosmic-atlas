// Capture the black hole views with an isolated headless Chrome (same GPU flags as capture_views.mjs):
// Sgr A* with its disk at 50, 10 and 3 r_s, Gaia BH3 lensing the Gaia sky, the HUD at the 1.5 r_s
// floor, and an FPS run per lens quality. Prints backend, lens state, FPS and console/HTTP problems.
// usage (dev server running): node scripts/capture_blackholes.mjs [outdir=../figures] [baseUrl] [dpr=1]
import { chromium } from 'playwright-core';

const [,, outdir = '../figures', base = 'http://localhost:5173/', dprArg = '1'] = process.argv;
const dpr = +dprArg;
// v: [hole, x (r_s), how]; how = earth (line of sight from the Sun) | disk incl/az | yaw offset
const VIEWS = [
  ['sgra-50rs', { hole: 'Sgr A*', x: 50, disk: true, incl: 80, az: 0 }],
  ['sgra-10rs', { hole: 'Sgr A*', x: 10, disk: true, incl: 80, az: 0 }],
  ['sgra-3rs', { hole: 'Sgr A*', x: 3, disk: true, incl: 70, az: 0, fov: 90 }],
  ['sgra-earth-25rs', { hole: 'Sgr A*', x: 25, disk: true, earth: true }],
  ['m87-earth-25rs', { hole: 'M87*', x: 25, disk: true, earth: true }],
  ['sgra-noDisk-10rs', { hole: 'Sgr A*', x: 10, disk: false, incl: 80, az: 0 }],
  ['gaia-bh3-40rs', { hole: 'Gaia BH3', x: 40, disk: false, earth: true }],
  ['gaia-bh3-10rs', { hole: 'Gaia BH3', x: 10, disk: false, earth: true }],
  ['gaia-bh3-flamm-30rs', { hole: 'Gaia BH3', x: 30, disk: false, earth: true, yaw: 0, pitchDeg: 35, flamm: true }],
  // camera pushed to 1.2 r_s (the map must stop it at 1.5 r_s), looking 100 deg away from the hole: at the photon
  // sphere the shadow edge lies exactly 90 deg from the hole, so it crosses the screen 10 deg left of centre
  ['hud-gaia-bh3-floor', { hole: 'Gaia BH3', x: 1.2, disk: false, look: 100, hudShot: true }],
  ['hud-sgra-10rs', { hole: 'Sgr A*', x: 10, disk: true, look: 60 }],
];

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--enable-features=WebGPU'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('response', (r) => { if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url()}`); });
await page.goto(`${base}#v=0,0,0,6,-150,22`);
await page.waitForFunction(() => window.__atlas?.bh && window.__atlas.bh.holes().length > 0, null, { timeout: 60000 });
console.log('navigator.gpu:', await page.evaluate(async () => { if (!navigator.gpu) return 'absent'; const a = await navigator.gpu.requestAdapter(); return a ? (a.info?.vendor + ' ' + a.info?.architecture) : 'no adapter'; }));
console.log('holes:', JSON.stringify(await page.evaluate(() => window.__atlas.bh.holes().filter((h) => ['Sgr A*', 'M87*', 'Gaia BH3', 'Gaia BH1'].includes(h.name)))));
await page.waitForTimeout(1500);

for (const [name, v] of VIEWS) {
  const st = await page.evaluate((v) => {
    const a = window.__atlas;
    a.setFov(v.fov ?? 55);
    a.bh.setDisk(v.hole, v.disk);
    a.bh.setFlamm(!!v.flamm || !!v.hudShot);
    const view = v.look !== undefined ? a.bh.lookView(v.hole, v.x, v.look) : v.earth ? a.bh.view(v.hole, v.x, v.yaw ?? 0, v.pitchDeg) : a.bh.diskView(v.hole, v.x, v.incl, v.az);
    a.bh.setView(view);

    return a.bh.state();
  }, v);
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__atlas.setContinuous(true));
  await page.waitForTimeout(2200);
  const s = await page.evaluate((v) => {
    const a = window.__atlas;
    // screen direction of celestial north and east at the hole (Earth views): a tiny sky offset at the hole's distance
    const sky = v.earth ? a.bh.skyAxes() : null;
    return { fps: +a.stats().fps.toFixed(1), backend: a.stats().backend, ...a.bh.state(), sky };
  }, v);
  await page.evaluate(() => window.__atlas.setContinuous(false));
  await page.screenshot({ path: `${outdir}/bh-${name}.png` });
  console.log(name, JSON.stringify({ before: st, ...s }));
}

// FPS per quality at the most expensive view (close, disk on, every pixel traced)
await page.evaluate(() => {
  const a = window.__atlas;
  a.setFov(55);
  a.bh.setDisk('Sgr A*', true);
  a.bh.setFlamm(true);
  a.bh.setView(a.bh.diskView('Sgr A*', 10, 80, 0));
});
// with ?gputime in the base URL, also the GPU time per frame from timestamp queries (median, p90)
const gpu = base.includes('gputime');
for (const q of ['off', 'low', 'medium', 'high']) {
  await page.evaluate((q) => {
    const a = window.__atlas;
    a.bh.setLens(q !== 'off');
    if (q !== 'off') a.bh.setQuality(q);
    a.setContinuous(true);
  }, q);
  await page.waitForTimeout(3500);
  const fps = await page.evaluate(() => window.__atlas.stats().fps);
  const g = gpu ? await page.evaluate(() => window.__atlas.bh.gpuMs(3000)) : null;
  console.log(`sgra-10rs lens=${q} dpr=${dpr}: ${fps.toFixed(1)} fps${g ? `, GPU ${g.medianMs?.toFixed(2)} ms median / ${g.p90Ms?.toFixed(2)} ms p90 per frame` : ''}`);
}
await page.evaluate(() => window.__atlas.bh.setLens(true));
await page.evaluate(() => { window.__atlas.bh.setQuality('medium'); window.__atlas.setContinuous(false); });
// "Experience it" on the info card: from the Sun's neighbourhood, open Gaia BH3's card and press the button
await page.evaluate(() => {
  const a = window.__atlas;
  a.setFov(55);
  a.setView({ focus: [0, 0, 0], dist: 6, yaw: -2.6, pitch: 0.38 });
});
await page.waitForTimeout(1500);
console.log('lens state at 6 pc from the Sun:', JSON.stringify(await page.evaluate(() => window.__atlas.bh.state())));
await page.evaluate(() => window.__atlas.showEntry('Gaia BH3'));
const btn = await page.waitForSelector('.bh-exp', { timeout: 5000 });
console.log('info-card button:', JSON.stringify(await btn.textContent()));
await btn.click();
const t0 = Date.now();
await page.waitForFunction(() => { const s = window.__atlas.bh.state(); return s.active === 'Gaia BH3' && Math.abs(s.x - 40) < 0.5; }, null, { timeout: 60000, polling: 250 });
console.log(`experience flight: ${((Date.now() - t0) / 1000).toFixed(1)} s ->`, JSON.stringify(await page.evaluate(() => window.__atlas.bh.state())));
await page.waitForTimeout(2500);
await page.screenshot({ path: `${outdir}/bh-experience-gaia-bh3.png` });
console.log('console/http problems:', logs.length ? logs : 'none');
await browser.close();
