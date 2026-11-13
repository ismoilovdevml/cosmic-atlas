/**
 * Tours are plain data: beats whose targets are durable references (a catalogue name, the Sun,
 * the Galactic Centre, a point between two targets) resolved when the tour PLAYS, so a tour
 * survives catalogue rebuilds (idea from skymap's Tour type, MIT, re-implemented). The runner in
 * main.ts snapshots the scene (camera, layer visibility, selection) and restores it afterwards.
 */

import type { Vec3 } from '../math/frames';

export type TargetRef =
  | { sun: true }
  | { gc: true }
  | { catalog: string[]; fallback: Vec3 }
  | { xyz: Vec3 }
  | { between: [TargetRef, TargetRef]; t: number };

/** a fixed distance (pc) or a multiple of the outer edge of the active galaxy layers */
export type DistRef = number | { galaxyEdge: number };

export interface Beat {
  id: string;
  target: TargetRef;
  dist: DistRef;
  pitchDeg: number;
  yawDeg?: number;
  title: string;
  /** may contain {edgeLookback}: lookback time to 90 % of the galaxy edge */
  text: string;
  dwellMs: number;
  /** layer ids that must be visible during this beat (restored afterwards) */
  show?: string[];
}

export interface Tour {
  id: string;
  label: string;
  beats: Beat[];
}

export interface TourContext {
  catalog(names: string[]): Vec3 | null;
  galacticCentre: Vec3;
  galaxyEdgePc(): number;
  lookbackText(dPc: number): string;
}

export function resolveTarget(t: TargetRef, ctx: TourContext): Vec3 {
  if ('sun' in t) return [0, 0, 0];
  if ('gc' in t) return [...ctx.galacticCentre] as Vec3;
  if ('xyz' in t) return [...t.xyz] as Vec3;
  if ('catalog' in t) return ctx.catalog(t.catalog) ?? ([...t.fallback] as Vec3);
  const a = resolveTarget(t.between[0], ctx);
  const b = resolveTarget(t.between[1], ctx);
  return [a[0] + (b[0] - a[0]) * t.t, a[1] + (b[1] - a[1]) * t.t, a[2] + (b[2] - a[2]) * t.t];
}

export function resolveBeat(b: Beat, ctx: TourContext) {
  const edge = ctx.galaxyEdgePc();
  const dist = typeof b.dist === 'number' ? b.dist : b.dist.galaxyEdge * edge;
  return {
    focus: resolveTarget(b.target, ctx),
    dist,
    pitch: (b.pitchDeg * Math.PI) / 180,
    yaw: b.yawDeg !== undefined ? (b.yawDeg * Math.PI) / 180 : undefined,
    title: b.title,
    text: b.text.replace('{edgeLookback}', ctx.lookbackText(edge * 0.9)),
  };
}

export const SCALE_TOUR: Tour = {
  id: 'scale',
  label: 'Scale tour',
  beats: [
    {
      id: 'sun', target: { sun: true }, dist: 1e-3, pitchDeg: 20, dwellMs: 3000, title: 'The Sun',
      text: 'Home. This view is about 200 AU across; the nearest star is 270,000 times farther than the Earth is from the Sun.',
    },
    {
      id: 'proxima', target: { catalog: ['Proxima Centauri', 'Proxima Cen', 'alf Cen C'], fallback: [0.9024, -0.9364, -0.0438] },
      dist: 1.6, pitchDeg: 17, dwellMs: 3200, title: 'Proxima Centauri',
      text: 'The nearest star, 1.30 pc away. Its light takes 4.2 years to reach us.',
    },
    {
      id: 'neighbourhood', target: { sun: true }, dist: 3200, pitchDeg: 26, dwellMs: 3800, title: 'The solar neighbourhood',
      text: 'Stars within 1 kpc of the Sun, the reach of Gaia parallaxes in this map. Light crosses it in about 6,500 years.',
    },
    {
      id: 'milky-way', target: { gc: true }, dist: 7e4, pitchDeg: 87.5, dwellMs: 4200, title: 'The Milky Way', show: ['milky-way-model'],
      text: 'Our galaxy seen face-on. This is a model of the spiral arms (Reid et al. 2019), not data. The Sun sits 8.3 kpc from the centre.',
    },
    {
      id: 'local-group',
      target: { between: [{ gc: true }, { catalog: ['Andromeda (M31)', 'M31', 'Andromeda Galaxy'], fallback: [-368258, 608681, -281281] }], t: 0.4 },
      dist: 2.6e6, pitchDeg: 29, dwellMs: 3600, title: 'The Local Group',
      text: 'The Milky Way, Andromeda and their satellites, about 3 Mpc across.',
    },
    {
      id: 'cosmic-web', target: { sun: true }, dist: { galaxyEdge: 1.4 }, pitchDeg: 29, dwellMs: 4500, title: 'The cosmic web',
      text: 'Galaxies trace filaments around empty voids. Light from the far side of this view left {edgeLookback}.',
    },
  ],
};
