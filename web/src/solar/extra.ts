/**
 * Shared shape of the Solar System's extra layers (asteroids + comets, Earth satellites): what
 * layer.ts needs to drive them per frame, pick them, label them and route their info cards, and
 * what main.ts needs for the layers panel (layers.json entries of type "small-bodies" / "satellites").
 */

import type * as THREE from 'three/webgpu';
import type { SolarExtraLayerConfig } from '../data/manifest';
import type { Vec3 } from '../math/frames';
import type { LabelItem } from '../render/labels';
import type { SolarEntry } from './layer';

/** a layers.json entry of type "small-bodies" or "satellites" (data/manifest.ts) */
export type ExtraLayerConfig = SolarExtraLayerConfig;

export interface ExtraCtx {
  cam: Vec3;
  /** simulation time, ms UTC */
  ms: number;
  camera: THREE.PerspectiveCamera;
  pxPerRad: number;
  focusDist: number;
  dpr: number;
  width: number;
  height: number;
  /** the Solar System layer's fade (distance from the Sun x opacity) */
  fade: number;
  earth: Vec3;
  /** true when the simulation time changed since the last frame */
  timeChanged: boolean;
}

export interface ExtraInfo {
  kind: string;
  title: string;
  rows: [string, string][];
  note: string;
  docs: string;
}

export interface SolarExtra {
  readonly cfg: ExtraLayerConfig;
  readonly group: THREE.Group;
  readonly entries: SolarEntry[];
  readonly labelItems: LabelItem[];
  visible: boolean;
  opacity: number;
  /** resolves when the search entries are in (small files, fetched at start) */
  readonly ready: Promise<void>;
  /** one line for the layers panel */
  metaText(): string;
  /** per frame; true when the picture changed */
  update(c: ExtraCtx): boolean;
  /** an entry of this layer under the cursor (css px), with its distance to the cursor */
  pickAt(x: number, y: number, c: ExtraCtx): { e: SolarEntry; d: number } | null;
  /** live position (pc, contract frame) of one of this layer's entries at `ms` */
  positionAt(e: SolarEntry, ms: number, out?: Vec3): Vec3 | null;
  info(e: SolarEntry, ms: number, earth: Vec3): ExtraInfo;
  viewFor(e: SolarEntry, ms: number, earth: Vec3): { focus: Vec3; dist: number; yaw: number; pitch: number };
  /** selected entry (orbit line / marker), or null */
  select(e: SolarEntry | null): void;
}
