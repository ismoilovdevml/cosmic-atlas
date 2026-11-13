import { describe, expect, it } from 'vitest';
import type { CatalogEntry } from '../src/data/manifest';
import { normName, searchCatalog } from '../src/data/resolve';
import { BODIES, CRAFT_NAMES } from '../src/solar/bodies';
import { SCALE_TOUR, resolveBeat, type TourContext } from '../src/tour/tours';

// the same shape SolarSystem puts into the search catalogue: English name + Uzbek/Russian aliases
const entries: CatalogEntry[] = [
  ...BODIES.map((b) => ({ name: b.names.en, alt: [b.names.uz, b.names.ru].filter((n) => n !== b.names.en), kind: b.kind, dist_pc: 1e-5, xyz: [0, 0, 0] as [number, number, number] })),
  ...CRAFT_NAMES.map((c) => ({ name: c.names.en, alt: [c.names.uz, c.names.ru].filter((n) => n !== c.names.en), kind: 'spacecraft', dist_pc: 1e-3, xyz: [0, 0, 0] as [number, number, number] })),
];

describe('Solar System search in three languages', () => {
  const top = (q: string) => searchCatalog(entries, q)[0]?.entry.name;
  it.each([
    ['Mars', 'Mars'], ['Марс', 'Mars'], ['Earth', 'Earth'], ['Yer', 'Earth'], ['Земля', 'Earth'],
    ['Moon', 'Moon'], ['Oy', 'Moon'], ['Луна', 'Moon'], ['Quyosh', 'Sun'], ['Солнце', 'Sun'], ['Yupiter', 'Jupiter'],
    ['Юпитер', 'Jupiter'], ['Ganimed', 'Ganymede'], ['Вояджер-1', 'Voyager 1'], ['Новые горизонты', 'New Horizons'],
  ])('%s -> %s', (q, name) => {
    expect(top(q)).toBe(name);
  });
  it('normalises any script, drops diacritics and the Uzbek modifier letters', () => {
    expect(normName('Марс')).toBe('марс');
    expect(normName('Oʻzbekiston')).toBe(normName("O'zbekiston"));
    expect(normName('Café')).toBe('cafe');
    expect(normName('M 31')).toBe('m31');
  });
});

describe('scale tour: Earth -> Mars -> Jupiter', () => {
  const ctx: TourContext = {
    catalog: () => null, galacticCentre: [8275, 0, 0], galaxyEdgePc: () => 2e9, lookbackText: () => '',
    body: (id) => ({ earth: [3e-6, 4e-6, 0], mars: [-5e-6, 0, 1e-6], jupiter: [0, 2.5e-5, 0] } as Record<string, [number, number, number]>)[id] ?? null,
  };
  it('has the three beats after the Sun, resolved at playback and seen from the day side', () => {
    const ids = SCALE_TOUR.beats.map((b) => b.id);
    expect(ids.slice(0, 4)).toEqual(['sun', 'earth', 'mars', 'jupiter']);
    const e = resolveBeat(SCALE_TOUR.beats[1], ctx);
    expect(e.focus).toEqual([3e-6, 4e-6, 0]);
    // camera direction = toward the Sun (+ the beat's yaw offset)
    expect(e.yaw).toBeCloseTo(Math.atan2(-4e-6, -3e-6) + (40 * Math.PI) / 180, 12);
    for (const b of SCALE_TOUR.beats.slice(1, 4)) expect(b.show).toContain('solar');
  });
});
