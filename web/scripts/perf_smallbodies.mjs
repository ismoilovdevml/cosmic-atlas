// GPU time per frame of the asteroid layer at several caps (brightest N per orbit class), in the
// inner-Solar-System and Kuiper-belt views, with headless Chrome + WebGPU timestamp queries.
// usage (dev server running): node scripts/perf_smallbodies.mjs [baseUrl] [caps=0,600000,300000,100000,-1]
//   cap 0 = all objects, -1 = layer off
import { chromium } from 'playwright-core';

const [,, base = 'http://localhost:5173/', capsArg = '0,600000,300000,100000,-1'] = process.argv;
const AU = 4.84813681109536e-6;
const VIEWS = {
  inner: { dist: 7 * AU, yawDeg: 96.38, pitchDeg: 41.81 },
  kuiper: { dist: 120 * AU, yawDeg: 96.38, pitchDeg: 34.81 },
  far50: { dist: 50 * AU, yawDeg: 96.38, pitchDeg: 54.8 },
  far400: { dist: 400 * AU, yawDeg: 96.38, pitchDeg: 54.8 },
  far2000: { dist: 2000 * AU, yawDeg: 96.38, pitchDeg: 54.8 },
};
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--enable-features=WebGPU'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.goto(`${base}?gputime#v=0,0,0,0.00003,96,40`);
await page.waitForFunction(() => window.__atlas?.extras, null, { timeout: 60000 });
await page.evaluate(() => { const s = window.__atlas.solar; s.setTime('2026-11-14T06:00:00Z'); s.pause(true); });
await page.waitForFunction(() => {
  const sb = window.__atlas.extras.stats().find((x) => x.id === 'small-bodies');
  return sb?.classes && Object.values(sb.classes).every((c) => c.state === 'ready');
}, null, { timeout: 120000, polling: 500 });
for (const [vname, v] of Object.entries(VIEWS)) {
  await page.evaluate((v) => window.__atlas.setView({ focus: [0, 0, 0], dist: v.dist, yaw: (v.yawDeg * Math.PI) / 180, pitch: (v.pitchDeg * Math.PI) / 180 }), v);
  for (const cap of capsArg.split(',').map(Number)) {
    await page.evaluate((cap) => {
      const a = window.__atlas;
      a.setLayer('small-bodies', cap >= 0);
      a.extras.setCap(cap > 0 ? cap : 0);
    }, cap);
    await page.waitForTimeout(800);
    const g = await page.evaluate(() => window.__atlas.bh.gpuMs(3000));
    const drawn = await page.evaluate(() => window.__atlas.extras.stats().find((x) => x.id === 'small-bodies').drawn);
    console.log(JSON.stringify({ view: vname, cap: cap < 0 ? 'layer off' : cap === 0 ? 'all' : cap, drawn: cap < 0 ? 0 : drawn, gpuMedianMs: +g.medianMs.toFixed(2), gpuP90Ms: +g.p90Ms.toFixed(2), samples: g.samples }));
  }
}
await browser.close();
