/** Distance units and formatting. Everything in the viewer is parsec. */

import { lookbackTimeGyr, redshiftFromComoving } from './cosmology';

export const PC_PER_AU = 4.84813681109536e-6; // 1 AU / 1 pc (IAU 2012 exact AU, 648000/pi AU per pc)
export const LY_PER_PC = 3.261563777167433;
const SEC_PER_YR = 365.25 * 86400;
const LIGHT_SEC_PER_AU = 499.00478383615643;

export interface UnitChoice {
  unit: 'AU' | 'pc' | 'kpc' | 'Mpc' | 'Gpc';
  scale: number; // pc per unit
}

export function pickUnit(pc: number): UnitChoice {
  const a = Math.abs(pc);
  if (a < 0.05) return { unit: 'AU', scale: PC_PER_AU };
  if (a < 1e3) return { unit: 'pc', scale: 1 };
  if (a < 1e6) return { unit: 'kpc', scale: 1e3 };
  if (a < 1e9) return { unit: 'Mpc', scale: 1e6 };
  return { unit: 'Gpc', scale: 1e9 };
}

export function fmtNum(x: number, sig = 3): string {
  if (!isFinite(x)) return '—';
  const a = Math.abs(x);
  if (a !== 0 && (a >= 1e6 || a < 1e-3)) return x.toExponential(sig - 1).replace('e+', 'e');
  const digits = a >= 100 ? 0 : a >= 10 ? Math.max(0, sig - 2) : a >= 1 ? sig - 1 : sig;
  return x.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function formatDistance(pc: number, sig = 3): string {
  const u = pickUnit(pc);
  return `${fmtNum(pc / u.scale, sig)} ${u.unit}`;
}

/** Distance in light-years, rounded sensibly (used as a secondary readout). */
export function formatLy(pc: number): string {
  const ly = pc * LY_PER_PC;
  if (ly < 0.01) return '';
  if (ly < 1e3) return `${fmtNum(ly)} ly`;
  if (ly < 1e6) return `${fmtNum(ly / 1e3)} thousand ly`;
  if (ly < 1e9) return `${fmtNum(ly / 1e6)} million ly`;
  return `${fmtNum(ly / 1e9)} billion ly`;
}

/** Plain light-crossing time L/c for a length (valid below cosmological scales). */
export function formatLightTime(pc: number): string {
  const sec = (pc / PC_PER_AU) * LIGHT_SEC_PER_AU;
  if (sec < 120) return `${fmtNum(sec)} light-seconds`;
  if (sec < 7200) return `${fmtNum(sec / 60)} light-minutes`;
  if (sec < 2 * 86400) return `${fmtNum(sec / 3600)} light-hours`;
  if (sec < SEC_PER_YR) return `${fmtNum(sec / 86400)} light-days`;
  const yr = sec / SEC_PER_YR;
  if (yr < 1e3) return `${fmtNum(yr)} light-years`;
  if (yr < 1e6) return `${fmtNum(yr / 1e3)} thousand light-years`;
  if (yr < 1e9) return `${fmtNum(yr / 1e6)} million light-years`;
  return `${fmtNum(yr / 1e9)} billion light-years`;
}

/**
 * How long ago light left an object at comoving distance d (from the Sun).
 * Below 10 Mpc this is d/c; beyond it uses Planck18 redshift and lookback time, because
 * comoving distance and light-travel distance diverge at cosmological range.
 */
export function describeLookback(dPc: number): { text: string; z?: number } {
  if (dPc < 1e7) {
    const yr = (dPc * LY_PER_PC);
    if (yr < 1) return { text: `light left ${formatLightTime(dPc).replace('light-', '')} ago` };
    if (yr < 1e3) return { text: `light left ${fmtNum(yr)} years ago` };
    if (yr < 1e6) return { text: `light left ${fmtNum(yr / 1e3)} thousand years ago` };
    return { text: `light left ${fmtNum(yr / 1e6)} million years ago` };
  }
  const z = redshiftFromComoving(dPc);
  const t = lookbackTimeGyr(z);
  return { text: `light left ${fmtNum(t)} billion years ago`, z };
}

/** Pick a 1-2-5 length for a scale bar that is at most maxPx long. */
export function niceScaleBar(pcPerPx: number, maxPx: number): { pc: number; px: number; label: string } {
  const target = pcPerPx * maxPx;
  const u = pickUnit(target);
  const inUnit = target / u.scale;
  const p = Math.pow(10, Math.floor(Math.log10(inUnit)));
  const m = inUnit / p;
  const nice = m >= 5 ? 5 : m >= 2 ? 2 : 1;
  const len = nice * p;
  const pc = len * u.scale;
  return { pc, px: pc / pcPerPx, label: `${fmtNum(len)} ${u.unit}` };
}
