// Before/after chart of two perf_firstpaint.mjs --json runs (medians per network profile), drawn as
// SVG and rendered to PNG with headless Chrome (no Python plotting stack needed).
// usage: node scripts/plot_perf.mjs before.json after.json ../figures/perf-firstpaint.png
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const [,, beforePath, afterPath, png = '../figures/perf-firstpaint.png'] = process.argv;
const METRICS = [['firstFrameMs', 'first frame'], ['layersListedMs', 'layers listed'], ['layersReadyMs', 'all layer metas in'],
  ['skyLowMs', 'first sky image'], ['catalogsMs', 'catalogues in'], ['skyMs', 'full sky image']];
const TITLES = { fast: 'local, no throttling', '1mbps': '1 MB/s, 100 ms RTT', '0.3mbps': '0.3 MB/s, 100 ms RTT' };
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor((s.length - 1) / 2)]; };
function medians(path) {
  const d = JSON.parse(readFileSync(path, 'utf8'));
  const by = {};
  for (const r of d.results) (by[r.profile] ??= []).push(r);
  return Object.fromEntries(Object.entries(by).map(([p, rs]) => [p, Object.fromEntries(METRICS.map(([k]) => [k, median(rs.map((r) => r[k]))]))]));
}
const b = medians(beforePath);
const a = medians(afterPath);
const profiles = ['fast', '1mbps', '0.3mbps'].filter((p) => b[p] && a[p]);
const PW = 430, PH = 300, L = 120, T = 40;
let svg = '';
profiles.forEach((p, pi) => {
  const x0 = pi * PW;
  const max = Math.max(...METRICS.flatMap(([k]) => [b[p][k], a[p][k]])) / 1000 * 1.25;
  const sx = (v) => x0 + L + (v / max) * (PW - L - 20);
  svg += `<text x="${x0 + L}" y="22" class="t">${TITLES[p]}</text>`;
  METRICS.forEach(([k, label], i) => {
    const y = T + i * 40;
    const bv = b[p][k] / 1000, av = a[p][k] / 1000;
    svg += `<text x="${x0 + L - 8}" y="${y + 17}" class="l" text-anchor="end">${label}</text>`;
    svg += `<rect x="${x0 + L}" y="${y}" width="${sx(bv) - x0 - L}" height="14" class="b"/><text x="${sx(bv) + 4}" y="${y + 11}" class="v">${bv.toFixed(2)} s</text>`;
    svg += `<rect x="${x0 + L}" y="${y + 16}" width="${sx(av) - x0 - L}" height="14" class="a"/><text x="${sx(av) + 4}" y="${y + 27}" class="v va">${av.toFixed(2)} s</text>`;
  });
  svg += `<line x1="${x0 + L}" x2="${x0 + L}" y1="${T - 4}" y2="${T + METRICS.length * 40}" stroke="#888"/>`;
});
const W = profiles.length * PW;
const html = `<html><body style="margin:0;background:#fff"><svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${PH + 40}" font-family="Helvetica, Arial, sans-serif">
<style>.t{font-size:13px;font-weight:600;fill:#222}.l{font-size:11px;fill:#333}.v{font-size:10px;fill:#666}.va{fill:#7a5c22}.b{fill:#a7aebb}.a{fill:#c9a66b}</style>
${svg}
<rect x="${L}" y="${PH + 8}" width="12" height="12" class="b"/><text x="${L + 18}" y="${PH + 18}" class="l">before</text>
<rect x="${L + 80}" y="${PH + 8}" width="12" height="12" class="a"/><text x="${L + 98}" y="${PH + 18}" class="l">after</text>
<text x="${L + 170}" y="${PH + 18}" class="l">median seconds after navigation; production build, headless Chrome (WebGPU), 1440x900, default view</text>
</svg></body></html>`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: W, height: PH + 40 }, deviceScaleFactor: 2 });
await page.setContent(html);
await page.screenshot({ path: png });
await browser.close();
console.log('wrote', png);
