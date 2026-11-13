import { describe, expect, it } from 'vitest';
import { SCALE_TOUR, resolveBeat, resolveTarget, type TourContext } from '../src/tour/tours';

const ctx = (catalog: Record<string, [number, number, number]>): TourContext => ({
  catalog: (names) => names.map((n) => catalog[n]).find(Boolean) ?? null,
  galacticCentre: [8275, 0, 0],
  galaxyEdgePc: () => 2e9,
  lookbackText: (d) => `${(d / 1e9).toFixed(2)} Gpc ago`,
});

describe('tours as data', () => {
  it('resolves catalogue targets at playback, with fallbacks when a catalogue lacks them', () => {
    const p = SCALE_TOUR.beats.find((b) => b.id === 'proxima')!;
    expect(resolveTarget(p.target, ctx({ 'Proxima Centauri': [1, 2, 3] }))).toEqual([1, 2, 3]);
    expect(resolveTarget(p.target, ctx({}))).toEqual([0.9024, -0.9364, -0.0438]);
  });
  it('interpolates between targets and expands templates', () => {
    const lg = SCALE_TOUR.beats.find((b) => b.id === 'local-group')!;
    const r = resolveTarget(lg.target, ctx({ 'Andromeda (M31)': [-100, 0, 0] }));
    expect(r[0]).toBeCloseTo(8275 + (-100 - 8275) * 0.4, 9);
    const web = resolveBeat(SCALE_TOUR.beats.at(-1)!, ctx({}));
    expect(web.dist).toBeCloseTo(2.8e9, 0);
    expect(web.text).toContain('1.80 Gpc ago');
  });
  it('is serialisable plain data', () => {
    expect(JSON.parse(JSON.stringify(SCALE_TOUR))).toEqual(SCALE_TOUR);
  });
});
