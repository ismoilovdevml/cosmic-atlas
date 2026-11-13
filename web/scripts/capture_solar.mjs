// Capture the Solar System layer with an isolated headless Chrome (same GPU flags as
// capture_views.mjs): Earth + Moon, Mars, Jupiter with moons, Saturn, the whole system from 50 AU,
// and Tashkent seen from 3000 km. The simulation clock is paused at one instant so every view
// shows the same configuration. Prints backend, sim time, on-screen body sizes and any
// console/HTTP problems.
// usage (dev server running): node scripts/capture_solar.mjs [outdir=../figures] [baseUrl] [isoTime]
import { chromium } from 'playwright-core';

const [,, outdir = '../figures', base = 'http://localhost:5173/', iso = ''] = process.argv;
const PC_PER_KM = 4.84813681109536e-6 / 149597870.7;
const VIEWS = [
  ['earth', { body: 'Earth' }],
  ['earth-moon', { body: 'Earth', dist: 1.15e6 * PC_PER_KM, yawDeg: 25, pitchDeg: 22 }],
  ['mars', { body: 'Mars' }],
  ['jupiter-moons', { body: 'Jupiter', dist: 4.2e6 * PC_PER_KM, pitchDeg: 18 }],
  ['saturn', { body: 'Saturn', pitchDeg: 22 }],
  // ring crossing the disc: the far half must hide behind the planet (depth test), the near half in front
  ['saturn-rings-edge', { ringTilt: 'saturn', elevDeg: 14, azDeg: 35, dist: 7 * 58232 * PC_PER_KM }],
  // the Moon in front of the Earth, 400,000 km apart: depth order at Earth-Moon distances
  ['moon-earth', { behind: ['moon', 'earth'], dist: 9000 * PC_PER_KM, offDeg: 12.5 }],
  // seen 25 deg off the ecliptic pole (Galactic l = 96.38, b = 29.81)
  ['system-50AU', { sun: true, dist: 50 * 4.84813681109536e-6, yawDeg: 96.38, pitchDeg: 54.8 }],
  ['tashkent', { latlon: [41.31, 69.28, 3000] }],
  // the same spot at local late morning (07:00 UTC = 11:37 local mean time), to check the day side
  ['tashkent-day', { latlon: [41.31, 69.28, 3000], time: '2026-11-13T07:00:00Z' }],
  ['probes-400AU', { sun: true, dist: 400 * 4.84813681109536e-6, yawDeg: 96.38, pitchDeg: 54.8 }],
];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--enable-features=WebGPU'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('response', (r) => { if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url()}`); });
await page.goto(`${base}#v=0,0,0,0.0003,-150,30`);
await page.waitForFunction(() => window.__atlas?.solar, null, { timeout: 30000 });
console.log('navigator.gpu:', await page.evaluate(async () => { if (!navigator.gpu) return 'absent'; const a = await navigator.gpu.requestAdapter(); return a ? (a.info?.vendor + ' ' + a.info?.architecture) : 'no adapter'; }));
await page.evaluate((t) => { const s = window.__atlas.solar; if (t) s.setTime(t); s.pause(true); }, iso);
await page.waitForTimeout(1500);
for (const [name, v] of VIEWS) {
  await page.evaluate((v) => {
    const a = window.__atlas;
    if (v.time) a.solar.setTime(v.time);
    if (v.body) a.solar.go(v.body, { instant: true, dist: v.dist, yawDeg: v.yawDeg, pitchDeg: v.pitchDeg });
    else if (v.latlon) a.solar.lookDown(...v.latlon);
    else if (v.ringTilt) {
      // camera v.elevDeg above the body's equator (ring plane), v.azDeg from the Sun's azimuth
      const L = a.solar.layer;
      const b = L.bodyR(v.ringTilt);
      const e = b.mesh.matrix.elements; // column 1 = geometry +Y = north pole (scaled)
      const pole = [e[4], e[5], e[6]];
      const pn = Math.hypot(...pole);
      for (let k = 0; k < 3; k++) pole[k] /= pn;
      const p = L.positionOf(v.ringTilt);
      const sun = [-p[0], -p[1], -p[2]];
      const sp = sun[0] * pole[0] + sun[1] * pole[1] + sun[2] * pole[2];
      let u = [sun[0] - sp * pole[0], sun[1] - sp * pole[1], sun[2] - sp * pole[2]];
      const un = Math.hypot(...u);
      u = u.map((x) => x / un);
      const w = [pole[1] * u[2] - pole[2] * u[1], pole[2] * u[0] - pole[0] * u[2], pole[0] * u[1] - pole[1] * u[0]];
      const az = (v.azDeg * Math.PI) / 180;
      const el = (v.elevDeg * Math.PI) / 180;
      const d = [0, 1, 2].map((k) => Math.cos(el) * (Math.cos(az) * u[k] + Math.sin(az) * w[k]) + Math.sin(el) * pole[k]);
      L.attach(null);
      a.setView({ focus: [...p], dist: v.dist, yaw: Math.atan2(d[1], d[0]), pitch: Math.asin(d[2]) });
      L.attach(v.ringTilt);
    }
    else if (v.behind) {
      // camera on the far side of body 0 from body 1, looking back at both (body 1 slightly off-axis)
      const L = a.solar.layer;
      const p = L.positionOf(v.behind[0]);
      const q = L.positionOf(v.behind[1]);
      const d = [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
      const n = Math.hypot(...d);
      L.attach(null);
      a.setView({ focus: [...p], dist: v.dist, yaw: Math.atan2(d[1] / n, d[0] / n) + (v.offDeg * Math.PI) / 180, pitch: Math.asin(d[2] / n) });
      L.attach(v.behind[0]);
    }
    else { a.solar.layer.attach(null); a.setView({ focus: [0, 0, 0], dist: v.dist, pitch: (v.pitchDeg * Math.PI) / 180, yaw: (v.yawDeg * Math.PI) / 180 }); }
  }, v);
  await page.waitForTimeout(3500); // textures (and Earth's 4096 px map) load
  await page.evaluate(() => window.__atlas.setContinuous(true));
  await page.waitForTimeout(800);
  const s = await page.evaluate(() => {
    const a = window.__atlas;
    const sc = a.solar.screen();
    const big = Object.fromEntries(Object.entries(sc).filter(([, x]) => x && x.rpx > 1).map(([k, x]) => [k, { x: Math.round(x.x), y: Math.round(x.y), rpx: +x.rpx.toFixed(1) }]));
    return { backend: a.stats().backend, fps: +a.stats().fps.toFixed(1), time: a.solar.now(), dist: a.stats().view.dist, onScreen: big };
  });
  await page.evaluate(() => window.__atlas.setContinuous(false));
  await page.screenshot({ path: `${outdir}/solar-${name}.png` });
  console.log(name, JSON.stringify(s));
}
console.log('search:', JSON.stringify(await page.evaluate(() => ['Марс', 'Yer', 'Земля', 'Oy', 'Луна', 'Yupiter', 'Вояджер'].map((q) => [q, window.__atlas.solar.search(q)[0]]))));
console.log('console/http problems:', logs.length ? logs : 'none');
await browser.close();
