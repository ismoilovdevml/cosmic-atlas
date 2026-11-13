// Compare screenshot pairs pixel by pixel (decoded in headless Chromium, no image deps).
// usage: node scripts/qa_compare.mjs <a.png> <b.png> [<a2.png> <b2.png> ...]
// Prints, per pair: mean luminance of each (0..255), mean |a−b| per channel, and the share of pixels
// whose largest channel difference exceeds 24 (a visible change).
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const files = process.argv.slice(2);
if (files.length < 2 || files.length % 2) {
  console.error('usage: qa_compare.mjs a.png b.png [a2.png b2.png ...]');
  process.exit(2);
}
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
for (let i = 0; i < files.length; i += 2) {
  const [a, b] = [files[i], files[i + 1]].map((f) => readFileSync(f).toString('base64'));
  const r = await page.evaluate(async ([a64, b64]) => {
    const decode = async (s) => {
      const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${s}`)).blob());
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext('2d');
      g.drawImage(bmp, 0, 0);
      return g.getImageData(0, 0, bmp.width, bmp.height);
    };
    const A = await decode(a64);
    const B = await decode(b64);
    if (A.width !== B.width || A.height !== B.height) return { error: `size ${A.width}x${A.height} vs ${B.width}x${B.height}` };
    const n = A.width * A.height;
    let la = 0, lb = 0, d = 0, big = 0;
    for (let p = 0; p < n * 4; p += 4) {
      la += 0.2126 * A.data[p] + 0.7152 * A.data[p + 1] + 0.0722 * A.data[p + 2];
      lb += 0.2126 * B.data[p] + 0.7152 * B.data[p + 1] + 0.0722 * B.data[p + 2];
      let m = 0;
      for (let k = 0; k < 3; k++) {
        const e = Math.abs(A.data[p + k] - B.data[p + k]);
        d += e;
        if (e > m) m = e;
      }
      if (m > 24) big++;
    }
    return { lumA: +(la / n).toFixed(2), lumB: +(lb / n).toFixed(2), meanAbsDiff: +(d / (3 * n)).toFixed(3), changedPct: +((100 * big) / n).toFixed(3) };
  }, [a, b]);
  console.log(JSON.stringify({ a: files[i].split('/').pop(), b: files[i + 1].split('/').pop(), ...r }));
}
await browser.close();
