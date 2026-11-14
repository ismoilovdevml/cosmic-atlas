import { describe, expect, it } from 'vitest';
import {
  CLUSTER_RADIUS_PX, KIND_CAPS, MIN_CLUSTER, SPACING_MAX_PX, isNotable, labelFamily, labelImportance, selectLabels, spacingPx,
  type LabelCand, type LabelItem,
} from '../src/render/labels';

const W = 1440;
const H = 900;
let seq = 0;
function cand(kind: string, x: number, y: number, extra: Partial<LabelItem> & { rank?: number; shown?: boolean; w?: number; app?: number | null } = {}): LabelCand {
  const it: LabelItem = { name: extra.name ?? `${kind}-${seq++}`, xyz: [0, 0, 0], kind, absMag: null, ...extra };
  return { it, x, y, rank: extra.rank ?? 0, importance: labelImportance(it, extra.app ?? null), w: extra.w ?? 60, shown: extra.shown ?? false };
}
const opts = { width: W, height: H, occluders: [] };
const names = (s: Set<LabelItem>) => [...s].map((i) => i.name).sort();

describe('label declutter (selectLabels)', () => {
  it('keeps the padded-box rule: overlapping labels are not both accepted', () => {
    const a = cand('star', 100, 100, { name: 'a', rank: 0, app: 0 });
    const b = cand('star', 130, 104, { name: 'b', rank: 1, app: 0 });
    const r = selectLabels([b, a], opts);
    expect(names(r.accepted)).toEqual(['a']);
  });

  it('caps each kind family per view (pulsars 4 at 1440 x 900)', () => {
    const cs = Array.from({ length: 30 }, (_, i) => cand('pulsar', 40 + (i % 6) * 230, 40 + Math.floor(i / 6) * 170, { rank: i }));
    const r = selectLabels(cs, { ...opts, cluster: false });
    expect(r.accepted.size).toBe(KIND_CAPS.pulsar);
    // the best-ranked ones win
    expect([...r.accepted].every((it) => cs.findIndex((c) => c.it === it) < 8)).toBe(true);
  });

  it('caps scale with the viewport (sqrt of area, clamped)', () => {
    const cs = Array.from({ length: 40 }, (_, i) => cand('pulsar', 40 + (i % 8) * 300, 40 + Math.floor(i / 8) * 250, { rank: i }));
    const big = selectLabels(cs, { width: 2560, height: 1440, occluders: [], cluster: false });
    expect(big.accepted.size).toBe(Math.round(KIND_CAPS.pulsar * 1.4));
  });

  it('spacing grows as importance falls: anonymous pulsars keep ~80 px apart, bright stars may sit close', () => {
    expect(spacingPx(1)).toBe(0);
    expect(spacingPx(0)).toBe(SPACING_MAX_PX);
    const p1 = cand('pulsar', 100, 100, { rank: 0 });
    const p2 = cand('pulsar', 100, 160, { rank: 1 }); // 60 px below: boxes do not touch, spacing does
    expect(selectLabels([p1, p2], { ...opts, cluster: false }).accepted.size).toBe(1);
    const s1 = cand('star', 100, 100, { rank: 0, app: -1 });
    const s2 = cand('star', 100, 160, { rank: 1, app: 0 });
    expect(selectLabels([s1, s2], { ...opts, cluster: false }).accepted.size).toBe(2);
  });

  it('notable names rank above anonymous ones of the same kind', () => {
    expect(isNotable({ name: 'PSR J0534+2200', alt: ['PSR B0531+21', 'Crab Pulsar', 'NP 0532'] })).toBe(true);
    expect(isNotable({ name: 'PSR J0002+6216', alt: [] })).toBe(false);
    expect(isNotable({ name: 'NGC 6960', alt: [] })).toBe(false);
    expect(isNotable({ name: 'G1.9+0.3', alt: [] })).toBe(false);
    expect(isNotable({ name: 'SGR 1806-20', alt: [] })).toBe(false);
    expect(isNotable({ name: 'Sgr A*', docs: 'sgr-a-star' })).toBe(true);
    expect(isNotable({ name: 'Cassiopeia A' })).toBe(true);
    const anon = cand('pulsar', 100, 100);
    const crab = cand('pulsar', 400, 100, { notable: true });
    expect(crab.importance).toBeGreaterThan(anon.importance);
  });

  it('model / context labels win at their scale, even over a catalogue label already on screen', () => {
    const shown = cand('pulsar', 100, 100, { name: 'shown', rank: -5, shown: true });
    const arm = cand('model', 110, 102, { name: 'Norma arm', rank: -20 });
    const r = selectLabels([shown, arm], opts);
    expect(names(r.accepted)).toEqual(['Norma arm']);
  });

  it('a label already on screen wins a tie with a newcomer (stable layout)', () => {
    const a = cand('star', 100, 100, { name: 'old', rank: 2, app: 1, shown: true });
    const b = cand('star', 120, 100, { name: 'new', rank: 1, app: 0 });
    expect(names(selectLabels([a, b], opts).accepted)).toEqual(['old']);
  });

  it('the You are here pin always wins: no overlap test, no limit, others avoid it', () => {
    const occ = [{ x0: 0, x1: W, y0: 0, y1: H }]; // a panel over everything
    const pin = cand('here', 500, 400, { name: 'You are here', rank: -60 });
    const earth = cand('planet', 505, 400, { name: 'Earth', rank: -40, shown: true });
    const r = selectLabels([earth, pin], { ...opts, occluders: occ });
    expect(names(r.accepted)).toEqual(['You are here']);
    const r2 = selectLabels([earth, pin], opts);
    expect(names(r2.accepted)).toEqual(['You are here']);
  });

  it('Solar System labels keep the plain box rule: no caps, no spacing, no badges', () => {
    const moons = Array.from({ length: 8 }, (_, i) => cand('moon', 100, 30 + i * 40, { name: `moon${i}`, rank: i }));
    const r = selectLabels(moons, opts);
    expect(r.accepted.size).toBe(8); // 40 px apart vertically: boxes (18 + 2·8 px tall) clear, spacing ignored
    expect(r.badges).toEqual([]);
  });

  it('left-out same-kind labels near each other become one badge with their count', () => {
    const cs = Array.from({ length: 12 }, (_, i) => cand('pulsar', 600 + (i % 4) * 12, 400 + Math.floor(i / 4) * 12, { name: `p${i}`, rank: i }));
    const r = selectLabels(cs, { ...opts, badgeWidth: () => 80 });
    expect(r.accepted.size).toBe(1); // the best one; spacing rejects the rest
    expect(r.badges.length).toBe(1);
    expect(r.badges[0].family).toBe('pulsar');
    expect(r.badges[0].members.length).toBe(11);
    expect(r.badges[0].key).toBe('pulsar:p1'); // keyed by its best-ranked member: stable while moving
  });

  it('badges need MIN_CLUSTER members within CLUSTER_RADIUS_PX, of one family', () => {
    const lonely = [cand('pulsar', 100, 100, { rank: 0 }), cand('pulsar', 700, 100, { rank: 1 }), cand('pulsar', 100, 700, { rank: 2 })];
    expect(selectLabels(lonely, opts).badges).toEqual([]);
    // two families in one spot: neither has enough members alone
    const mixed = [cand('snr', 300, 300, { rank: 0 }), ...[1, 2].map((i) => cand('snr', 300 + i * 5, 300, { rank: i })),
      ...[3, 4].map((i) => cand('nebula', 300, 300 + i * 5, { rank: i }))];
    const r = selectLabels(mixed, opts);
    expect(r.badges.map((b) => [b.family, b.members.length])).toEqual([]);
    expect(MIN_CLUSTER).toBe(4);
    const far = Array.from({ length: 4 }, (_, i) => cand('pulsar', 100 + i * (CLUSTER_RADIUS_PX + 40), 500, { rank: i }));
    expect(selectLabels(far, opts).badges).toEqual([]);
  });

  it('a badge does not cover an accepted label', () => {
    const star = cand('star', 600, 400, { name: 'Antares', rank: -10, app: 1, w: 70 });
    const cs = Array.from({ length: 6 }, (_, i) => cand('pulsar', 640 + i * 3, 402, { rank: i }));
    const r = selectLabels([star, ...cs], { ...opts, badgeWidth: () => 80 });
    expect(r.accepted.has(star.it)).toBe(true);
    for (const b of r.badges) expect(b.x - 8 >= 600 + 70 + 8 || b.x + 80 + 8 <= 600 - 8 || Math.abs(b.y - 400) >= 34).toBe(true);
  });

  it('families come from the kind registry (sub-kinds fold in)', () => {
    expect(labelFamily('open_cluster')).toBe('cluster');
    expect(labelFamily('planetary_nebula')).toBe('nebula');
    expect(labelFamily('supernova_remnant')).toBe('snr');
    expect(labelFamily('pulsar')).toBe('pulsar');
  });

  it('GC-like crowd: 600 pulsars + 80 SNRs + 60 nebulae stay under the caps, the rest are badges', () => {
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const cs: LabelCand[] = [];
    for (let i = 0; i < 600; i++) cs.push(cand('pulsar', 520 + rnd() * 400, 300 + rnd() * 300, { rank: rnd() * 2 }));
    for (let i = 0; i < 80; i++) cs.push(cand('snr', 520 + rnd() * 400, 300 + rnd() * 300, { rank: rnd() * 2 }));
    for (let i = 0; i < 60; i++) cs.push(cand('nebula', 520 + rnd() * 400, 300 + rnd() * 300, { rank: rnd() * 2 }));
    const r = selectLabels(cs, { ...opts, badgeWidth: () => 90 });
    const fam = (f: string) => [...r.accepted].filter((it) => labelFamily(it.kind) === f).length;
    expect(fam('pulsar')).toBeLessThanOrEqual(KIND_CAPS.pulsar);
    expect(fam('snr')).toBeLessThanOrEqual(KIND_CAPS.snr);
    expect(fam('nebula')).toBeLessThanOrEqual(KIND_CAPS.nebula);
    expect(r.badges.length).toBeGreaterThan(0);
    expect(r.badges.length).toBeLessThanOrEqual(6);
    // accepted label anchors respect the spacing of the later (less important or equal) label
    const acc = cs.filter((c) => r.accepted.has(c.it));
    for (let i = 0; i < acc.length; i++) for (let j = i + 1; j < acc.length; j++) {
      expect(Math.hypot(acc[i].x - acc[j].x, acc[i].y - acc[j].y)).toBeGreaterThanOrEqual(Math.min(spacingPx(acc[i].importance), spacingPx(acc[j].importance)) - 1e-9);
    }
  });
});
