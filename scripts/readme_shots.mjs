// Capture the README screenshots from a running dev server (cd web && npm run dev).
//   node scripts/readme_shots.mjs [--raw] [name ...]
// --raw writes full-window PNGs to $OUT (default /tmp/cosmic-atlas-shots) to choose crops;
// without it each shot is cropped and written to docs/images/<name>.jpg.
// Shots are deep links (#layer=, #at=) or debug-API calls, so they stay reproducible after changes.
import { chromium } from '../web/node_modules/playwright-core/index.mjs';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.ATLAS_URL ?? 'http://127.0.0.1:5173/?lang=en';
const OUT = process.env.OUT ?? '/tmp/cosmic-atlas-shots';
const args = process.argv.slice(2);
const raw = args.includes('--raw');
const only = args.filter((a) => !a.startsWith('--'));

// crop: [x, y, w, h] in the 1440x900 window; wait: ms after the view is set
const SHOTS = [
  { name: 'asteroids', hash: '#layer=small-bodies&l=~neutrinos', wait: 14000, crop: [290, 40, 860, 820] },
  { name: 'satellites', hash: '#layer=satellites&l=~neutrinos', wait: 14000, crop: [290, 40, 860, 820] },
  { name: 'dust', hash: '#v=0,0,0,2600,20,32&l=~neutrinos', wait: 22000, crop: [290, 40, 860, 820] },
  { name: 'star-clusters', hash: '#layer=star-clusters&l=~neutrinos', wait: 16000, crop: [290, 40, 860, 820] },
  { name: 'cmb', hash: '#layer=cmb', wait: 20000, crop: [290, 40, 860, 820] },
  { name: 'mars-gale', eval: () => window.__atlas.solar.surface.lookDown('mars', -5.4, 137.8, 400), wait: 20000, crop: [290, 40, 860, 820] },
  { name: 'moon-tycho', eval: () => { window.__atlas.solar.setTime('2026-11-24T12:00:00Z'); window.__atlas.solar.pause(true); window.__atlas.solar.surface.lookDown('moon', -43.31, -11.36, 300); }, wait: 15000, crop: [290, 40, 860, 820] },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--enable-features=WebGPU'],
});
for (const s of SHOTS.filter((s) => !only.length || only.includes(s.name))) {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + (s.hash ?? ''));
  await page.waitForFunction(() => window.__atlas?.solar?.surface, null, { timeout: 90000 });
  // keep only the scene and its labels: panels, overlays and the time bar are not part of a README picture
  await page.addStyleTag({ content: 'body > *:not(#view):not(#labels) { visibility: hidden !important; }' });
  if (s.eval) await page.evaluate(s.eval);
  await page.waitForTimeout(s.wait);
  const png = join(OUT, `${s.name}.png`);
  await page.screenshot({ path: png });
  if (!raw) {
    const [x, y, w, h] = s.crop;
    const jpg = join(ROOT, 'docs/images', `${s.name}.jpg`);
    execFileSync('sips', ['-c', String(h), String(w), '--cropOffset', String(y), String(x), png, '--out', png]);
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '82', png, '--out', jpg]);
    console.log(`${s.name}: ${jpg}`);
  } else console.log(`${s.name}: ${png}`);
  if (errors.length) console.log(`  page errors: ${errors.slice(0, 3).join(' | ')}`);
  await page.close();
}
await browser.close();
