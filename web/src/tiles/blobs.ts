/**
 * Subtree "blobs" (technique from skymap, MIT, Copyright (c) 2026 Alexander Rulkens,
 * src/services/gpu/shaders/octree/cut.wesl; re-implemented, not copied).
 *
 * A cut through the octree draws the OWN points of every drawn node and, for every node that is
 * not drawn but whose parent is (or which is an undrawn root), one blob carrying that node's whole
 * subtree light `agg.L`. Because agg.L(n) = own(n) + Σ agg.L(children), the drawn light of any cut
 * equals the root's agg.L: distant views keep their total brightness whatever the budget.
 */

import type { NodeMeta } from './format';

export interface TreeNode {
  meta: NodeMeta;
  children: TreeNode[];
}

/** light of a node's own points = subtree light minus its children's subtree light */
export function ownLight(n: TreeNode): number {
  const L = n.meta.agg?.L ?? 0;
  let ch = 0;
  for (const c of n.children) ch += c.meta.agg?.L ?? 0;
  return Math.max(0, L - ch);
}

/** nodes represented by a blob for the cut `isDrawn` (drawn set must be closed toward the root) */
export function cutBlobs<T extends TreeNode>(root: T, isDrawn: (n: T) => boolean): T[] {
  const out: T[] = [];
  const walk = (n: T) => {
    if (!isDrawn(n)) {
      out.push(n);
      return;
    }
    for (const c of n.children) walk(c as T);
  };
  walk(root);
  return out;
}

/** total light of a cut: own light of drawn nodes + subtree light of blob nodes */
export function cutLight<T extends TreeNode>(root: T, isDrawn: (n: T) => boolean, own: (n: T) => number = ownLight): number {
  let L = 0;
  const walk = (n: T) => {
    if (!isDrawn(n)) {
      L += n.meta.agg?.L ?? 0;
      return;
    }
    L += own(n);
    for (const c of n.children) walk(c as T);
  };
  walk(root);
  return L;
}

/** luminosity (units of an M = 0 source) of a node's points, from their lum codes */
export function lightFromLum(rgbl: Uint8Array, count: number, kind: 'star' | 'galaxy'): number {
  let L = 0;
  for (let i = 0; i < count; i++) {
    const code = rgbl[i * 4 + 3];
    const M = kind === 'star' ? 20 - code / 10 : -14 - code / 20;
    L += Math.pow(10, -0.4 * M);
  }
  return L;
}

/** build the tree from meta.json nodes */
export function buildTree(nodes: NodeMeta[]): TreeNode | null {
  const by = new Map<string, TreeNode>();
  for (const m of nodes) by.set(m.name, { meta: m, children: [] });
  for (const n of by.values()) if (n.meta.name.length > 1) by.get(n.meta.name.slice(0, -1))?.children.push(n);
  return by.get('r') ?? null;
}
