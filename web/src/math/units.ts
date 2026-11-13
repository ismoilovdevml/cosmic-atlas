/** Distance units and formatting in the current UI language. Everything in the viewer is parsec. */

import { decimalSep, fmtMax, t } from '../i18n';
import { lookbackTimeGyr, redshiftFromComoving } from './cosmology';

export const PC_PER_AU = 4.84813681109536e-6; // 1 AU / 1 pc (IAU 2012 exact AU, 648000/pi AU per pc)
export const LY_PER_PC = 3.261563777167433;
const SEC_PER_YR = 365.25 * 86400;
const LIGHT_SEC_PER_AU = 499.00478383615643;
const NBSP = ' ';

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

/** about `sig` significant digits, in the current language's number format */
export function fmtNum(x: number, sig = 3): string {
  if (!isFinite(x)) return '—';
  const a = Math.abs(x);
  if (a !== 0 && (a >= 1e6 || a < 1e-3)) return x.toExponential(sig - 1).replace('e+', 'e').replace('.', decimalSep());
  const digits = a >= 100 ? 0 : a >= 10 ? Math.max(0, sig - 2) : a >= 1 ? sig - 1 : sig;
  return fmtMax(x, digits);
}

/** the unit's abbreviation in the current language (AU / а. е. / a.b., pc / пк / pk, …) */
export function unitLabel(u: UnitChoice['unit']): string {
  return t(`unit.${u}`);
}

export function formatDistance(pc: number, sig = 3): string {
  const u = pickUnit(pc);
  return `${fmtNum(pc / u.scale, sig)}${NBSP}${unitLabel(u.unit)}`;
}

/** "1.2 – 1.4 kpc", or "900 pc – 1.1 kpc" when the ends need different units */
export function formatRange(lo: number, hi: number): string {
  const ul = pickUnit(lo);
  const uh = pickUnit(hi);
  if (ul.unit === uh.unit) return `${fmtNum(lo / uh.scale, 3)} – ${formatDistance(hi, 3)}`;
  return `${formatDistance(lo, 3)} – ${formatDistance(hi, 3)}`;
}

const q = (key: string, n: number) => t(key, { n, nText: fmtNum(n) });

/** Distance in light-years, rounded sensibly (used as a secondary readout). */
export function formatLy(pc: number): string {
  const ly = pc * LY_PER_PC;
  if (ly < 0.01) return '';
  if (ly < 1e3) return q('unit.ly', ly);
  if (ly < 1e6) return q('unit.kly', ly / 1e3);
  if (ly < 1e9) return q('unit.mly', ly / 1e6);
  return q('unit.gly', ly / 1e9);
}

/** a span of time in the largest fitting unit ("8.3 minutes", "1.2 billion years") */
export function formatDuration(sec: number): string {
  if (sec < 120) return q('dur.sec', sec);
  if (sec < 7200) return q('dur.min', sec / 60);
  if (sec < 2 * 86400) return q('dur.hour', sec / 3600);
  if (sec < SEC_PER_YR) return q('dur.day', sec / 86400);
  const yr = sec / SEC_PER_YR;
  if (yr < 1e3) return q('dur.yr', yr);
  if (yr < 1e6) return q('dur.kyr', yr / 1e3);
  if (yr < 1e9) return q('dur.myr', yr / 1e6);
  return q('dur.gyr', yr / 1e9);
}

/** Plain light-crossing time L/c for a length (valid below cosmological scales). */
export function formatLightTime(pc: number): string {
  const sec = (pc / PC_PER_AU) * LIGHT_SEC_PER_AU;
  if (sec < 120) return q('light.sec', sec);
  if (sec < 7200) return q('light.min', sec / 60);
  if (sec < 2 * 86400) return q('light.hour', sec / 3600);
  if (sec < SEC_PER_YR) return q('light.day', sec / 86400);
  const yr = sec / SEC_PER_YR;
  if (yr < 1e3) return q('unit.ly', yr);
  if (yr < 1e6) return q('unit.kly', yr / 1e3);
  if (yr < 1e9) return q('unit.mly', yr / 1e6);
  return q('unit.gly', yr / 1e9);
}

/**
 * How long ago light left an object at comoving distance d (from the Sun).
 * Below 10 Mpc this is d/c; beyond it uses Planck18 redshift and lookback time, because
 * comoving distance and light-travel distance diverge at cosmological range.
 * `ago` is the bare phrase ("2.1 billion years ago"), `text` the full one ("light left …").
 */
export function describeLookback(dPc: number): { text: string; ago: string; z?: number } {
  let sec: number;
  let z: number | undefined;
  if (dPc < 1e7) sec = (dPc / PC_PER_AU) * LIGHT_SEC_PER_AU;
  else {
    z = redshiftFromComoving(dPc);
    sec = lookbackTimeGyr(z) * 1e9 * SEC_PER_YR;
  }
  const ago = t('time.ago', { t: formatDuration(sec) });
  return { text: t('lookback.left', { ago }), ago, z };
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
  return { pc, px: pc / pcPerPx, label: `${fmtNum(len)}${NBSP}${unitLabel(u.unit)}` };
}
