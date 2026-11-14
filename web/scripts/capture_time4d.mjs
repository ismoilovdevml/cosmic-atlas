// 4D time slider: capture the Sun's neighbourhood at -1 Myr, now and +1 Myr with an isolated
// headless Chrome (WebGPU), and check that a GPU pick at a moved star's CPU-predicted screen
// position returns that star (shader and CPU twin agree).
// usage (dev server running): node scripts/capture_time4d.mjs [outdir=../figures] [baseUrl] [view] [prefix=time4d]
//   sky view from the Sun toward RA 60, Dec +55: view "v=0,0,0,0.02,-32.2,-1.5", prefix time4d-sky
import { chromium } from 'playwright-core';

const [,, outdir = '../figures', base = 'http://localhost:5173/', view = 'v=0,0,0,90,-120,24', prefix = 'time4d'] = process.argv;
// the Gaia all-sky image would sit behind the stars; the preview layer is the real data
const common = `${view}&l=stars-gaia-preview,~gaia-sky`;
const SHOTS = [['minus1Myr', -1], ['now', 0], ['plus1Myr', 1]];

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--enable-features=WebGPU'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('response', (r) => { if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url()}`); });
const velRequests = [];
page.on('request', (r) => { if (r.url().endsWith('.vel.bin')) velRequests.push(r.url().split('/').slice(-1)[0]); });

await page.goto(`${base}?lang=en#${common}`);
await page.waitForFunction(() => window.__atlas?.stats, null, { timeout: 30000 });
const settle = async () => {
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(400);
    const s = await page.evaluate(() => window.__atlas.stats());
    if (i > 4 && s.inFlight === 0 && s.queued === 0 && !s.fading) return s;
  }
  return page.evaluate(() => window.__atlas.stats());
};
let s = await settle();
const layer = s.layers.find((l) => l.id === 'stars-gaia-preview');
console.log('backend', s.backend, 'layer', JSON.stringify(layer));
console.log('.vel.bin requests at epoch 0:', velRequests.length);
for (const [name, myr] of SHOTS) {
  await page.evaluate((m) => window.__atlas.setEpoch(m), myr);
  s = await settle();
  await page.evaluate(() => window.__atlas.setContinuous(true));
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__atlas.setContinuous(false));
  await page.screenshot({ path: `${outdir}/${prefix}-${name}.png` });
  const ui = await page.evaluate(() => ({
    epoch: document.querySelector('.t-epoch')?.textContent, slider: document.querySelector('.t-epoch-range')?.value,
    note: document.querySelector('.t-note')?.textContent?.slice(0, 80), hash: location.hash,
  }));
  console.log(name, JSON.stringify({ epoch: await page.evaluate(() => window.__atlas.epoch()), drawnPoints: s.drawnPoints, drawnNodes: s.drawnNodes,
    movingNodes: s.movingNodes, blobs: s.blobs, light: s.light, pending: s.pending, velRequests: velRequests.length, ui }));
  if (myr !== 0) {
    const probe = await page.evaluate(() => window.__atlas.movedProbe('stars-gaia-preview'));
    if (probe) {
      await page.evaluate(([x, y]) => window.__atlas.pickAt(x, y), [probe.x, probe.y]);
      await page.waitForTimeout(300);
      const sel = (await page.evaluate(() => window.__atlas.stats())).selection;
      const rows = await page.evaluate(() => [...document.querySelectorAll('#info-rows dt')].map((dt) => `${dt.textContent}: ${dt.nextElementSibling?.textContent}`));
      console.log(`  pick at CPU-moved position of Gaia DR3 ${probe.id} (${probe.x.toFixed(1)}, ${probe.y.toFixed(1)}) ->`, sel?.title, sel?.title?.endsWith(probe.id) ? 'MATCH' : 'MISMATCH');
      console.log('  info card:', JSON.stringify(rows.slice(0, 8)));
      await page.screenshot({ path: `${outdir}/${prefix}-${name}-picked.png` });
      await page.keyboard.press('Escape');
      await page.evaluate(() => document.getElementById('info-close')?.click());
    } else console.log('  no probe star on screen');
  }
}
console.log('console/http problems:', logs.length ? logs : 'none');
await browser.close();
