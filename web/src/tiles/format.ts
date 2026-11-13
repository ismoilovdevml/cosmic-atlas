/** Tile format, docs/data-contract.md section 3. Pure functions, no DOM / three.js. */

/** Summed light of a node and all its descendants (contract section 3). */
export interface NodeAgg {
  /** point count */
  n: number;
  /** total luminosity in units of an M = 0 source (from the lum codes) */
  L: number;
  /** light-weighted centroid, pc, relative to the node centre */
  c: [number, number, number];
  /** light-weighted mean colour, sRGB bytes */
  rgb: [number, number, number];
  /** light-weighted RMS radius about the centroid, pc (optional; proposed contract field) */
  rms?: number;
}

export interface NodeMeta {
  name: string;
  center: [number, number, number];
  half: number;
  count: number;
  children: number;
  agg?: NodeAgg;
}

export interface LayerMeta {
  layer: string;
  title: string;
  unit: 'pc';
  frame: 'galactic-helio';
  count: number;
  nodeCapacity: number;
  record: string;
  bytesPerPoint: number;
  extRecord: string;
  extBytesPerPoint: number;
  idPrefix: string;
  synthetic?: boolean;
  nodes: NodeMeta[];
}

export const RENDER_RECORD = 'xyz_f32_rgb_u8_lum_u8';
/** v1 pick record (16 B) and the current one with distance percentiles (24 B) */
export const EXT_RECORD_V1 = 'id_u64_mag_f32_color_f32';
export const EXT_RECORD = 'id_u64_mag_f32_color_f32_distlo_f32_disthi_f32';

/** Validate meta.json against the contract. Throws with a specific message on mismatch. */
export function parseMeta(json: unknown): LayerMeta {
  const m = json as Partial<LayerMeta>;
  const fail = (why: string): never => {
    throw new Error(`meta.json for '${m?.layer ?? '?'}' does not match data contract v1: ${why}`);
  };
  if (!m || typeof m !== 'object') fail('not an object');
  if (m.unit !== 'pc') fail(`unit is '${m.unit}', expected 'pc'`);
  if (m.frame !== 'galactic-helio') fail(`frame is '${m.frame}', expected 'galactic-helio'`);
  if (m.record !== RENDER_RECORD || m.bytesPerPoint !== 16) fail(`record '${m.record}' / ${m.bytesPerPoint} B`);
  // the pick record may grow; its leading fields are fixed, its size comes from extBytesPerPoint
  if (m.extRecord !== undefined && !String(m.extRecord).startsWith(EXT_RECORD_V1)) fail(`extRecord '${m.extRecord}'`);
  if (m.extRecord !== undefined && !(Number(m.extBytesPerPoint) >= 16 && Number(m.extBytesPerPoint) % 4 === 0))
    fail(`extBytesPerPoint ${m.extBytesPerPoint}`);
  if (!Array.isArray(m.nodes) || m.nodes.length === 0) fail('no nodes');
  for (const n of m.nodes!) {
    if (!/^r[0-7]*$/.test(n.name)) fail(`bad node name '${n.name}'`);
    if (!Array.isArray(n.center) || n.center.length !== 3) fail(`node ${n.name}: bad center`);
    if (!(n.half > 0)) fail(`node ${n.name}: bad half`);
  }
  return { idPrefix: '', extRecord: EXT_RECORD_V1, extBytesPerPoint: 16, ...m } as LayerMeta;
}

/** Child index bits from the contract: (x>=cx)<<2 | (y>=cy)<<1 | (z>=cz). */
export function childIndex(p: readonly number[], c: readonly number[]): number {
  return ((p[0] >= c[0] ? 1 : 0) << 2) | ((p[1] >= c[1] ? 1 : 0) << 1) | (p[2] >= c[2] ? 1 : 0);
}

export function childCenter(c: readonly number[], half: number, k: number): [number, number, number] {
  const h = half / 2;
  return [c[0] + ((k >> 2) & 1 ? h : -h), c[1] + ((k >> 1) & 1 ? h : -h), c[2] + (k & 1 ? h : -h)];
}

export interface RenderRecords {
  count: number;
  /** xyz relative to node centre, pc */
  positions: Float32Array;
  /** r, g, b, lum per point */
  rgbl: Uint8Array;
}

/** Split a .bin (16 B/point, little endian) into GPU-friendly arrays. */
export function parseRenderRecords(buf: ArrayBuffer, expectedCount?: number): RenderRecords {
  if (buf.byteLength % 16 !== 0) throw new Error(`.bin length ${buf.byteLength} is not a multiple of 16`);
  const count = buf.byteLength / 16;
  if (expectedCount !== undefined && expectedCount !== count)
    throw new Error(`.bin has ${count} points, meta.json says ${expectedCount}`);
  const f32 = new Float32Array(buf);
  const u8 = new Uint8Array(buf);
  const positions = new Float32Array(count * 3);
  const rgbl = new Uint8Array(count * 4);
  const le = isLittleEndian();
  if (le) {
    for (let i = 0; i < count; i++) {
      positions[i * 3] = f32[i * 4];
      positions[i * 3 + 1] = f32[i * 4 + 1];
      positions[i * 3 + 2] = f32[i * 4 + 2];
    }
  } else {
    const dv = new DataView(buf);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = dv.getFloat32(i * 16, true);
      positions[i * 3 + 1] = dv.getFloat32(i * 16 + 4, true);
      positions[i * 3 + 2] = dv.getFloat32(i * 16 + 8, true);
    }
  }
  for (let i = 0; i < count; i++) {
    const o = i * 16 + 12;
    rgbl[i * 4] = u8[o];
    rgbl[i * 4 + 1] = u8[o + 1];
    rgbl[i * 4 + 2] = u8[o + 2];
    rgbl[i * 4 + 3] = u8[o + 3];
  }
  return { count, positions, rgbl };
}

export interface ExtRecord {
  id: bigint;
  mag: number;
  /** BP-RP for stars, redshift z for galaxies */
  color: number;
  /** 16th / 84th percentile distance, pc; NaN when unknown or not in this record version */
  distLo: number;
  distHi: number;
}

/** Read pick record `index`; `stride` = meta.extBytesPerPoint (16 for v1, 24 now). */
export function readExtRecord(buf: ArrayBuffer, index: number, stride: number): ExtRecord {
  const o = index * stride;
  if (o + stride > buf.byteLength) throw new Error(`ext record ${index} out of range`);
  const dv = new DataView(buf);
  return {
    id: dv.getBigUint64(o, true),
    mag: dv.getFloat32(o + 8, true),
    color: dv.getFloat32(o + 12, true),
    distLo: stride >= 24 ? dv.getFloat32(o + 16, true) : NaN,
    distHi: stride >= 24 ? dv.getFloat32(o + 20, true) : NaN,
  };
}

/** index of the record with this id, or -1 */
export function findExtId(buf: ArrayBuffer, id: bigint, stride: number): number {
  const dv = new DataView(buf);
  for (let i = 0, n = Math.floor(buf.byteLength / stride); i < n; i++) if (dv.getBigUint64(i * stride, true) === id) return i;
  return -1;
}

/** Names of the nodes on the path from the root to the deepest existing node containing p. */
export function nodePath(nodes: Map<string, NodeMeta>, p: readonly number[]): string[] {
  const out: string[] = [];
  let n = nodes.get('r');
  while (n) {
    out.push(n.name);
    const k = childIndex(p, n.center);
    n = n.children & (1 << k) ? nodes.get(n.name + k) : undefined;
  }
  return out;
}

/** Absolute magnitude decoded from the lum byte (contract section 3). */
export function lumToAbsMag(lum: number, kind: 'star' | 'galaxy'): number {
  return kind === 'star' ? 20 - lum / 10 : -14 - lum / 20;
}

let _le: boolean | undefined;
function isLittleEndian(): boolean {
  if (_le === undefined) _le = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
  return _le;
}
