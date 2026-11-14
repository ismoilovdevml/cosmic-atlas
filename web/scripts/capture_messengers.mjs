// Capture the multi-messenger layers (src/messengers) with an isolated headless Chrome, same GPU
// flags as capture_views.mjs, and print what each view shows (backend, CMB state, marker counts,
// on-screen positions of the named sources) plus any console or HTTP errors.
// usage (dev server running): node scripts/capture_messengers.mjs [outdir=../figures] [baseUrl]
import { chromium } from 'playwright-core';

const [,, outdir = '../figures', base = 'http://localhost:5173/'] = process.argv;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--enable-features=WebGPU'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('response', (r) => { if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url()}`); });

await page.goto(`${base}?lang=en#v=0,0,0,1,-150,18`);
await page.waitForFunction(() => window.__atlas?.messengers, null, { timeout: 60000 });
// the sky tables load after the catalogues
await page.waitForFunction(() => Object.values(window.__atlas.messengers.state().layers).every((l) => l.status !== 'pending'), null, { timeout: 60000 });
const settle = async (ms = 1500) => {
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(400);
    const s = await page.evaluate(() => window.__atlas.stats());
    if (i > 2 && s.inFlight === 0 && s.queued === 0) break;
  }
  await page.evaluate(() => window.__atlas.setContinuous(true));
  await page.waitForTimeout(ms);
  await page.evaluate(() => window.__atlas.setContinuous(false));
};
const shot = async (name, info = {}) => {
  await page.screenshot({ path: `${outdir}/${name}.png` });
  const s = await page.evaluate(() => ({ backend: window.__atlas.stats().backend, m: window.__atlas.messengers.state(), view: window.__atlas.stats().view }));
  console.log(name, JSON.stringify({ backend: s.backend, dist: s.view.dist, cmb: s.m.cmb, background: s.m.background, layers: s.m.layers, ...info }));
};
// instant camera moves (a #v= hash change would start an animated flight)
const view = (dist, yawDeg, pitchDeg) => page.evaluate(([d, y, p]) => window.__atlas.setView({ focus: [0, 0, 0], dist: d, yaw: (y * Math.PI) / 180, pitch: (p * Math.PI) / 180 }), [dist, yawDeg, pitchDeg]);
const closeInfo = () => page.evaluate(() => { const b = document.querySelector('#info .close, #info-close'); if (b) b.click(); });

// 1. CMB shell from 30 Gpc (the zoom limit), and from just inside it (13 Gpc)
await view(3e10, -150, 20);
await page.evaluate(() => window.__atlas.messengers.loadCmb());
await settle(2500);
await shot('cmb-shell-30Gpc');
await page.evaluate(() => window.__atlas.showEntry('CMB'));
await settle(800);
await shot('cmb-infocard-30Gpc');
await closeInfo();
await view(1.3e10, -150, 10);
await settle(1500);
await shot('cmb-inside-13Gpc');

// 2. X-ray sky: eROSITA background from the Sun, toward Vela (western Galactic half) and the Galactic centre
await page.evaluate(() => window.__atlas.setLayer('frb', false));
await page.evaluate(() => window.__atlas.setLayer('neutrinos', false));
await page.evaluate(() => window.__atlas.messengers.setBackground('erosita'));
await page.evaluate(() => window.__atlas.messengers.lookAt(128.5, -45.8, 100));
await settle(1500);
await shot('xray-erosita-vela', { target: 'Vela SNR RA 128.5 Dec -45.8, fov 100' });
await page.evaluate(() => window.__atlas.messengers.lookAt(266.4, -29.0, 100));
await settle(1500);
await shot('xray-erosita-galactic-centre', { target: 'Sgr A* RA 266.4 Dec -29.0, fov 100 (eastern half has no eROSITA-DE data)' });
await page.evaluate(() => window.__atlas.messengers.setBackground('planck857'));
await settle(1500);
await shot('xray-planck857-galactic-centre');
await page.evaluate(() => window.__atlas.messengers.setBackground('gaia'));
await page.evaluate(() => window.__atlas.setFov(55));

// 3. FRB hosts in 3D (4 Gpc and 1.5 Gpc; then with the galaxy layers off), then FRB sky directions from the Sun
const GALAXY_LAYERS = ['galaxies-desi', 'galaxies-2mrs', 'local-volume', 'local-group'];
const galaxies = (on) => page.evaluate(([ids, v]) => ids.forEach((id) => window.__atlas.setLayer(id, v)), [GALAXY_LAYERS, on]);
await page.evaluate(() => window.__atlas.setLayer('frb', true));
await view(4e9, -150, 25);
await settle(1500);
await shot('frb-hosts-3d-4Gpc', { r1: await page.evaluate(() => window.__atlas.messengers.screenOf('FRB 20121102A')) });
await view(1.5e9, -120, 35);
await settle(1500);
await shot('frb-hosts-3d-1.5Gpc');
await galaxies(false);
await settle(1000);
await shot('frb-hosts-3d-1.5Gpc-hosts-only');
await galaxies(true);
await page.evaluate(() => window.__atlas.messengers.lookAt(30, 60, 90));
await settle(1500);
await shot('frb-sky-directions', { target: 'RA 30 Dec 60 (CHIME sky), fov 90', r3: await page.evaluate(() => window.__atlas.messengers.screenOf('FRB 20180916B')) });
await page.evaluate(() => window.__atlas.setLayer('frb', false));

// 4. Neutrinos: IceCat-1 90 % regions around TXS 0506+056 and KM3-230213A from the Sun; the two sources in 3D
await page.evaluate(() => window.__atlas.setLayer('neutrinos', true));
await page.evaluate(() => window.__atlas.messengers.lookAt(77.36, 5.69, 40));
await settle(1500);
const txs = await page.evaluate(() => window.__atlas.messengers.screenOf('TXS 0506+056'));
const ic = await page.evaluate(() => window.__atlas.messengers.screenOf('IC170922A'));
await shot('neutrino-regions-txs0506', { txs, ic170922a: ic });
// a click there picks the 3D source drawn on top (TXS 0506+056); the alert's own card via search
if (txs) {
  await page.evaluate(([x, y]) => window.__atlas.pickAt(x, y), [txs.x, txs.y]);
  await settle(600);
  await shot('neutrino-infocard-txs0506-picked', { picked: await page.evaluate(() => window.__atlas.stats().selection?.title) });
  await closeInfo();
}
await page.evaluate(() => window.__atlas.showEntry('IC170922A'));
await settle(600);
await shot('neutrino-infocard-ic170922a', { shown: await page.evaluate(() => window.__atlas.stats().selection?.title) });
await closeInfo();
await page.evaluate(() => window.__atlas.messengers.lookAt(94.3, -7.8, 30));
await settle(1500);
await shot('neutrino-regions-km3', { km3: await page.evaluate(() => window.__atlas.messengers.screenOf('KM3-230213A')) });
await page.evaluate(() => window.__atlas.setFov(55));
await galaxies(false);
await page.evaluate(() => window.__atlas.setLayer('frb', true));
const txsXyz = await page.evaluate(() => window.__atlas.messengers.entryXyz('TXS 0506+056'));
await page.evaluate((f) => window.__atlas.setView({ focus: f, dist: 1.6e9, yaw: -2.6, pitch: 0.45 }), txsXyz);
await settle(1500);
await shot('neutrino-sources-3d-txs0506', { txs: await page.evaluate(() => window.__atlas.messengers.screenOf('TXS 0506+056')) });
await galaxies(true);
await page.evaluate(() => window.__atlas.setLayer('frb', false));
const ngc = await page.evaluate(() => window.__atlas.messengers.entryXyz('NGC 1068 (IceCube source)'));
await page.evaluate((f) => window.__atlas.setView({ focus: f, dist: 3e6, yaw: -2.2, pitch: 0.4 }), ngc);
await settle(1500);
await shot('neutrino-sources-3d-ngc1068', { ngc1068: await page.evaluate(() => window.__atlas.messengers.screenOf('NGC 1068 (IceCube source)')) });

console.log('console/http problems:', logs.length ? logs : 'none');
await browser.close();
