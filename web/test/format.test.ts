import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { childCenter, childIndex, lumToAbsMag, parseMeta, parseRenderRecords, readExtRecord } from '../src/tiles/format';

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
  it('reads uint64 ids beyond 2^53 exactly', () => {
    const buf = new ArrayBuffer(32);
    const dv = new DataView(buf);
    dv.setBigUint64(16, 4472832130942575872n, true);
    dv.setFloat32(24, 12.5, true);
    dv.setFloat32(28, 1.25, true);
    const e = readExtRecord(buf, 1);
    expect(e.id).toBe(4472832130942575872n);
    expect(e.mag).toBe(12.5);
    expect(e.color).toBe(1.25);
    expect(() => readExtRecord(buf, 2)).toThrow();
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
        const tol = n.half * (1 + 1e-5);
        for (let i = 0; i < r.positions.length; i++) expect(Math.abs(r.positions[i])).toBeLessThanOrEqual(tol);
        for (let k = 0; k < 8; k++) {
          if (n.children & (1 << k)) expect(meta.nodes.some((m) => m.name === n.name + k)).toBe(true);
        }
      }
    });
  });
}
