import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildTree, cutBlobs, cutLight, lightFromLum, ownLight, type TreeNode } from '../src/tiles/blobs';
import { parseMeta, parseRenderRecords } from '../src/tiles/format';

const TILES = resolve(import.meta.dirname, '../../data/tiles');

function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** random cut closed toward the root: each node drawn with prob p if its parent is drawn */
function randomCut(root: TreeNode, p: number, r: () => number): Set<TreeNode> {
  const drawn = new Set<TreeNode>();
  const walk = (n: TreeNode) => {
    if (r() > p) return;
    drawn.add(n);
    n.children.forEach(walk);
  };
  walk(root);
  return drawn;
}

for (const [layer, kind] of [['synthetic-stars', 'star'], ['synthetic-galaxies', 'galaxy'], ['galaxies-desi', 'galaxy'], ['stars-gaia', 'star']] as const) {
  const metaPath = resolve(TILES, layer, 'meta.json');
  describe.skipIf(!existsSync(metaPath))(`subtree blobs conserve light: ${layer}`, () => {
    // read lazily: a skipped suite's body still runs at collection time
    let cache: { root: TreeNode; rootL: number } | null = null;
    const load = () => {
      if (!cache) {
        const meta = parseMeta(JSON.parse(readFileSync(metaPath, 'utf8')));
        const root = buildTree(meta.nodes)!;
        cache = { root, rootL: root.meta.agg!.L };
      }
      return cache;
    };

    it('own light from agg matches the points in the .bin (first 25 nodes, < 0.1 %)', () => {
      const { root } = load();
      const all: TreeNode[] = [];
      const walk = (n: TreeNode) => (all.push(n), n.children.forEach(walk));
      walk(root);
      for (const n of all.slice(0, 25)) {
        const b = readFileSync(resolve(TILES, layer, 'n', `${n.meta.name}.bin`));
        const rec = parseRenderRecords(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, n.meta.count);
        const fromPoints = lightFromLum(rec.rgbl, rec.count, kind);
        expect(Math.abs(fromPoints / ownLight(n) - 1)).toBeLessThan(1e-3);
      }
    });

    it('drawn own light + blob light = root agg.L within 1 % for any cut', () => {
      const { root, rootL } = load();
      const r = rng(7);
      for (const p of [0, 0.2, 0.5, 0.8, 1]) {
        for (let k = 0; k < 20; k++) {
          const drawn = randomCut(root, p, r);
          const L = cutLight(root, (n) => drawn.has(n));
          expect(Math.abs(L / rootL - 1)).toBeLessThan(0.01);
        }
      }
    });

    it('blobs are exactly the undrawn frontier', () => {
      const { root } = load();
      const drawn = randomCut(root, 0.6, rng(3));
      const blobs = cutBlobs(root, (n) => drawn.has(n));
      for (const b of blobs) expect(drawn.has(b)).toBe(false);
      // nothing drawn -> one blob, the root
      expect(cutBlobs(root, () => false)).toEqual([root]);
    });
  });
}
