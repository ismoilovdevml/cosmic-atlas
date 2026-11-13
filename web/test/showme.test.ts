import { describe, expect, it } from 'vitest';
import { SHOW_ME_TOUR, needsHere, resolveBeat, type TourContext } from '../src/tour/tours';
import { flyTargetForLatLon } from '../src/solar';

const base: TourContext = {
  catalog: () => null,
  galacticCentre: [8275, 0, 0],
  galaxyEdgePc: () => 2.5e9,
  lookbackText: () => '',
  body: () => [1e-6, 2e-6, 3e-6],
};

describe('Show me tour', () => {
  it('goes from the cosmic web down to the viewer, and stays there', () => {
    const ids = SHOW_ME_TOUR.beats.map((b) => b.id);
    expect(ids[0]).toBe('web');
    expect(ids[ids.length - 1]).toBe('here');
    expect(SHOW_ME_TOUR.stayAtEnd).toBe(true);
    const d = SHOW_ME_TOUR.beats.map((b) => (typeof b.dist === 'number' ? b.dist : b.dist.galaxyEdge * 2.5e9));
    for (let i = 1; i < d.length; i++) expect(d[i]).toBeLessThan(d[i - 1]); // always zooming in
  });

  it('drops the location beats when the location is unknown', () => {
    const kept = SHOW_ME_TOUR.beats.filter((b) => !needsHere(b)).map((b) => b.id);
    expect(kept).not.toContain('here');
    expect(kept[kept.length - 1]).toBe('earth');
  });

  it('looks straight down at the viewer location (Tashkent)', () => {
    const date = Date.UTC(2026, 10, 14, 6, 0, 0);
    const v = flyTargetForLatLon(41.31, 69.28, date);
    const ctx: TourContext = { ...base, here: () => ({ focus: v.focus, yaw: v.yaw, pitch: v.pitch }) };
    const beat = SHOW_ME_TOUR.beats.find((b) => b.id === 'here')!;
    const r = resolveBeat(beat, ctx);
    expect(r.focus).toEqual(v.focus);
    expect(r.yaw).toBeCloseTo(v.yaw, 12);
    expect(r.pitch).toBeCloseTo(v.pitch, 12);
    expect(r.dist * 3.0856775814913673e13).toBeCloseTo(1200, 6); // 1,200 km up: city lights resolve at night
  });
});
