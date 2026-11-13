/**
 * Tours are plain data: beats whose targets are durable references (a catalogue name, the Sun,
 * the Galactic Centre, a point between two targets) resolved when the tour PLAYS, so a tour
 * survives catalogue rebuilds (idea from skymap's Tour type, MIT, re-implemented). The runner in
 * main.ts snapshots the scene (camera, layer visibility, selection) and restores it afterwards.
 */

import { t } from '../i18n';
import type { Vec3 } from '../math/frames';

export type TargetRef =
  | { sun: true }
  | { gc: true }
  | { catalog: string[]; fallback: Vec3 }
  | { xyz: Vec3 }
  /** a Solar System body by id ('earth', 'mars', ...), at its position when the beat plays */
  | { body: string; fallback: Vec3 }
  | { between: [TargetRef, TargetRef]; t: number };

/** a fixed distance (pc) or a multiple of the outer edge of the active galaxy layers */
export type DistRef = number | { galaxyEdge: number };

export interface Beat {
  id: string;
  target: TargetRef;
  dist: DistRef;
  pitchDeg: number;
  yawDeg?: number;
  /** i18n key of the caption title */
  title: string;
  /** i18n key of the caption text; the message may use {edgeLookback}: lookback time to 90 % of the galaxy edge */
  text: string;
  dwellMs: number;
  /** layer ids that must be visible during this beat (restored afterwards) */
  show?: string[];
  /** look at the target from its day side: yaw = Sun direction + yawDeg (default 0) */
  sunSide?: boolean;
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
  /** live position of a Solar System body (null if the Solar System layer is absent) */
  body?(id: string): Vec3 | null;
}

export function resolveTarget(t: TargetRef, ctx: TourContext): Vec3 {
  if ('sun' in t) return [0, 0, 0];
  if ('gc' in t) return [...ctx.galacticCentre] as Vec3;
  if ('xyz' in t) return [...t.xyz] as Vec3;
  if ('catalog' in t) return ctx.catalog(t.catalog) ?? ([...t.fallback] as Vec3);
  if ('body' in t) return ctx.body?.(t.body) ?? ([...t.fallback] as Vec3);
  const a = resolveTarget(t.between[0], ctx);
  const b = resolveTarget(t.between[1], ctx);
  return [a[0] + (b[0] - a[0]) * t.t, a[1] + (b[1] - a[1]) * t.t, a[2] + (b[2] - a[2]) * t.t];
}

export function resolveBeat(b: Beat, ctx: TourContext) {
  const edge = ctx.galaxyEdgePc();
  const dist = typeof b.dist === 'number' ? b.dist : b.dist.galaxyEdge * edge;
  const focus = resolveTarget(b.target, ctx);
  let yaw = b.yawDeg !== undefined ? (b.yawDeg * Math.PI) / 180 : undefined;
  if (b.sunSide && Math.hypot(focus[0], focus[1]) > 0) yaw = Math.atan2(-focus[1], -focus[0]) + (yaw ?? 0);
  return {
    focus,
    dist,
    pitch: (b.pitchDeg * Math.PI) / 180,
    yaw,
    title: t(b.title),
    text: t(b.text, { edgeLookback: ctx.lookbackText(edge * 0.9) }),
  };
}

export const SCALE_TOUR: Tour = {
  id: 'scale',
  label: 'tour.scale.label',
  beats: [
    {
      id: 'sun', target: { sun: true }, dist: 1e-3, pitchDeg: 20, dwellMs: 3000, title: 'tour.scale.sun.title',
      text: 'tour.scale.sun.text',
    },
    // Earth -> Mars -> Jupiter, at their real positions when the tour plays (Solar System layer)
    {
      id: 'earth', target: { body: 'earth', fallback: [0, 0, 0] }, dist: 2.6e-8, pitchDeg: 25, yawDeg: 40, sunSide: true,
      dwellMs: 3600, title: 'tour.scale.earth.title', show: ['solar'],
      text: 'tour.scale.earth.text',
    },
    {
      id: 'mars', target: { body: 'mars', fallback: [0, 0, 0] }, dist: 5.5e-10, pitchDeg: 15, yawDeg: 35, sunSide: true,
      dwellMs: 3400, title: 'tour.scale.mars.title', show: ['solar'],
      text: 'tour.scale.mars.text',
    },
    {
      id: 'jupiter', target: { body: 'jupiter', fallback: [0, 0, 0] }, dist: 1.3e-7, pitchDeg: 20, yawDeg: 30, sunSide: true,
      dwellMs: 3800, title: 'tour.scale.jupiter.title', show: ['solar'],
      text: 'tour.scale.jupiter.text',
    },
    {
      id: 'proxima', target: { catalog: ['Proxima Centauri', 'Proxima Cen', 'alf Cen C'], fallback: [0.9024, -0.9364, -0.0438] },
      dist: 1.6, pitchDeg: 17, dwellMs: 3200, title: 'tour.scale.proxima.title',
      text: 'tour.scale.proxima.text',
    },
    {
      id: 'neighbourhood', target: { sun: true }, dist: 3200, pitchDeg: 26, dwellMs: 3800, title: 'tour.scale.neighbourhood.title',
      text: 'tour.scale.neighbourhood.text',
    },
    {
      id: 'milky-way', target: { gc: true }, dist: 7e4, pitchDeg: 87.5, dwellMs: 4200, title: 'tour.scale.milky-way.title', show: ['milky-way-model'],
      text: 'tour.scale.milky-way.text',
    },
    {
      id: 'local-group',
      target: { between: [{ gc: true }, { catalog: ['Andromeda (M31)', 'M31', 'Andromeda Galaxy'], fallback: [-368258, 608681, -281281] }], t: 0.4 },
      dist: 2.6e6, pitchDeg: 29, dwellMs: 3600, title: 'tour.scale.local-group.title',
      text: 'tour.scale.local-group.text',
    },
    {
      id: 'cosmic-web', target: { sun: true }, dist: { galaxyEdge: 1.4 }, pitchDeg: 29, dwellMs: 4500, title: 'tour.scale.cosmic-web.title',
      text: 'tour.scale.cosmic-web.text',
    },
  ],
};
