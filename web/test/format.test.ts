import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { childCenter, childIndex, findExtId, lumToAbsMag, nodePath, parseMeta, parseRenderRecords, readExtRecord, type NodeMeta } from '../src/tiles/format';

function makeBin(points: { xyz: number[]; rgb: number[]; lum: number }[]): ArrayBuffer {
  const buf = new ArrayBuffer(points.length * 16);
  const dv = new DataView(buf);
  points.forEach((p, i) => {
    p.xyz.forEach((v, k) => dv.setFloat32(i * 16 + k * 4, v, true));
    p.rgb.forEach((v, k) => dv.setUint8(i * 16 + 12 + k, v));
    dv.setUint8(i * 16 + 15, p.lum);
  });
  return buf;
}

const META = {
  layer: 't', title: 't', unit: 'pc', frame: 'galactic-helio', count: 2, nodeCapacity: 20000,
  record: 'xyz_f32_rgb_u8_lum_u8', bytesPerPoint: 16, extRecord: 'id_u64_mag_f32_color_f32',
  extBytesPerPoint: 16, idPrefix: 'Gaia DR3 ',
  nodes: [{ name: 'r', center: [0, 0, 0], half: 1000, count: 2, children: 0 }],
};

describe('tile parser', () => {
  it('splits 16-byte render records into positions + rgbl', () => {
    const buf = makeBin([
      { xyz: [1.5, -2.25, 3.125], rgb: [255, 128, 0], lum: 246 },
      { xyz: [-1e3, 0, 1e-3], rgb: [1, 2, 3], lum: 0 },
    ]);
    const r = parseRenderRecords(buf, 2);
    expect(r.count).toBe(2);
    expect(Array.from(r.positions.slice(0, 3))).toEqual([1.5, -2.25, 3.125]);
    expect(r.positions[3]).toBe(-1000);
    expect(r.positions[5]).toBeCloseTo(1e-3, 9);
    expect(Array.from(r.rgbl)).toEqual([255, 128, 0, 246, 1, 2, 3, 0]);
  });
  it('rejects truncated files and count mismatches', () => {
    expect(() => parseRenderRecords(new ArrayBuffer(17))).toThrow(/multiple of 16/);
    expect(() => parseRenderRecords(new ArrayBuffer(32), 3)).toThrow(/meta.json says 3/);
  });
  it('reads v1 16-byte pick records (uint64 ids beyond 2^53 exactly)', () => {
    const buf = new ArrayBuffer(32);
    const dv = new DataView(buf);
    dv.setBigUint64(16, 4472832130942575872n, true);
    dv.setFloat32(24, 12.5, true);
    dv.setFloat32(28, 1.25, true);
    const e = readExtRecord(buf, 1, 16);
    expect(e.id).toBe(4472832130942575872n);
    expect(e.mag).toBe(12.5);
    expect(e.color).toBe(1.25);
    expect(Number.isNaN(e.distLo) && Number.isNaN(e.distHi)).toBe(true);
    expect(() => readExtRecord(buf, 2, 16)).toThrow();
  });
  it('reads 24-byte pick records with dist_lo / dist_hi, stride from meta', () => {
    const buf = new ArrayBuffer(72);
    const dv = new DataView(buf);
    for (let i = 0; i < 3; i++) {
      dv.setBigUint64(i * 24, 1000n + BigInt(i), true);
      dv.setFloat32(i * 24 + 8, 10 + i, true);
      dv.setFloat32(i * 24 + 12, 0.5, true);
      dv.setFloat32(i * 24 + 16, 90 + i, true);
      dv.setFloat32(i * 24 + 20, i === 2 ? NaN : 110 + i, true);
    }
    const e = readExtRecord(buf, 1, 24);
    expect([e.id, e.mag, e.color, e.distLo, e.distHi]).toEqual([1001n, 11, 0.5, 91, 111]);
    expect(Number.isNaN(readExtRecord(buf, 2, 24).distHi)).toBe(true);
    expect(() => readExtRecord(buf, 3, 24)).toThrow();
    expect(findExtId(buf, 1002n, 24)).toBe(2);
    expect(findExtId(buf, 7n, 24)).toBe(-1);
  });
  it('accepts both pick-record versions in meta.json and rejects bad strides', () => {
    expect(parseMeta({ ...META, extRecord: 'id_u64_mag_f32_color_f32_distlo_f32_disthi_f32', extBytesPerPoint: 24 }).extBytesPerPoint).toBe(24);
    expect(() => parseMeta({ ...META, extBytesPerPoint: 18 })).toThrow(/extBytesPerPoint/);
    expect(() => parseMeta({ ...META, extRecord: 'id_u32' })).toThrow(/extRecord/);
  });
  it('finds the octree path to a point', () => {
    const N = (name: string, center: number[], half: number, children: number): NodeMeta => ({ name, center: center as [number, number, number], half, count: 1, children });
    const m = new Map([['r', N('r', [0, 0, 0], 8, 1 << 4)], ['r4', N('r4', [4, -4, -4], 4, 1 << 7)], ['r47', N('r47', [6, -2, -2], 2, 0)]].map(([k, v]) => [k as string, v as NodeMeta]));
    expect(nodePath(m, [5, -1, -1])).toEqual(['r', 'r4', 'r47']);
    expect(nodePath(m, [5, -6, -6])).toEqual(['r', 'r4']);
    expect(nodePath(m, [-5, 0, 0])).toEqual(['r']);
  });
  it('validates meta.json against the contract', () => {
    expect(parseMeta(META).idPrefix).toBe('Gaia DR3 ');
    expect(() => parseMeta({ ...META, unit: 'Mpc' })).toThrow(/unit/);
    expect(() => parseMeta({ ...META, bytesPerPoint: 12 })).toThrow(/record/);
    expect(() => parseMeta({ ...META, nodes: [{ ...META.nodes[0], name: 'r9' }] })).toThrow(/node name/);
  });
  it('child index bits follow (x>=cx)<<2 | (y>=cy)<<1 | (z>=cz)', () => {
    expect(childIndex([1, -1, -1], [0, 0, 0])).toBe(4);
    expect(childIndex([-1, 1, -1], [0, 0, 0])).toBe(2);
    expect(childIndex([0, 0, 0], [0, 0, 0])).toBe(7);
    expect(childCenter([0, 0, 0], 1000, 5)).toEqual([500, -500, 500]);
  });
  it('decodes the lum byte to absolute magnitude', () => {
    expect(lumToAbsMag(150, 'star')).toBe(5);
    expect(lumToAbsMag(0, 'galaxy')).toBe(-14);
    expect(lumToAbsMag(150, 'galaxy')).toBe(-21.5);
  });
});

// Cross-check against whatever tiles are on disk (synthetic by default): every point of the
// first few nodes lies inside its node cube, and counts match meta.json.
const TILES = resolve(import.meta.dirname, '../../data/tiles');
for (const layer of ['synthetic-stars', 'synthetic-galaxies', 'stars-gaia', 'galaxies-desi']) {
  const metaPath = resolve(TILES, layer, 'meta.json');
  describe.skipIf(!existsSync(metaPath))(`tiles on disk: ${layer}`, () => {
    it('nodes parse and points lie inside their cubes', () => {
      const meta = parseMeta(JSON.parse(readFileSync(metaPath, 'utf8')));
      let total = 0;
      for (const n of meta.nodes) total += n.count;
      expect(total).toBe(meta.count);
      for (const n of meta.nodes.slice(0, 12)) {
        const b = readFileSync(resolve(TILES, layer, 'n', `${n.name}.bin`));
        const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
        const r = parseRenderRecords(ab, n.count);
        let worst = 0;
        for (let i = 0; i < r.positions.length; i++) worst = Math.max(worst, Math.abs(r.positions[i]));
        expect(worst).toBeLessThanOrEqual(n.half * (1 + 1e-5));
        for (let k = 0; k < 8; k++) {
          if (n.children & (1 << k)) expect(meta.nodes.some((m) => m.name === n.name + k)).toBe(true);
        }
      }
    });
  });
}
