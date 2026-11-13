// Fly to nearby galaxies (camera between the Sun and the galaxy, D25 filling ~60 % of the height),
// wait for the LOD to settle and the thumbnail to load or fail, and save figures/galaxy-<name>.png.
// Also prints, per galaxy, the LOD weights, where the thumbnail came from, and the screen
// direction of celestial North and East at the galaxy (for comparing with a sky cutout).
// usage (dev server running): node scripts/capture_galaxies.mjs [outdir=../figures] [query] [baseUrl] [names...]
import { chromium } from 'playwright-core';

const [,, outdir = '../figures', query = '', base = 'http://localhost:5173/', ...rest] = process.argv;
const NAMES = rest.length ? rest : ['M31', 'M33', 'M81', 'NGC 253'];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--enable-features=WebGPU'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning' || m.text().includes('[galaxy')) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[requestfailed] ${r.url().slice(0, 120)} ${r.failure()?.errorText}`));
page.on('response', (r) => { if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url().slice(0, 140)}`); });
await page.goto(`${base}${query}#v=0,0,0,1e6,-150,20`);
await page.waitForFunction(() => window.__atlas && window.__atlas.galaxyView, null, { timeout: 30000 });
await page.waitForTimeout(1500);
// the Gaia all-sky image is ~0.1 deg/px: hide it in the narrow Earth-view fields, where it shows as blocks
if (process.env.EARTH) await page.evaluate(() => window.__atlas.setSky(false));
for (const name of NAMES) {
  // EARTH=1: camera at the Sun with a narrow field (the view from Earth, for comparing with sky images)
  const v = await page.evaluate(([n, e]) => window.__atlas.galaxyView(n, 0.6, e), [name, !!process.env.EARTH]);
  if (!v) { console.log(name, 'no view (not in catalogue or no shape)'); continue; }
  await page.evaluate((fov) => window.__atlas.setFov(fov), v.fovDeg && process.env.EARTH ? v.fovDeg : 55);
  await page.evaluate((view) => window.__atlas.setView(view), v);
  let sh = [];
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(500);
    sh = await page.evaluate(() => window.__atlas.shapes());
    const s = await page.evaluate(() => window.__atlas.stats());
    const top = sh[0];
    if (i > 4 && s.inFlight === 0 && s.queued === 0 && top && (top.thumbState === 'ready' || top.thumbState === 'failed') && (top.thumbState === 'failed' || top.thumb > 0.999)) break;
  }
  await page.evaluate((n) => window.__atlas.showEntry(n), name);
  await page.waitForTimeout(600);
  const compass = await page.evaluate((n) => {
    const c = window.__atlas.skyPoint(n, 0, 0);
    const N = window.__atlas.skyPoint(n, 1, 0);
    const E = window.__atlas.skyPoint(n, 0, 1);
    const ang = (p) => (Math.atan2(-(p.x - c.x), -(p.y - c.y)) * 180) / Math.PI; // screen angle from up, counter-clockwise (toward left)
    return { centre: c, northDeg: ang(N), eastDeg: ang(E) };
  }, name);
  const slug = name.toLowerCase().replace(/\s+/g, '') + (process.env.EARTH ? '-earthview' : '');
  await page.screenshot({ path: `${outdir}/galaxy-${slug}.png` });
  const card = await page.evaluate(() => [...document.querySelectorAll('#info-rows dt')].map((d) => `${d.textContent}: ${d.nextElementSibling?.textContent}`).join(' | ') + ' || ' + document.getElementById('info-note')?.textContent);
  console.log(name, JSON.stringify({ view: { dist: +v.dist.toPrecision(4) }, top: sh.slice(0, 3), compass }));
  console.log('  card:', card);
}
// extra views of the first galaxy: the LOD ladder (D25 at 6 / 11 / 30 / 120 px) and an oblique view
if (process.env.CAPTURE_EXTRA) {
  const name = NAMES[0];
  const slug = name.toLowerCase().replace(/\s+/g, '');
  await page.evaluate(() => document.getElementById('info-close')?.click());
  for (const px of [6, 11, 30, 120]) {
    const v = await page.evaluate(([n, f]) => window.__atlas.galaxyView(n, f), [name, px / 900]);
    await page.evaluate((view) => window.__atlas.setView(view), v);
    await page.waitForTimeout(6000);
    const sh = await page.evaluate(() => window.__atlas.shapes());
    await page.screenshot({ path: `${outdir}/galaxy-${slug}-lod${px}px.png` });
    console.log(`${name} lod ${px}px`, JSON.stringify(sh.find((x) => x.name === name) ?? null));
  }
  const v = await page.evaluate((n) => window.__atlas.galaxyView(n, 0.45), name);
  for (const [tag, dyaw, dpitch] of [['oblique', 55, 25]]) {
    await page.evaluate(([view, dy, dp]) => window.__atlas.setView({ ...view, yaw: view.yaw + (dy * Math.PI) / 180, pitch: view.pitch + (dp * Math.PI) / 180 }), [v, dyaw, dpitch]);
    await page.waitForTimeout(5000);
    await page.screenshot({ path: `${outdir}/galaxy-${slug}-${tag}.png` });
    console.log(`${name} ${tag}`, JSON.stringify((await page.evaluate(() => window.__atlas.shapes()))[0]));
  }
}
console.log('console/http problems:', logs.length ? logs : 'none');
await browser.close();
