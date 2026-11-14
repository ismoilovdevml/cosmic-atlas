/**
 * MPC packed designations (https://minorplanetcenter.net/iau/info/PackedDes.html) -> readable form:
 *   '00001' -> '(1)', 'A0345' -> '(100345)', '~0000' -> '(620000)' (base-62 tail),
 *   'K24A12B' -> '2024 AB12', 'J95X00A' -> '1995 XA', 'PLS2040' -> '2040 P-L', 'T1S3138' -> '3138 T-1'.
 * Anything else (comet names in the comet chunks) is returned unchanged.
 */

const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const v62 = (c: string) => B62.indexOf(c);

export function unpackNumber(p: string): number | null {
  if (/^\d{5}$/.test(p)) return +p;
  if (/^[A-Za-z]\d{4}$/.test(p)) return v62(p[0]) * 10000 + +p.slice(1);
  if (/^~[0-9A-Za-z]{4}$/.test(p)) return 620000 + [...p.slice(1)].reduce((a, c) => a * 62 + v62(c), 0);
  return null;
}

export function unpackDesignation(p: string): string {
  const s = p.trim();
  const num = unpackNumber(s);
  if (num !== null) return `(${num})`;
  let m = /^([IJK])(\d\d)([A-HJ-Y])([0-9A-Za-z])(\d)([A-HJ-Z])$/.exec(s);
  if (m) {
    const year = (m[1] === 'I' ? 1800 : m[1] === 'J' ? 1900 : 2000) + +m[2];
    const cycle = v62(m[4]) * 10 + +m[5];
    return `${year} ${m[3]}${m[6]}${cycle ? cycle : ''}`;
  }
  m = /^(PL|T1|T2|T3)S(\d{4})$/.exec(s);
  if (m) return `${m[2]} ${m[1] === 'PL' ? 'P-L' : `T-${m[1][1]}`}`;
  return s;
}
