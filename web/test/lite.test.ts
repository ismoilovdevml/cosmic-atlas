/**
 * Lite tile sets (scripts/make_lite_tiles.py) with the viewer's own blob logic (src/tiles/blobs.ts).
 *
 * Fixture: fixtures/lite/{full,lite}-meta.json, one synthetic galaxy layer (8000 points, capacity
 * 100, 206 nodes) and its lite copy (34 nodes). Regenerate with a throwaway script that calls
 * tests/test_make_lite_tiles.py::_layer(work, "gal", 8000, "galaxy", 11, 100) and then
 * make_lite_tiles.py --budget-mb 0.18.
 *
 * A real lite set can be checked too: LITE_TILES=/path/to/lite npx vitest run test/lite.test.ts
 * compares it against the full set in ../data/tiles.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildTree, cutLight, cutLightSplit, isDroppedNode, lightFromLum, ownLight, subtreeRms, type TreeNode } from '../src/tiles/blobs';
import { parseMeta, parseRenderRecords, type LayerMeta } from '../src/tiles/format';

const FIX = resolve(import.meta.dirname, 'fixtures/lite');
const FULL_TILES = resolve(import.meta.dirname, '../../data/tiles');

function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function all(root: TreeNode): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (n: TreeNode) => (out.push(n), n.children.forEach(walk));
  walk(root);
  return out;
}

/** random cut closed toward the root; virtual dropped nodes are never drawn (they have no points) */
function randomCut(root: TreeNode, p: number, r: () => number): Set<TreeNode> {
  const drawn = new Set<TreeNode>();
  const walk = (n: TreeNode) => {
    if (isDroppedNode(n.meta) || r() > p) return;
    drawn.add(n);
    n.children.forEach(walk);
  };
  walk(root);
  return drawn;
}

function suite(name: string, load: () => { full: LayerMeta; lite: LayerMeta }, kind?: 'star' | 'galaxy', binDir?: string) {
  describe(`lite tile set conserves light: ${name}`, () => {
    let cache: { full: LayerMeta; lite: LayerMeta; froot: TreeNode; lroot: TreeNode; rootL: number } | null = null;
    const get = () => {
      if (!cache) {
        const { full, lite } = load();
        const froot = buildTree(full.nodes)!;
        const lroot = buildTree(lite.nodes)!;
        cache = { full, lite, froot, lroot, rootL: froot.meta.agg!.L };
      }
      return cache;
    };

    it('is a pruned copy: lite flag, counts, fewer nodes, same root aggregate', () => {
      const { full, lite, lroot, froot } = get();
      expect(lite.lite).toBe(true);
      expect(lite.fullCount).toBe(full.count);
      expect(lite.fullNodes).toBe(full.nodes.length);
      expect(lite.nodes.length).toBeLessThan(full.nodes.length);
      expect(lite.count).toBe(lite.nodes.reduce((s, n) => s + n.count, 0));
      expect(lroot.meta.agg).toEqual(froot.meta.agg);
      // every point is either in a kept node or counted in some node's `dropped`
      const droppedN = lite.nodes.reduce((s, n) => s + (n.dropped?.n ?? 0), 0);
      expect(lite.count + droppedN).toBe(full.count);
    });

    it("own light of every kept node equals its own light in the full set (drawn points carry exactly that)", () => {
      const { froot, lroot } = get();
      const fullOwn = new Map(all(froot).map((n) => [n.meta.name, ownLight(n)]));
      for (const n of all(lroot)) {
        if (isDroppedNode(n.meta)) {
          expect(ownLight(n)).toBe(0);
          continue;
        }
        const ref = fullOwn.get(n.meta.name)!;
        expect(Math.abs(ownLight(n) - ref)).toBeLessThanOrEqual(1e-4 * n.meta.agg!.L);
      }
    });

    it('without the virtual dropped node, the old rule would credit drawn points with dropped light', () => {
      const { lite, froot } = get();
      // strip `dropped`: what the viewer did before lite support
      const naive = buildTree(lite.nodes.map(({ dropped: _d, ...m }) => m))!;
      const fullOwn = new Map(all(froot).map((n) => [n.meta.name, ownLight(n)]));
      const worst = Math.max(...all(naive).map((n) => ownLight(n) / Math.max(fullOwn.get(n.meta.name)!, 1e-300)));
      expect(worst).toBeGreaterThan(1.01);
    });

    it('drawn + blob = root light for any cut; drawn + blob + pending + dropped = root with the 6 px rule', () => {
      const { lroot, rootL } = get();
      const r = rng(5);
      for (const p of [0, 0.3, 0.6, 1]) {
        for (let k = 0; k < 20; k++) {
          const drawn = randomCut(lroot, p, r);
          expect(Math.abs(cutLight(lroot, (n) => drawn.has(n)) / rootL - 1)).toBeLessThan(0.01);
        }
      }
      for (const dist of [1e3, 3e5, 3e7, 1e9, 3e9]) {
        const eligible = (n: TreeNode) => ((2 * subtreeRms(n)) / dist) * 864 <= 6;
        for (let k = 0; k < 10; k++) {
          const drawn = randomCut(lroot, 0.8, r);
          const c = cutLightSplit(lroot, (n) => drawn.has(n), eligible);
          expect(Math.abs((c.drawn + c.blob + c.pending + c.dropped) / rootL - 1)).toBeLessThan(0.01);
        }
      }
    });

    it('fully drawn lite tree: drawn own light + dropped light (as blobs) = full root light', () => {
      const { lroot, rootL } = get();
      const c = cutLightSplit(lroot, (n) => !isDroppedNode(n.meta), () => true);
      expect(c.pending).toBe(0);
      expect(Math.abs((c.drawn + c.blob) / rootL - 1)).toBeLessThan(1e-3);
      // the blob part is exactly the dropped light
      const droppedL = all(lroot).filter((n) => isDroppedNode(n.meta)).reduce((s, n) => s + n.meta.agg!.L, 0);
      expect(Math.abs(c.blob - droppedL)).toBeLessThanOrEqual(1e-9 * rootL);
      // up close every dropped subtree is resolvable: its light is reported, never smeared
      const near = cutLightSplit(lroot, (n) => !isDroppedNode(n.meta), () => false);
      expect(near.blob).toBe(0);
      expect(Math.abs(near.dropped - droppedL)).toBeLessThanOrEqual(1e-9 * rootL);
    });

    if (kind && binDir) {
      it('own light from agg matches the points in the kept .bin files (25 pruned leaves, < 0.1 %)', () => {
        const { lroot } = get();
        const leaves = all(lroot).filter((n) => n.meta.dropped).slice(0, 25);
        expect(leaves.length).toBeGreaterThan(0);
        for (const n of leaves) {
          const b = readFileSync(resolve(binDir, 'n', `${n.meta.name}.bin`));
          const rec = parseRenderRecords(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, n.meta.count);
          expect(Math.abs(lightFromLum(rec.rgbl, rec.count, kind) / ownLight(n) - 1)).toBeLessThan(1e-3);
        }
      });
    }
  });
}

const readMeta = (p: string) => parseMeta(JSON.parse(readFileSync(p, 'utf8')));

suite('fixture (synthetic, 206 -> 34 nodes)', () => ({ full: readMeta(resolve(FIX, 'full-meta.json')), lite: readMeta(resolve(FIX, 'lite-meta.json')) }));

const LITE = process.env.LITE_TILES;
if (LITE && existsSync(LITE)) {
  for (const layer of ['galaxies-desi', 'stars-gaia', 'synthetic-stars', 'synthetic-galaxies', 'galaxies-2mrs', 'galaxies-cf4']) {
    const lp = resolve(LITE, layer, 'meta.json');
    const fp = resolve(FULL_TILES, layer, 'meta.json');
    if (!existsSync(lp) || !existsSync(fp)) continue;
    const lite = JSON.parse(readFileSync(lp, 'utf8'));
    if (!lite.lite) continue; // copied whole
    const kind = lite.lumModel === 'star' || layer.startsWith('stars') || layer === 'synthetic-stars' ? 'star' : 'galaxy';
    suite(`${LITE}/${layer}`, () => ({ full: readMeta(fp), lite: parseMeta(lite) }), kind, resolve(LITE, layer));
  }
}
