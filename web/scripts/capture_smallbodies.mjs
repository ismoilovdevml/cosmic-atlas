// Capture the asteroid/comet and satellite layers with an isolated headless Chrome (same GPU
// flags as capture_views.mjs): the inner Solar System with the main belt, Jupiter's trojans, the
// Kuiper belt from 60 AU, and the Earth with the ISS and the satellite shell. The clock is paused
// at one instant. Prints backend, FPS with continuous rendering, GPU ms per frame (?gputime),
// what was loaded and drawn, a CPU pick timing, and any console/HTTP problems.
// usage (dev server running): node scripts/capture_smallbodies.mjs [outdir=../figures] [baseUrl] [isoTime] [cap]
import { chromium } from 'playwright-core';

const [,, outdir = '../figures', base = 'http://localhost:5173/', iso = '2026-11-14T06:00:00Z', cap = '0'] = process.argv;
const AU = 4.84813681109536e-6;
const PC_PER_KM = AU / 149597870.7;
// the ecliptic pole is at Galactic l = 96.38, b = 29.81: yaw 96.38, pitch 29.81 looks straight down
const VIEWS = [
  ['smallbodies-inner', { sun: true, dist: 7 * AU, yawDeg: 96.38, pitchDeg: 29.81 + 12 }],
  ['smallbodies-trojans', { sun: true, dist: 16 * AU, yawDeg: 96.38, pitchDeg: 29.81 + 8 }],
  ['smallbodies-kuiper-60AU', { sun: true, dist: 60 * AU, yawDeg: 96.38 + 20, pitchDeg: 29.81 - 28 }],
  ['smallbodies-kuiper-top', { sun: true, dist: 120 * AU, yawDeg: 96.38, pitchDeg: 29.81 + 5 }],
  ['smallbodies-ceres', { entry: 'Ceres' }],
  ['satellites-shell', { body: 'Earth', dist: 1.2e5 * PC_PER_KM, pitchDeg: 20 }],
  ['satellites-leo', { body: 'Earth', dist: 2.6e4 * PC_PER_KM, pitchDeg: 35 }],
  ['satellites-iss', { entry: 'ISS' }],
];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--enable-features=WebGPU'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('response', (r) => { if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url()}`); });
await page.goto(`${base}?gputime${cap !== '0' ? `&sbcap=${cap}` : ''}#v=0,0,0,0.00003,96,40`);
await page.waitForFunction(() => window.__atlas?.extras, null, { timeout: 60000 });
console.log('navigator.gpu:', await page.evaluate(async () => { if (!navigator.gpu) return 'absent'; const a = await navigator.gpu.requestAdapter(); return a ? (a.info?.vendor + ' ' + a.info?.architecture) : 'no adapter'; }));
await page.evaluate((t) => { const s = window.__atlas.solar; s.setTime(t); s.pause(true); }, iso);
// all classes loaded (the main belt is 44 MB)
const t0 = Date.now();
await page.waitForFunction(() => {
  const sb = window.__atlas.extras.stats().find((x) => x.id === 'small-bodies');
  return sb && sb.classes && Object.values(sb.classes).every((c) => c.state === 'ready' || c.state === 'error');
}, null, { timeout: 120000, polling: 500 });
console.log(`small bodies loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
for (const [name, v] of VIEWS) {
  await page.evaluate((v) => {
    const a = window.__atlas;
    if (v.entry) a.extras.go(v.entry, v);
    else if (v.body) a.solar.go(v.body, { instant: true, dist: v.dist, pitchDeg: v.pitchDeg });
    else { a.solar.layer.attach(null); a.setView({ focus: [0, 0, 0], dist: v.dist, pitch: (v.pitchDeg * Math.PI) / 180, yaw: (v.yawDeg * Math.PI) / 180 }); }
  }, v);
  if (name.startsWith('satellites')) {
    await page.waitForFunction(() => window.__atlas.extras.stats().find((x) => x.id === 'satellites')?.satellites > 0, null, { timeout: 60000, polling: 300 });
  }
  await page.waitForTimeout(2500);
  const gpu = await page.evaluate(() => window.__atlas.bh.gpuMs(2500));
  await page.evaluate(() => window.__atlas.setContinuous(true));
  await page.waitForTimeout(1500);
  const s = await page.evaluate(() => ({ fps: +window.__atlas.stats().fps.toFixed(1), backend: window.__atlas.stats().backend, extras: window.__atlas.extras.stats() }));
  await page.evaluate(() => window.__atlas.setContinuous(false));
  await page.screenshot({ path: `${outdir}/${name}.png` });
  const sb = s.extras.find((x) => x.id === 'small-bodies');
  const sat = s.extras.find((x) => x.id === 'satellites');
  console.log(name, JSON.stringify({ backend: s.backend, fps: s.fps, gpuMedianMs: gpu.medianMs && +gpu.medianMs.toFixed(2), gpuP90Ms: gpu.p90Ms && +gpu.p90Ms.toFixed(2), gpuSamples: gpu.samples,
    sbDrawn: sb?.drawn, sbVisible: sb?.groupVisible, satVisible: sat?.groupVisible, satellites: sat?.satellites }));
  if (v.entry) console.log('  card:', JSON.stringify(await page.evaluate(() => window.__atlas.extras.info())));
}
// running clock near Earth: SGP4 refresh (1,500 satellites per frame) + GPU Kepler every frame
await page.evaluate(() => window.__atlas.solar.go('Earth', { instant: true, dist: (2.6e4 / 149597870.7) * 4.84813681109536e-6, pitchDeg: 35 }));
for (const speed of [1, 1e4]) {
  await page.evaluate((s) => { const a = window.__atlas.solar; a.setSpeed(s); a.pause(false); window.__atlas.setContinuous(true); }, speed);
  await page.waitForTimeout(2500);
  const r = await page.evaluate(() => ({ fps: +window.__atlas.stats().fps.toFixed(1), now: window.__atlas.solar.now() }));
  const g = await page.evaluate(() => window.__atlas.bh.gpuMs(2000));
  console.log(`clock x${speed} near Earth`, JSON.stringify({ ...r, gpuMedianMs: g.medianMs && +g.medianMs.toFixed(2) }));
}
await page.evaluate((t) => { const a = window.__atlas; a.setContinuous(false); a.solar.setSpeed(1); a.solar.setTime(t); a.solar.pause(true); }, iso);
// CPU pick: on Ceres' screen position in the last asteroid view, and on an empty corner
await page.evaluate(() => { const a = window.__atlas; a.solar.layer.attach(null); a.setView({ focus: [0, 0, 0], dist: 7 * 4.84813681109536e-6, yaw: (96.38 * Math.PI) / 180, pitch: ((29.81 + 12) * Math.PI) / 180 }); });
await page.waitForTimeout(1500);
const ceres = await page.evaluate(() => window.__atlas.extras.screenOf('Ceres'));
console.log('pick at Ceres', JSON.stringify(ceres), JSON.stringify(await page.evaluate((p) => window.__atlas.extras.pick(p.x, p.y), ceres)));
console.log('pick again (cached positions)', JSON.stringify(await page.evaluate((p) => window.__atlas.extras.pick(p.x + 40, p.y + 25), ceres)));
// the same click through the app: the card opens, then the designation arrives from its chunk file
await page.evaluate((p) => window.__atlas.pickAt(p.x + 40, p.y + 25), ceres);
await page.waitForTimeout(1500);
console.log('card of an unnamed pick:', JSON.stringify(await page.evaluate(() => window.__atlas.extras.info())));
await page.screenshot({ path: `${outdir}/smallbodies-picked.png` });
console.log('search:', JSON.stringify(await page.evaluate(() => ['Ceres', 'Apophis', '1P/Halley', 'Halley', 'NEOWISE', 'ISS', 'Tiangong', 'Hubble', 'JWST', 'Eris'].map((q) => [q, window.__atlas.solar.search(q)[0]]))));
console.log('console/http problems:', logs.length ? logs : 'none');
await browser.close();
