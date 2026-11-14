// GPU time of the dust pass at 1440x900, DPR 1 (timestamp queries, ?gputime).
// Off and on are measured alternately, `rounds` times, because other GPU work on the machine shifts
// single runs by a millisecond or more; the report is the median over rounds of each frame median.
// usage (dev server up): node scripts/perf_dust.mjs [baseUrl] [qualities=low,medium,high] [views=300pc] [rounds=3]
//   a quality may be "steps:N@scale" to override the march, e.g. "0@0.5" for the fixed overhead only.
import { chromium } from 'playwright-core';

const [,, base = 'http://localhost:5173/', qArg = 'low,medium,high', viewArg = '300pc', roundsArg = '3'] = process.argv;
const VIEWS = {
  '300pc': { focus: [0, 0, 0], dist: 300, yaw: -150, pitch: 22 },
  '1kpc': { focus: [0, 0, 0], dist: 1000, yaw: -150, pitch: 35 },
  '3kpc': { focus: [0, 0, 0], dist: 3000, yaw: -120, pitch: 40 },
  'taurus-inside': { focus: [-136, 25, -40], dist: 110, yaw: -100.4, pitch: 10 },
  'sun-null': { focus: [-30, 0, 0], dist: 30, yaw: 0, pitch: 0 },
};
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--enable-features=WebGPU'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.goto(`${base}${base.includes('?') ? '&' : '?'}gputime`);
await page.waitForFunction(() => window.__atlas?.dust?.state().status === 'ready', null, { timeout: 60000, polling: 250 });
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
for (const view of viewArg.split(',')) {
  const v = VIEWS[view];
  await page.evaluate((v) => window.__atlas.setView({ focus: v.focus, dist: v.dist, yaw: (v.yaw * Math.PI) / 180, pitch: (v.pitch * Math.PI) / 180 }), v);
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(400);
    const s = await page.evaluate(() => window.__atlas.stats());
    if (i > 4 && s.inFlight === 0 && s.queued === 0) break;
  }
  for (const q of qArg.split(',')) {
    const off = [];
    const on = [];
    for (let r = 0; r < +roundsArg; r++) {
      await page.evaluate(() => window.__atlas.setLayer('dust', false));
      off.push((await page.evaluate(() => window.__atlas.bh.gpuMs(1500))).medianMs);
      await page.evaluate((q) => {
        const a = window.__atlas;
        a.setLayer('dust', true);
        if (q.includes('@')) {
          const [n, s] = q.split('@');
          a.dust.setQuality(+s >= 0.5 ? 'medium' : 'low');
          a.dust.setSteps(+n);
        } else a.dust.setQuality(q);
      }, q);
      await page.waitForTimeout(300);
      on.push((await page.evaluate(() => window.__atlas.bh.gpuMs(1500))).medianMs);
    }
    const mo = med(off);
    const mn = med(on);
    console.log(`${view} ${q}: off ${mo.toFixed(2)} ms, on ${mn.toFixed(2)} ms, dust ${(mn - mo).toFixed(2)} ms  [off ${off.map((x) => x.toFixed(2)).join(' ')} | on ${on.map((x) => x.toFixed(2)).join(' ')}]`);
  }
}
await browser.close();
