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
  /**
   * Lite tile sets only (scripts/make_lite_tiles.py): merged `agg` of this node's children that were
   * dropped from the set. agg.L = own + Σ kept children agg.L + dropped.L.
   */
  dropped?: NodeAgg;
  /** velocity stream only: fastest stored speed of this node's points, km/s (rounded up) */
  vmax?: number;
}

/** meta.json `velocity` (contract section 3, `.vel.bin`): present only when the stream exists */
export interface VelocityMeta {
  unit: 'km/s';
  frame: 'galactic';
  /** 'sun' = heliocentric; 'lsr' = relative to the LSR (the Sun moves with `sunVelocity`) */
  origin: 'sun' | 'lsr';
  encoding: typeof VEL_ENCODING;
  bytesPerPoint: 8;
  rvMissing: 'tangential';
  /** velocity of the Sun in the stream's frame, km/s (subtract it for motion relative to the Sun) */
  sunVelocity: [number, number, number];
  counts?: { full: number; tangential: number; none: number };
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
  /** a pruned copy made by scripts/make_lite_tiles.py: `count` points kept of `fullCount` */
  lite?: boolean;
  fullCount?: number;
  fullNodes?: number;
  /** optional per-point space velocities (`n/<node>.vel.bin`) */
  velocity?: VelocityMeta;
  /** free-text caveat, e.g. "preview, partial sky: ..." */
  note?: string;
  /** stars-gaia-preview: how much of the planned download it is built from */
  preview?: { chunks: number; chunksPlanned: number; skyFraction: number };
  nodes: NodeMeta[];
}

export const RENDER_RECORD = 'xyz_f32_rgb_u8_lum_u8';
/** v1 pick record (16 B) and the current one with distance percentiles (24 B) */
export const EXT_RECORD_V1 = 'id_u64_mag_f32_color_f32';
export const EXT_RECORD = 'id_u64_mag_f32_color_f32_distlo_f32_disthi_f32';
/** velocity record: vx, vy, vz (km/s, Galactic), q, all float16 */
export const VEL_ENCODING = 'vx_vy_vz_q_f16';
/** 1 km/s for 1 Myr in pc (Julian years; astropy (1 km/s * 1 Myr).to(pc)) */
export const PC_PER_KMS_MYR = 1.022712165045695;
/** velocity quality codes (the record's 4th value) */
export const VEL_Q = { full: 1, tangential: 0, none: -1 } as const;

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
  if (m.velocity !== undefined) {
    const v = m.velocity;
    if (v.unit !== 'km/s' || v.frame !== 'galactic') fail(`velocity unit/frame '${v.unit}'/'${v.frame}'`);
    if (v.encoding !== VEL_ENCODING || v.bytesPerPoint !== 8) fail(`velocity encoding '${v.encoding}' / ${v.bytesPerPoint} B`);
    if (!Array.isArray(v.sunVelocity) || v.sunVelocity.length !== 3 || !v.sunVelocity.every(Number.isFinite)) fail('velocity.sunVelocity');
  }
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

/** IEEE 754 binary16 -> number (exact; subnormals, inf, NaN included) */
export function halfToFloat(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return s * f * 2 ** -24;
  if (e === 31) return f ? NaN : s * Infinity;
  return s * (1 + f / 1024) * 2 ** (e - 15);
}

let _half: Float32Array | undefined;
/** all 65 536 binary16 values as float32 (256 KB, built once) */
function halfTable(): Float32Array {
  if (!_half) {
    _half = new Float32Array(65536);
    for (let i = 0; i < 65536; i++) _half[i] = halfToFloat(i);
  }
  return _half;
}

/**
 * Decode a `.vel.bin` (8 B/point: vx, vy, vz in km/s, q; little-endian float16) into one float32
 * vec4 per point, ready for a GPU instance attribute.
 */
export function parseVelocityRecords(buf: ArrayBuffer, expectedCount?: number): Float32Array {
  if (buf.byteLength % 8 !== 0) throw new Error(`.vel.bin length ${buf.byteLength} is not a multiple of 8`);
  const count = buf.byteLength / 8;
  if (expectedCount !== undefined && expectedCount !== count)
    throw new Error(`.vel.bin has ${count} points, meta.json says ${expectedCount}`);
  const T = halfTable();
  const out = new Float32Array(count * 4);
  if (isLittleEndian()) {
    const u16 = new Uint16Array(buf);
    for (let i = 0; i < out.length; i++) out[i] = T[u16[i]];
  } else {
    const dv = new DataView(buf);
    for (let i = 0; i < out.length; i++) out[i] = T[dv.getUint16(i * 2, true)];
  }
  return out;
}

/**
 * Position (pc, contract frame) of point `i` of a node at Δt Myr: x0 + (v − v_sun)·Δt·1.0227, in
 * float64 (the CPU twin of the moving point shader). `vel` = parseVelocityRecords output.
 */
export function movedPosition(
  center: readonly number[], positions: Float32Array, vel: Float32Array | null, i: number, dtMyr: number,
  sunVelocity: readonly number[] = [0, 0, 0],
): [number, number, number] {
  const k = vel && dtMyr ? dtMyr * PC_PER_KMS_MYR : 0;
  const o = i * 4;
  return [
    center[0] + positions[i * 3] + (k ? (vel![o] - sunVelocity[0]) * k : 0),
    center[1] + positions[i * 3 + 1] + (k ? (vel![o + 1] - sunVelocity[1]) * k : 0),
    center[2] + positions[i * 3 + 2] + (k ? (vel![o + 2] - sunVelocity[2]) * k : 0),
  ];
}

/** Linear closest approach to the Sun: time (Myr, + = future) and distance (pc). */
export function closestApproach(x: readonly number[], vKms: readonly number[]): { tMyr: number; dPc: number } {
  const v = vKms.map((c) => c * PC_PER_KMS_MYR);
  const vv = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
  const t = vv > 0 ? -(x[0] * v[0] + x[1] * v[1] + x[2] * v[2]) / vv : 0;
  return { tMyr: t, dPc: Math.hypot(x[0] + v[0] * t, x[1] + v[1] * t, x[2] + v[2] * t) };
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
