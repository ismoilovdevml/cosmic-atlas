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

/**
 * Lite tile sets (scripts/make_lite_tiles.py) drop deep nodes. A kept node whose children were
 * dropped carries their merged aggregate in `meta.dropped`. That light has no points anywhere in
 * the set, so it is modelled as one virtual child named `<parent>~` with count 0 and agg = dropped:
 * it is never loaded, it becomes a blob when its parent is drawn and it is unresolved, and its
 * light is otherwise reported as "not in this tile set". Without it, ownLight() of the parent
 * would silently absorb the dropped light (agg.L − Σ kept children) while the drawn points do not
 * carry it.
 */
export const DROPPED_SUFFIX = '~';

export function isDroppedNode(m: NodeMeta): boolean {
  return m.name.endsWith(DROPPED_SUFFIX);
}

/** meta of the virtual node standing for `m`'s dropped children, or null if none were dropped */
export function droppedNodeMeta(m: NodeMeta): NodeMeta | null {
  const d = m.dropped;
  if (!d || !(d.n > 0 || d.L > 0)) return null;
  return { name: m.name + DROPPED_SUFFIX, center: m.center, half: m.half, count: 0, children: 0, agg: d };
}

export interface TreeNode {
  meta: NodeMeta;
  children: TreeNode[];
}

/** light of a node's own points = subtree light minus its children's subtree light */
export function ownLight(n: TreeNode): number {
  if (isDroppedNode(n.meta)) return 0;
  const L = n.meta.agg?.L ?? 0;
  let ch = 0;
  for (const c of n.children) ch += c.meta.agg?.L ?? 0;
  return Math.max(0, L - ch);
}

/**
 * Light-weighted RMS radius of a subtree about its centroid. Uses `agg.rms` when the tiles carry
 * it; otherwise the RMS radius of a uniformly filled cube about its centre, which equals the
 * half-edge (each axis has variance half²/3).
 */
export function subtreeRms(n: TreeNode): number {
  return n.meta.agg?.rms ?? n.meta.half;
}

export interface CutLight {
  /** own light of drawn nodes */
  drawn: number;
  /** subtree light drawn as blobs (unresolved at this view) */
  blob: number;
  /** subtree light neither drawn nor blobbed: resolvable but not loaded yet */
  pending: number;
  /** lite tile sets: resolvable light of dropped subtrees, which no tile in the set can supply */
  dropped: number;
}

/**
 * Split a cut's light into drawn / blob / pending / dropped. A subtree that is not drawn becomes a
 * blob only when `isEligible` says it is unresolved at the current view; otherwise its light is
 * pending (or dropped, for a lite set's virtual node). The four parts always add up to the root's
 * agg.L. `isDrawn` must be false for virtual dropped nodes (they have no points).
 */
export function cutLightSplit<T extends TreeNode>(
  root: T, isDrawn: (n: T) => boolean, isEligible: (n: T) => boolean, own: (n: T) => number = ownLight,
): CutLight {
  const out: CutLight = { drawn: 0, blob: 0, pending: 0, dropped: 0 };
  const walk = (n: T) => {
    if (!isDrawn(n)) {
      if (isEligible(n)) out.blob += n.meta.agg?.L ?? 0;
      else if (isDroppedNode(n.meta)) out.dropped += n.meta.agg?.L ?? 0;
      else out.pending += n.meta.agg?.L ?? 0;
      return;
    }
    out.drawn += own(n);
    for (const c of n.children) walk(c as T);
  };
  walk(root);
  return out;
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

/** build the tree from meta.json nodes, plus one virtual child per node with dropped children */
export function buildTree(nodes: NodeMeta[]): TreeNode | null {
  const by = new Map<string, TreeNode>();
  for (const m of nodes) by.set(m.name, { meta: m, children: [] });
  for (const n of by.values()) if (n.meta.name.length > 1) by.get(n.meta.name.slice(0, -1))?.children.push(n);
  for (const n of by.values()) {
    const d = droppedNodeMeta(n.meta);
    if (d) n.children.push({ meta: d, children: [] });
  }
  return by.get('r') ?? null;
}
