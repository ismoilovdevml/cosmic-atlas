/**
 * Hybrid lite sets (scripts/make_lite_tiles.py --remote): shallow nodes on this host, the rest on a
 * second host under a sharded path (contract section 3b).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { nodeFileUrl, parseMeta } from '../src/tiles/format';

const full = JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures/lite/full-meta.json'), 'utf8'));
const BASE = 'https://huggingface.co/datasets/someone/tiles/resolve/main/stars-gaia';

describe('remote nodes', () => {
  it('keeps local nodes on the layer path and sends remote ones to the sharded remote path', () => {
    const m = parseMeta({ ...full, remote: { base: BASE + '/', shard: 3 } });
    expect(nodeFileUrl('tiles/gal', m, { name: 'r01', remote: undefined }, '.bin')).toBe('tiles/gal/n/r01.bin');
    expect(nodeFileUrl('tiles/gal', m, { name: 'r0123', remote: 1 }, '.vel.bin')).toBe(`${BASE}/n/r01/r0123.vel.bin`);
    // names shorter than the shard keep their whole name as the folder
    expect(nodeFileUrl('tiles/gal', m, { name: 'r', remote: 1 }, '.ext.bin')).toBe(`${BASE}/n/r/r.ext.bin`);
  });

  it('ignores the remote flag when the layer has no remote host', () => {
    const m = parseMeta(full);
    expect(nodeFileUrl('tiles/gal', m, { name: 'r0123', remote: 1 }, '.bin')).toBe('tiles/gal/n/r0123.bin');
  });

  it('rejects a remote host that is not https or a bad shard', () => {
    expect(() => parseMeta({ ...full, remote: { base: 'http://example.org/x', shard: 3 } })).toThrow(/https/);
    expect(() => parseMeta({ ...full, remote: { base: BASE, shard: 0 } })).toThrow(/shard/);
  });
});
