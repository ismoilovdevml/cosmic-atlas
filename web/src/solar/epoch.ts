/**
 * Star epoch: how far from "now" the star layers are shown, Δt in Myr (+ = future). Stars move on
 * straight lines with their measured space velocities (tiles `.vel.bin`, docs/data-contract.md §3);
 * the Solar System clock (clock.ts) is separate, because planetary ephemerides mean nothing at kyr.
 *
 * The slider is logarithmic in |Δt| on both sides of a "now" dead zone:
 *   p ∈ [−SLIDER_MAX, SLIDER_MAX], |p| ≤ DEAD → 0, else |Δt| = 10^(log10 MIN_YR + (|p|−DEAD)/(SLIDER_MAX−DEAD) · decades)
 * so 100 yr … 1 Myr each get an equal share of the track.
 */

export const SLIDER_MAX = 1000;
export const SLIDER_DEAD = 16;
/** smallest non-zero |Δt| on the slider, years */
export const MIN_YR = 100;
/** largest |Δt|, years: linear motion is not trustworthy much beyond this (Bailer-Jones 2015) */
export const MAX_YR = 1e6;
const DECADES = Math.log10(MAX_YR / MIN_YR);

/** slider position → Δt in Myr */
export function sliderToMyr(p: number): number {
  const a = Math.abs(p);
  if (!(a > SLIDER_DEAD)) return 0;
  const f = Math.min(1, (a - SLIDER_DEAD) / (SLIDER_MAX - SLIDER_DEAD));
  return (Math.sign(p) * MIN_YR * 10 ** (f * DECADES)) / 1e6;
}

/** Δt in Myr → slider position (inverse of sliderToMyr; clamps to the track) */
export function myrToSlider(myr: number): number {
  const yr = Math.abs(myr) * 1e6;
  if (!(yr >= MIN_YR)) return 0;
  const f = Math.min(1, Math.log10(yr / MIN_YR) / DECADES);
  return Math.sign(myr) * (SLIDER_DEAD + f * (SLIDER_MAX - SLIDER_DEAD));
}

/** clamp a requested Δt to the supported span */
export function clampMyr(myr: number): number {
  if (!Number.isFinite(myr)) return 0;
  return Math.max(-MAX_YR / 1e6, Math.min(MAX_YR / 1e6, myr));
}

export type EpochUnit = 'yr' | 'kyr' | 'Myr';

/** split Δt for display: a signed value in the largest fitting unit, 3 significant digits */
export function epochParts(myr: number): { sign: -1 | 0 | 1; value: number; unit: EpochUnit } {
  const yr = Math.abs(myr) * 1e6;
  const sign = myr > 0 ? 1 : myr < 0 ? -1 : 0;
  if (sign === 0) return { sign: 0, value: 0, unit: 'yr' };
  const round3 = (x: number) => +x.toPrecision(3);
  if (yr >= 999_500) return { sign, value: round3(yr / 1e6), unit: 'Myr' };
  if (yr >= 999.5) return { sign, value: round3(yr / 1e3), unit: 'kyr' };
  return { sign, value: round3(yr), unit: 'yr' };
}

/** slider tick marks: Δt in years */
export const EPOCH_TICKS = [-1e6, -1e5, -1e4, -1e3, 0, 1e3, 1e4, 1e5, 1e6];

/**
 * Stars without a measured radial velocity move only across the sky. Their unknown line-of-sight
 * shift after Δt is about σ·|Δt| (σ = RV_SIGMA_KMS, roughly the radial velocity dispersion of
 * solar-neighbourhood disc stars; a display choice, not a fit). The shader fades such a point by
 * 1 / (1 + (RV_FADE_K · σ|Δt| / d)²), floored at RV_FADE_MIN, d = its distance from the Sun.
 */
export const RV_SIGMA_KMS = 30;
export const RV_FADE_K = 4;
export const RV_FADE_MIN = 0.15;

/** CPU twin of the shader's fade for a tangential-only point at distance dPc */
export function rvFade(dtMyr: number, dPc: number): number {
  const s = (RV_SIGMA_KMS * Math.abs(dtMyr) * 1.022712165045695) / Math.max(dPc, 1e-6);
  return Math.max(RV_FADE_MIN, 1 / (1 + (RV_FADE_K * s) ** 2));
}

export class StarEpoch {
  private dt = 0;
  private listeners = new Set<() => void>();

  /** Δt in Myr (+ = future) */
  get myr(): number {
    return this.dt;
  }

  get active(): boolean {
    return this.dt !== 0;
  }

  set(myr: number) {
    const v = clampMyr(myr);
    if (v === this.dt) return;
    this.dt = v;
    for (const f of this.listeners) f();
  }

  onChange(f: () => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }
}
