/**
 * Solar System bodies shown by the viewer: physical data, names in the three UI languages,
 * docs slugs (docs/content-contract.md §2, §4) and how each is drawn.
 *
 * Sources (cite these in the info card note):
 *   radius_km  IAU WGCCRE 2015 mean radii, Archinal et al. 2018, Celest. Mech. Dyn. Astr. 130, 22
 *              (doi:10.1007/s10569-017-9805-5); the Sun: IAU 2015 Resolution B3 nominal radius.
 *   mass_kg    NASA/GSFC planetary fact sheets (nssdc.gsfc.nasa.gov/planetary/factsheet), and
 *              JPL SSD satellite physical parameters (ssd.jpl.nasa.gov/sats/phys_par) for moons.
 *   period_days sidereal orbital period, same NASA fact sheets (moons: about their planet).
 *   Saturn's rings: C-ring inner edge 74,658 km to A-ring outer edge 136,775 km
 *              (NASA Saturnian rings fact sheet).
 *
 * Textures (web/public/solar/, resized to <= 1024 px; Earth 2048 px + 4096 px on demand):
 *   Solar System Scope (www.solarsystemscope.com/textures), CC BY 4.0, checked 2026-11-13:
 *     sun, mercury, venus (atmosphere), moon, mars, jupiter, saturn, saturn ring, uranus, neptune.
 *   Earth: NASA Blue Marble Next Generation, topography + bathymetry, July 2004
 *     (world.topo.bathy.200407.3x5400x2700.jpg), NASA Earth Observatory; NASA media are not
 *     subject to copyright in the US, credit NASA.
 *   Pluto and the Galilean moons have no licensed texture here: procedural colouring.
 */

import { Body } from 'astronomy-engine';

export type BodyId =
  | 'sun' | 'mercury' | 'venus' | 'earth' | 'moon' | 'mars' | 'jupiter' | 'saturn' | 'uranus' | 'neptune' | 'pluto'
  | 'io' | 'europa' | 'ganymede' | 'callisto';

export type SolarKind = 'sun' | 'planet' | 'dwarf_planet' | 'moon';

export interface Names {
  en: string;
  uz: string;
  ru: string;
}

export interface BodyDef {
  id: BodyId;
  kind: SolarKind;
  names: Names;
  /** docs article slug (content contract slug list v1) */
  docs: string;
  /** parent body for moons; planets orbit the Sun */
  parent: BodyId | null;
  radiusKm: number;
  massKg: number;
  /** sidereal orbital period in days (about the parent); undefined for the Sun */
  periodDays?: number;
  /** astronomy-engine body for heliocentric vectors / rotation axis (none for the Galilean moons) */
  ae?: Body;
  /** texture file under public/solar/, or procedural colours */
  texture?: string;
  /** base colour (sRGB hex): procedural surface and the far-away dot */
  color: string;
  /** second colour for procedural mottling */
  color2?: string;
  /** emissive (the Sun) */
  emissive?: boolean;
  rings?: { innerKm: number; outerKm: number; texture: string };
}

export const BODIES: BodyDef[] = [
  { id: 'sun', kind: 'sun', names: { en: 'Sun', uz: 'Quyosh', ru: 'Солнце' }, docs: 'sun', parent: null,
    radiusKm: 695700, massKg: 1.9885e30, ae: Body.Sun, texture: 'sun.jpg', color: '#ffd27a', emissive: true },
  { id: 'mercury', kind: 'planet', names: { en: 'Mercury', uz: 'Merkuriy', ru: 'Меркурий' }, docs: 'mercury', parent: null,
    radiusKm: 2439.4, massKg: 3.3010e23, periodDays: 87.969, ae: Body.Mercury, texture: 'mercury.jpg', color: '#a39e99' },
  { id: 'venus', kind: 'planet', names: { en: 'Venus', uz: 'Venera', ru: 'Венера' }, docs: 'venus', parent: null,
    radiusKm: 6051.8, massKg: 4.8673e24, periodDays: 224.701, ae: Body.Venus, texture: 'venus.jpg', color: '#e8d7a8' },
  { id: 'earth', kind: 'planet', names: { en: 'Earth', uz: 'Yer', ru: 'Земля' }, docs: 'earth', parent: null,
    radiusKm: 6371.0084, massKg: 5.9722e24, periodDays: 365.256, ae: Body.Earth, texture: 'earth_2048.jpg', color: '#6f93c8' },
  { id: 'moon', kind: 'moon', names: { en: 'Moon', uz: 'Oy', ru: 'Луна' }, docs: 'moon', parent: 'earth',
    radiusKm: 1737.4, massKg: 7.346e22, periodDays: 27.3217, ae: Body.Moon, texture: 'moon.jpg', color: '#b8b5ae' },
  { id: 'mars', kind: 'planet', names: { en: 'Mars', uz: 'Mars', ru: 'Марс' }, docs: 'mars', parent: null,
    radiusKm: 3389.5, massKg: 6.4169e23, periodDays: 686.980, ae: Body.Mars, texture: 'mars.jpg', color: '#c87a50' },
  { id: 'jupiter', kind: 'planet', names: { en: 'Jupiter', uz: 'Yupiter', ru: 'Юпитер' }, docs: 'jupiter', parent: null,
    radiusKm: 69911, massKg: 1.89813e27, periodDays: 4332.589, ae: Body.Jupiter, texture: 'jupiter.jpg', color: '#d9b98f' },
  { id: 'saturn', kind: 'planet', names: { en: 'Saturn', uz: 'Saturn', ru: 'Сатурн' }, docs: 'saturn', parent: null,
    radiusKm: 58232, massKg: 5.6832e26, periodDays: 10759.22, ae: Body.Saturn, texture: 'saturn.jpg', color: '#e3cf9e',
    rings: { innerKm: 74658, outerKm: 136775, texture: 'saturn_ring.png' } },
  { id: 'uranus', kind: 'planet', names: { en: 'Uranus', uz: 'Uran', ru: 'Уран' }, docs: 'uranus', parent: null,
    radiusKm: 25362, massKg: 8.6811e25, periodDays: 30685.4, ae: Body.Uranus, texture: 'uranus.jpg', color: '#a9d8e0' },
  { id: 'neptune', kind: 'planet', names: { en: 'Neptune', uz: 'Neptun', ru: 'Нептун' }, docs: 'neptune', parent: null,
    radiusKm: 24622, massKg: 1.02409e26, periodDays: 60189, ae: Body.Neptune, texture: 'neptune.jpg', color: '#5b7fd6' },
  { id: 'pluto', kind: 'dwarf_planet', names: { en: 'Pluto', uz: 'Pluton', ru: 'Плутон' }, docs: 'pluto', parent: null,
    radiusKm: 1188.3, massKg: 1.303e22, periodDays: 90560, ae: Body.Pluto, color: '#c9b49a', color2: '#7a5a46' },
  // Galilean moons: jovicentric positions from astronomy-engine JupiterMoons(); no docs article of their own yet
  { id: 'io', kind: 'moon', names: { en: 'Io', uz: 'Io', ru: 'Ио' }, docs: 'jupiter', parent: 'jupiter',
    radiusKm: 1821.49, massKg: 8.931938e22, periodDays: 1.769138, color: '#e6d36a', color2: '#b5662e' },
  { id: 'europa', kind: 'moon', names: { en: 'Europa', uz: 'Yevropa', ru: 'Европа' }, docs: 'jupiter', parent: 'jupiter',
    radiusKm: 1560.8, massKg: 4.799844e22, periodDays: 3.551181, color: '#e9e1d0', color2: '#a07a5a' },
  { id: 'ganymede', kind: 'moon', names: { en: 'Ganymede', uz: 'Ganimed', ru: 'Ганимед' }, docs: 'jupiter', parent: 'jupiter',
    radiusKm: 2631.2, massKg: 1.48187e23, periodDays: 7.154553, color: '#a89f92', color2: '#5e554b' },
  { id: 'callisto', kind: 'moon', names: { en: 'Callisto', uz: 'Kallisto', ru: 'Каллисто' }, docs: 'jupiter', parent: 'jupiter',
    radiusKm: 2410.3, massKg: 1.075938e23, periodDays: 16.689018, color: '#7c7266', color2: '#3d3631' },
];

/** moons the request asked for that astronomy-engine cannot place (listed, not drawn) */
export const NOT_SHOWN: { names: Names; reason: string }[] = [
  { names: { en: 'Phobos', uz: 'Fobos', ru: 'Фобос' }, reason: 'no ephemeris in astronomy-engine 2.1.19' },
  { names: { en: 'Deimos', uz: 'Deymos', ru: 'Деймос' }, reason: 'no ephemeris in astronomy-engine 2.1.19' },
];

export interface CraftNames {
  horizonsId: number;
  names: Names;
}

/** spacecraft names (positions come from data/tiles/catalogs/spacecraft.json) */
export const CRAFT_NAMES: CraftNames[] = [
  { horizonsId: -31, names: { en: 'Voyager 1', uz: 'Voyager 1', ru: 'Вояджер-1' } },
  { horizonsId: -32, names: { en: 'Voyager 2', uz: 'Voyager 2', ru: 'Вояджер-2' } },
  { horizonsId: -23, names: { en: 'Pioneer 10', uz: 'Pioneer 10', ru: 'Пионер-10' } },
  { horizonsId: -24, names: { en: 'Pioneer 11', uz: 'Pioneer 11', ru: 'Пионер-11' } },
  { horizonsId: -98, names: { en: 'New Horizons', uz: 'New Horizons', ru: 'Новые горизонты' } },
];

export const KM_PER_AU = 149597870.7;
export const BODY_BY_ID = new Map(BODIES.map((b) => [b.id, b]));
