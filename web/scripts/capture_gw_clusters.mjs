// Headless captures of the star clusters (500 pc around the Sun) and the gravitational-wave
// localisation volumes (500 Mpc), plus one info card of each, with an isolated headless Chrome.
// usage (dev server running): node scripts/capture_gw_clusters.mjs [outdir=../figures] [baseUrl=http://localhost:5173/] [lang=en]
import { chromium } from 'playwright-core';

const [,, outdir = '../figures', base = 'http://localhost:5173/', lang = 'en'] = process.argv;
// synthetic dev stars would hide the cluster layer in a worktree without Gaia tiles
const L = 'l=~synthetic-stars,~stars-gaia,~gaia-sky';
const VIEWS = [
  ['clusters-500pc', `#v=0,0,0,500,-150,32&${L}`, null],
  ['clusters-500pc-card', `#v=0,0,0,500,-150,32&${L}`, 'M45'],
  ['gw-500mpc', `#v=0,0,0,5e8,-150,28&l=~galaxies-desi,~galaxies-2mrs,~synthetic-galaxies`, null],
  // A/B: the same view with the volumes switched off
  ['gw-500mpc-off', `#v=0,0,0,5e8,-150,28&l=~galaxies-desi,~galaxies-2mrs,~synthetic-galaxies,~gw-volumes`, null],
  ['gw-500mpc-card', `#v=0,0,0,5e8,-150,28&l=~galaxies-desi,~galaxies-2mrs,~synthetic-galaxies`, 'GW190814'],
  ['gw-500mpc-galaxies', `#v=0,0,0,5e8,-150,28`, 'GW170817'],
  ['gw-4gpc', `#v=0,0,0,4e9,-150,28&l=~galaxies-desi,~galaxies-2mrs,~synthetic-galaxies`, null],
];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--enable-features=WebGPU'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('response', (r) => { if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url()}`); });
for (const [name, hash, card] of VIEWS) {
  await page.goto('about:blank'); // a fresh app per view (a hash change alone keeps the open card)
  await page.goto(`${base}?lang=${lang}${hash}`);
  await page.waitForFunction(() => window.__atlas && window.__atlas.stats, null, { timeout: 30000 });
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(500);
    const s = await page.evaluate(() => window.__atlas.stats());
    if (i > 5 && s.inFlight === 0 && s.queued === 0) break;
  }
  let info = null;
  if (card) {
    // open the catalogue card without moving the camera: click the entry's label if it is on screen,
    // else go through the search box (Enter flies there; the view is restored afterwards)
    info = await page.evaluate((n) => {
      const el = [...document.querySelectorAll('#labels .label')].find((b) => b.textContent === n && b.style.visibility === 'visible');
      if (el) { el.click(); return 'label'; }
      return null;
    }, card);
    if (!info) {
      await page.fill('#search', card);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(6000);
      info = 'search';
    }
    await page.waitForTimeout(1200);
  }
  await page.evaluate(() => window.__atlas.setContinuous(true));
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__atlas.setContinuous(false));
  await page.screenshot({ path: `${outdir}/${name}.png` });
  const s = await page.evaluate(() => {
    const st = window.__atlas.stats();
    const labels = [...document.querySelectorAll('#labels .label')].filter((b) => b.style.visibility === 'visible' && +b.style.opacity > 0.5).map((b) => b.textContent);
    const rows = [...document.querySelectorAll('#info-rows dt')].map((dt) => `${dt.textContent}: ${dt.nextElementSibling?.textContent}`);
    return { backend: st.backend, drawnPoints: st.drawnPoints, dist: st.view.dist, labels, card: document.getElementById('info').hidden ? null : { title: document.getElementById('info-title').textContent, rows, note: document.getElementById('info-note').textContent } };
  });
  console.log(name, info ?? '', JSON.stringify(s));
}
console.log('console/http problems:', logs.length ? [...new Set(logs)] : 'none');
await browser.close();
