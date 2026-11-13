/**
 * CPU twin of the distance-uncertainty streak placement in pointMaterial.ts (uncMaterial).
 *
 * Each point becomes the unit quad (PlaneGeometry corners x, y in [-0.5, 0.5]) mapped to screen
 * px around the point: the quad's y axis runs along the projected line of sight from the dist_lo
 * end to the dist_hi end, its x axis across it. The across axis must be dir rotated by −90°,
 * perp = (dir.y, −dir.x): then (x, y) → x·perp + y·dir is a rotation (det +1) and keeps the quad's
 * counter-clockwise winding. With perp = (−dir.y, dir.x) the map is a reflection (det −1), every
 * streak turns clockwise and a FrontSide material culls all of them (the mode drew nothing on
 * either backend before this was fixed).
 */

export type V2 = [number, number];

/** unit vector along lo → hi in screen px, (1, 0) for a degenerate segment */
export function streakDir(sLo: V2, sHi: V2): V2 {
  const dx = sHi[0] - sLo[0];
  const dy = sHi[1] - sLo[1];
  const len = Math.hypot(dx, dy);
  return len > 1e-3 ? [dx / len, dy / len] : [1, 0];
}

/** across-the-streak axis: dir rotated by −90° (see header) */
export function streakPerp(dir: V2): V2 {
  return [dir[1], -dir[0]];
}

/** screen-px offset (from the point) of quad corner (x, y) for a streak lo → hi of width w px */
export function streakCorner(sLo: V2, sHi: V2, w: number, x: number, y: number): V2 {
  const dir = streakDir(sLo, sHi);
  const perp = streakPerp(dir);
  const along = y + 0.5;
  return [
    sLo[0] + (sHi[0] - sLo[0]) * along + dir[0] * y * w + perp[0] * x * w,
    sLo[1] + (sHi[1] - sLo[1]) * along + dir[1] * y * w + perp[1] * x * w,
  ];
}
