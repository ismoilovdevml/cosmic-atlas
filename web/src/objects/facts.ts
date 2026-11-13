/**
 * Info-card rows for a catalogue entry's `facts` (docs/content-contract.md section 3).
 *
 * A fact is `value`, `[value, error]` or `[value, err_minus, err_plus]` (errors as published; the
 * exoplanet archive gives err_minus as a negative number), or plain text. Keys end in their unit
 * (`mass_msun`, `period_s`, `orbital_period_days`, ...); the unit suffix becomes the unit shown.
 * Labels come from i18n keys `facts.<key>`; when the translator has no such key the bare key is shown.
 */

export type FactValue = number | string | boolean | (number | null)[] | null;
export type Translate = (key: string) => string;
/** the UI language: unit symbols from i18n `facts.unit.<suffix>` and its decimal mark */
export interface FactLocale {
  t: Translate;
  decimal: string;
}

/** key suffix -> unit shown after the number (longest suffix wins) */
const UNITS: [string, string][] = [
  ['_msun', 'M☉'],
  ['_mjup', 'M_J'],
  ['_rearth', 'R⊕'],
  ['_days', 'd'],
  ['_ms', 'ms'],
  ['_s', 's'],
  ['_k', 'K'],
  ['_kpc', 'kpc'],
  ['_pc_cm3', 'pc cm⁻³'],
  ['_pc', 'pc'],
  ['_ly', 'ly'],
  ['_mhz', 'MHz'],
  ['_jy', 'Jy'],
  ['_uas', 'µas'],
  ['_arcmin', '′'],
];

export function unitFor(key: string, L?: FactLocale): string {
  let best = '';
  let unit = '';
  for (const [suf, u] of UNITS) if (key.endsWith(suf) && suf.length > best.length) [best, unit] = [suf, u];
  if (L && best) {
    const k = `facts.unit.${best.slice(1)}`;
    const s = L.t(k);
    if (s && s !== k) return s;
  }
  return unit;
}

/** decimal points between digits → the language's mark (text values are never touched) */
function dec(s: string, L?: FactLocale): string {
  return L && L.decimal !== '.' ? s.replace(/(\d)\.(\d)/g, `$1${L.decimal}$2`) : s;
}

/** a number with about `sig` significant digits; very large/small ones in a×10ⁿ form */
export function fmtSig(v: number, sig = 4): string {
  if (!Number.isFinite(v)) return String(v);
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e6 || a < 1e-3) {
    const e = Math.floor(Math.log10(a));
    const m = v / 10 ** e;
    const ms = Number(m.toPrecision(sig)).toString();
    return `${ms}×10${superscript(e)}`;
  }
  return Number(v.toPrecision(sig)).toString();
}

function superscript(n: number): string {
  const map: Record<string, string> = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
  return String(n)
    .split('')
    .map((c) => map[c] ?? c)
    .join('');
}

/**
 * value with its errors at a common scale: the value keeps the precision of its smallest error
 * (two significant digits of the error); large/small values share one power of ten:
 * "32.7 ± 0.82", "11.18465 ± 0.00053", "(4.297 ± 0.012)×10⁶".
 */
function withErrors(val: number, errs: { sign: string; e: number }[]): string {
  const a = Math.abs(val);
  const exp = a >= 1e6 || (a > 0 && a < 1e-3) ? Math.floor(Math.log10(a)) : 0;
  const scale = 10 ** exp;
  const emin = Math.min(...errs.map((x) => x.e).filter((e) => e > 0));
  const dec = Number.isFinite(emin) ? Math.min(12, Math.max(0, 1 - Math.floor(Math.log10(emin / scale)))) : 3;
  const f = (x: number) => (x / scale).toFixed(dec);
  const body = `${f(val)}${errs.map((x) => ` ${x.sign}${f(x.e)}`).join('')}`;
  return exp ? `(${body})×10${superscript(exp)}` : body;
}

export function formatFact(key: string, v: FactValue, L?: FactLocale): string {
  const unit = unitFor(key, L);
  const u = unit ? ` ${unit}` : '';
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? '✓' : '✗';
  if (typeof v === 'string') return (/^[≥≤<>~]?\s*\d[\d.]*$/.test(v) ? dec(v, L) : v) + (unit && /\d$/.test(v) ? u : '');
  if (typeof v === 'number') return dec(Number.isInteger(v) && Math.abs(v) < 1e5 ? String(v) : fmtSig(v, 6), L) + u;
  const [val, e1, e2] = v;
  if (val === null || val === undefined) return '—';
  if (v.length === 2 && e1 !== null && e1 !== undefined) return dec(withErrors(val, [{ sign: '± ', e: Math.abs(e1) }]), L) + u;
  // asymmetric. Contract order: [value, err_minus, err_plus], both >= 0. The exoplanet archive's
  // order is [value, err1 (+), err2 (<= 0)]: a negative third element marks that convention.
  const n1 = e1 ?? null;
  const n2 = e2 ?? null;
  if (n1 === null && n2 === null) return dec(fmtSig(val, 4), L) + u;
  const archive = n2 !== null && n2 < 0;
  const plus = archive ? n1 : n2;
  const minus = archive ? (n2 === null ? null : -n2) : n1;
  const errs = [...(plus === null ? [] : [{ sign: '+', e: plus }]), ...(minus === null ? [] : [{ sign: '−', e: minus }])];
  return dec(withErrors(val, errs), L) + u;
}

/** label for a fact key: i18n `facts.<key>` if the translator knows it, else the key itself */
export function factLabel(key: string, t: Translate = (k) => k): string {
  const k = `facts.${key}`;
  const s = t(k);
  return s && s !== k ? s : key;
}

/** info-card rows for an entry's facts, in the catalogue's key order */
export function factRows(facts: Record<string, FactValue> | undefined, t?: Translate, L?: FactLocale): [string, string][] {
  if (!facts) return [];
  return Object.entries(facts).map(([k, v]) => [factLabel(k, t), formatFact(k, v, L)]);
}

/** one exoplanet of an exoplanets.json system (NASA Exoplanet Archive pscomppars columns) */
export interface Planet {
  pl_name: string;
  discoverymethod?: string;
  disc_year?: number;
  pl_orbper?: FactValue;
  pl_rade?: FactValue;
  pl_bmassj?: FactValue;
  pl_bmassprov?: string;
  pl_eqt?: FactValue;
}

/** one info-card row per planet: name -> "P = 11.18 d · 1.02 R⊕ · ≥0.0033 M_J · 218 K · RV 2016" */
export function planetRows(planets: Planet[] | undefined, L?: FactLocale): [string, string][] {
  if (!planets) return [];
  return planets.map((p) => {
    const parts: string[] = [];
    if (p.pl_orbper !== undefined) parts.push(`P = ${formatFact('x_days', p.pl_orbper, L)}`);
    if (p.pl_rade !== undefined) parts.push(formatFact('x_rearth', p.pl_rade, L));
    if (p.pl_bmassj !== undefined) parts.push((p.pl_bmassprov === 'Msini' ? '≥ ' : '') + formatFact('x_mjup', p.pl_bmassj, L));
    if (p.pl_eqt !== undefined) parts.push(formatFact('x_k', p.pl_eqt, L));
    const disc = [p.discoverymethod, p.disc_year].filter(Boolean).join(' ');
    if (disc) parts.push(disc);
    return [p.pl_name, parts.join(' · ')];
  });
}
