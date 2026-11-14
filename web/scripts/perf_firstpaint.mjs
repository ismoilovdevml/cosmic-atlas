// First-paint benchmark of a production build (vite build -> dist/).
//
// Serves <dist> plus ../data/tiles (and a generated tiles/_index.json) from a small static server
// that compresses text like GitHub Pages does (gzip for js/css/json/html/md/svg, not for images,
// fonts or .bin), then loads the default view in a fresh, cache-disabled headless Chrome per run
// (Chromium flags of capture_views.mjs) and records:
//   - firstFrameMs     first GPUCanvasContext.getCurrentTexture() call = first frame drawn to the canvas
//   - layersListedMs   first row in the layers panel (#layer-list li)
//   - layersReadyMs    no row left in its loading state
//   - skyLowMs / skyMs the low-res / full sky image finished downloading (network)
//   - catalogsMs       every catalogue downloaded (labels and search need them)
//   - requests         shell requests (everything but tile .bin and external hosts) once the shell is in,
//                      plus all requests seen by then, and the counts before first frame / layers listed
//   - bytes            transfer (encoded) and decoded bytes by type; JS/CSS fetched before the first frame
// Network profiles: fast (no throttle), 1mbps (1 MB/s down, 100 ms RTT), 0.3mbps (0.3 MB/s, 100 ms):
// the 0.3-2.7 MB/s users in Uzbekistan see from GitHub Pages.
//
// usage: node scripts/perf_firstpaint.mjs <distDir> <label> [--profiles=fast,1mbps,0.3mbps] [--runs=3] [--json=out.json]
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';

const pos = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const dist = resolve(pos[0] ?? 'dist');
const label = pos[1] ?? 'run';
const tilesRoot = resolve(import.meta.dirname, '../../data/tiles');
const runs = +(opt.runs ?? 3);
const PROFILES = {
  fast: null,
  '1mbps': { latency: 100, downloadThroughput: 1_000_000, uploadThroughput: 250_000 },
  '0.3mbps': { latency: 100, downloadThroughput: 300_000, uploadThroughput: 100_000 },
};
const profiles = (opt.profiles ?? 'fast,1mbps,0.3mbps').split(',');

// ---------------------------------------------------------------- static server (GitHub Pages-like)
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.md': 'text/markdown',
  '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.bin': 'application/octet-stream' };
const GZ = new Set(['.html', '.js', '.css', '.json', '.md', '.svg']);
const gzCache = new Map();
function tilesIndex() {
  const layers = readdirSync(tilesRoot, { withFileTypes: true }).filter((d) => (d.isDirectory() || d.isSymbolicLink()) && existsSync(join(tilesRoot, d.name, 'meta.json'))).map((d) => d.name);
  const catalogs = readdirSync(join(tilesRoot, 'catalogs')).filter((f) => f.endsWith('.json'));
  return Buffer.from(JSON.stringify({ layers, catalogs }));
}
const server = createServer((req, res) => {
  let url = decodeURIComponent((req.url ?? '/').split('?')[0].split('#')[0]);
  if (url.endsWith('/')) url += 'index.html';
  let file;
  let body;
  if (url === '/tiles/_index.json') body = tilesIndex();
  else {
    const root = url.startsWith('/tiles/') ? tilesRoot : dist;
    file = resolve(root, url.startsWith('/tiles/') ? url.slice(7) : url.slice(1));
    if (!file.startsWith(root + sep)) return res.writeHead(403).end();
    try {
      if (!statSync(file).isFile()) throw 0;
    } catch {
      return res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
    }
  }
  const ext = file ? extname(file) : '.json';
  const headers = { 'Content-Type': TYPES[ext] ?? 'application/octet-stream', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' };
  if (GZ.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')) {
    let z = file ? gzCache.get(file) : null;
    if (!z) {
      z = gzipSync(body ?? readFileSync(file), { level: 6 });
      if (file) gzCache.set(file, z);
    }
    headers['Content-Encoding'] = 'gzip';
    headers['Content-Length'] = String(z.length);
    return res.writeHead(200, headers).end(z);
  }
  body ??= readFileSync(file);
  headers['Content-Length'] = String(body.length);
  res.writeHead(200, headers).end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

// ---------------------------------------------------------------- page hooks
const HOOKS = () => {
  const P = (window.__perf = { firstFrame: null, layersListed: null, layersReady: null });
  const proto = window.GPUCanvasContext?.prototype;
  if (proto) {
    const orig = proto.getCurrentTexture;
    proto.getCurrentTexture = function (...a) {
      if (P.firstFrame === null) P.firstFrame = performance.now();
      return orig.apply(this, a);
    };
  }
  const check = () => {
    const list = document.getElementById('layer-list');
    if (!list) return;
    const rows = list.querySelectorAll('li');
    if (rows.length && P.layersListed === null) P.layersListed = performance.now();
    if (rows.length && P.layersReady === null && !list.querySelector('li.loading')) P.layersReady = performance.now();
  };
  new MutationObserver(check).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
};

function kindOf(url, type) {
  const u = new URL(url);
  if (u.origin !== new URL(base).origin) return 'external';
  const p = u.pathname;
  if (/layers\.json$|_index\.json$/.test(p)) return 'manifest';
  if (type === 'Script' || p.endsWith('.js')) return 'js';
  if (type === 'Stylesheet' || p.endsWith('.css')) return 'css';
  if (type === 'Font' || /\.woff2?$/.test(p)) return 'font';
  if (/\/sky\//.test(p)) return 'sky';
  if (/\/solar\//.test(p)) return 'solar-tex';
  if (/meta\.json$/.test(p)) return 'meta.json';
  if (/\/catalogs\//.test(p)) return 'catalog';
  if (p.endsWith('.bin')) return 'tile.bin';
  if (p.endsWith('.md')) return 'docs';
  if (p.endsWith('.html') || p === '/') return 'html';
  return 'other';
}

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--enable-features=WebGPU'] });

async function runOnce(profile) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.addInitScript(HOOKS);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  if (PROFILES[profile]) await cdp.send('Network.emulateNetworkConditions', { offline: false, ...PROFILES[profile] });
  const reqs = new Map();
  let t0 = null;
  let lastActivity = Date.now();
  cdp.on('Network.requestWillBeSent', (e) => {
    if (t0 === null) t0 = e.timestamp;
    if (!reqs.has(e.requestId)) reqs.set(e.requestId, { url: e.request.url, start: e.timestamp, type: e.type, end: null, enc: 0, dec: 0, status: 0 });
    lastActivity = Date.now();
  });
  cdp.on('Network.responseReceived', (e) => {
    const r = reqs.get(e.requestId);
    if (r) { r.status = e.response.status; r.type = e.type; }
  });
  cdp.on('Network.dataReceived', (e) => {
    const r = reqs.get(e.requestId);
    if (r) r.dec += e.dataLength;
    lastActivity = Date.now();
  });
  cdp.on('Network.loadingFinished', (e) => {
    const r = reqs.get(e.requestId);
    if (r) { r.end = e.timestamp; r.enc = e.encodedDataLength; }
    lastActivity = Date.now();
  });
  cdp.on('Network.loadingFailed', (e) => {
    const r = reqs.get(e.requestId);
    if (r) { r.end = e.timestamp; r.failed = e.errorText; }
    lastActivity = Date.now();
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  await page.goto(base, { waitUntil: 'commit' });
  const deadline = Date.now() + 240_000;
  for (;;) {
    await page.waitForTimeout(250);
    const p = await page.evaluate(() => window.__perf);
    // the shell is loaded when the frame, the layers panel, the full sky and every catalogue are in;
    // tile streaming at the default view goes on for minutes on a slow link, so it is not waited for
    const shell = [...reqs.values()].filter((r) => !/\.bin$/.test(r.url) && !/^https?:\/\/(?!127\.0\.0\.1)/.test(r.url));
    const open = shell.filter((r) => r.end === null).length;
    const skyDone = shell.some((r) => /gaia_dr3_sky_l9\.(jpg|webp|avif)$/.test(r.url) && r.end !== null);
    if (p.firstFrame !== null && p.layersReady !== null && skyDone && open === 0 && Date.now() - lastActivity > 1500) break;
    if (Date.now() > deadline) { errors.push('timeout'); break; }
  }
  const perf = await page.evaluate(() => window.__perf);
  const list = [...reqs.values()].map((r) => ({ ...r, kind: kindOf(r.url, r.type), startMs: (r.start - t0) * 1000, endMs: r.end === null ? null : (r.end - t0) * 1000 }));
  const before = (ms) => list.filter((r) => r.startMs <= ms).length;
  const byKind = {};
  for (const r of list) {
    const k = (byKind[r.kind] ??= { n: 0, enc: 0, dec: 0 });
    k.n++; k.enc += r.enc; k.dec += r.dec;
  }
  const shellEnd = Math.max(...list.filter((r) => r.kind !== 'tile.bin' && r.kind !== 'external' && r.endMs !== null).map((r) => r.endMs));
  const catEnd = Math.max(0, ...list.filter((r) => r.kind === 'catalog' && r.endMs !== null).map((r) => r.endMs));
  const preFrame = list.filter((r) => (r.kind === 'js' || r.kind === 'css') && r.startMs <= perf.firstFrame);
  const sky = list.filter((r) => r.kind === 'sky' && r.endMs !== null && !/\.json$/.test(r.url)).sort((a, b) => a.endMs - b.endMs);
  const skyFull = sky.find((r) => /gaia_dr3_sky_l9\.(jpg|webp|avif)$/.test(r.url));
  if (process.env.PERF_DEBUG) for (const r of list) if (r.kind === 'other' || r.status >= 400) console.log('   ', r.status, r.kind, r.url.slice(0, 120), r.enc, r.dec);
  const out = {
    label, profile,
    firstFrameMs: Math.round(perf.firstFrame), layersListedMs: Math.round(perf.layersListed), layersReadyMs: Math.round(perf.layersReady),
    skyLowMs: sky.length ? Math.round(sky[0].endMs) : null, skyMs: skyFull ? Math.round(skyFull.endMs) : null,
    catalogsMs: Math.round(catEnd), shellMs: Math.round(shellEnd),
    requests: list.length, shellRequests: list.filter((r) => r.kind !== 'tile.bin' && r.kind !== 'external').length,
    shellBytesEnc: list.filter((r) => r.kind !== 'tile.bin' && r.kind !== 'external').reduce((a, r) => a + r.enc, 0), requestsBeforeFirstFrame: before(perf.firstFrame), requestsBeforeLayersListed: before(perf.layersListed),
    bytesEnc: list.reduce((a, r) => a + r.enc, 0), bytesDec: list.reduce((a, r) => a + r.dec, 0),
    preFrameJsCss: { n: preFrame.length, enc: preFrame.reduce((a, r) => a + r.enc, 0), dec: preFrame.reduce((a, r) => a + r.dec, 0), files: preFrame.map((r) => new URL(r.url).pathname.split('/').pop()) },
    byKind, errors,
  };
  await ctx.close();
  return out;
}

// static: JS/CSS in dist (raw / gzip -6), entry = index.html's script + modulepreloads + css
function staticSizes() {
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]);
  const all = readdirSync(join(dist, 'assets')).filter((f) => /\.(js|css)$/.test(f));
  const size = (f) => { const b = readFileSync(join(dist, 'assets', f)); return { raw: b.length, gz: gzipSync(b, { level: 6 }).length }; };
  const sum = (fs) => fs.map(size).reduce((a, s) => ({ raw: a.raw + s.raw, gz: a.gz + s.gz }), { raw: 0, gz: 0 });
  return { entryFiles: refs, entry: sum(refs.map((r) => r.replace('assets/', ''))), allJsCss: sum(all), chunks: Object.fromEntries(all.map((f) => [f, size(f)])) };
}

const results = [];
console.log(`[${label}] ${dist}  static:`, JSON.stringify(staticSizes()));
for (const prof of profiles) {
  for (let i = 0; i < (prof === 'fast' ? runs : Math.max(1, Math.min(runs, 2))); i++) {
    const r = await runOnce(prof);
    results.push(r);
    const { byKind, preFrameJsCss, ...head } = r;
    console.log(JSON.stringify(head));
    console.log('   preFrame JS/CSS:', JSON.stringify(preFrameJsCss));
    console.log('   byKind:', JSON.stringify(byKind));
  }
}
const med = (a) => { const s = a.filter((x) => x !== null).sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
console.log(`\nmedians [${label}]`);
console.log('profile   firstFrame  layersListed  layersReady  skyLow   skyFull  catalogs  shellDone  requests(<frame/<listed/shell/all)  shell MB');
for (const prof of profiles) {
  const rs = results.filter((r) => r.profile === prof);
  const f = (k) => String(med(rs.map((r) => r[k]))).padStart(8);
  console.log(`${prof.padEnd(8)} ${f('firstFrameMs')}    ${f('layersListedMs')}    ${f('layersReadyMs')}  ${f('skyLowMs')} ${f('skyMs')} ${f('catalogsMs')} ${f('shellMs')}   ${med(rs.map((r) => r.requestsBeforeFirstFrame))}/${med(rs.map((r) => r.requestsBeforeLayersListed))}/${med(rs.map((r) => r.shellRequests))}/${med(rs.map((r) => r.requests))}   ${(med(rs.map((r) => r.shellBytesEnc)) / 1e6).toFixed(2)}`);
}
if (opt.json) writeFileSync(opt.json, JSON.stringify({ label, static: staticSizes(), results }, null, 1));
await browser.close();
server.close();
