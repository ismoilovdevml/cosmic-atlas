// Headless check of the "Show me" flight with a fake location (Tashkent).
// usage: node scripts/capture_showme.mjs <outdir> [url]
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? '.';
const url = process.argv[3] ?? 'http://127.0.0.1:5173/?lang=uz';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--enable-features=WebGPU'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, geolocation: { latitude: 41.3111, longitude: 69.2797 }, permissions: ['geolocation'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(url);
await page.waitForFunction(() => window.__atlas && window.__atlas.stats().layers.length > 0, null, { timeout: 60000 });
await page.waitForTimeout(3000);
await page.click('#showme');
const shots = { web: 6000, mw: 22000, earth: 42000, here: 58000 };
let t0 = Date.now();
for (const [name, at] of Object.entries(shots)) {
  await page.waitForTimeout(Math.max(0, at - (Date.now() - t0)));
  const cap = await page.evaluate(() => document.getElementById('caption')?.innerText ?? '');
  await page.screenshot({ path: `${out}/showme-${name}.png` });
  console.log(name, JSON.stringify(cap.replace(/\n/g, ' | ')));
}
await page.waitForTimeout(12000);
const s = await page.evaluate(() => window.__atlas.stats());
console.log('final view dist pc', s.view.dist, 'km', s.view.dist * 3.0857e13, 'url', await page.evaluate(() => location.hash));
console.log('errors', errors.filter((e) => !/hips2fits|404/.test(e)).slice(0, 5));
await page.screenshot({ path: `${out}/showme-final.png` });
await browser.close();
