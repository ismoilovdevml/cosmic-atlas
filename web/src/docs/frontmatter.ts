/**
 * Front matter of docs articles (docs/content-contract.md §4): a small YAML subset.
 *
 *   key: value            string (quotes optional), true/false
 *   key: [a, b, "c, d"]   inline list
 *   key:                  block list
 *     - item
 */

export interface DocMeta {
  title: string;
  summary: string;
  related: string[];
  sources: string[];
  updated?: string;
  placeholder: boolean;
  /** anything else, as parsed */
  extra: Record<string, string | boolean | string[]>;
}

function unquote(s: string): string {
  const v = s.trim();
  if (v.length >= 2 && ((v[0] === '"' && v.at(-1) === '"') || (v[0] === "'" && v.at(-1) === "'"))) {
    const inner = v.slice(1, -1);
    return v[0] === "'" ? inner.replace(/''/g, "'") : inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return v;
}

/** split an inline list on commas outside quotes */
function inlineList(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q: string | null = null;
  for (const ch of s) {
    if (q) {
      cur += ch;
      if (ch === q) q = null;
    } else if (ch === '"' || ch === "'") {
      q = ch;
      cur += ch;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map(unquote).filter((x) => x !== '');
}

function scalar(v: string): string | boolean | string[] {
  const s = v.trim();
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s.startsWith('[') && s.endsWith(']')) return inlineList(s.slice(1, -1));
  return unquote(s);
}

export function parseFrontMatter(text: string): { meta: DocMeta; body: string } | null {
  const src = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  if (!src.startsWith('---\n')) return null;
  const end = src.indexOf('\n---', 3);
  if (end < 0) return null;
  const head = src.slice(4, end);
  const after = src.slice(end + 4);
  const body = after.startsWith('\n') ? after.slice(1) : after.replace(/^[^\n]*\n?/, '');
  const raw: Record<string, string | boolean | string[]> = {};
  let listKey: string | null = null;
  for (const line of head.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const item = line.match(/^\s+-\s+(.*)$/) ?? line.match(/^-\s+(.*)$/);
    if (item && listKey) {
      (raw[listKey] as string[]).push(unquote(item[1]));
      continue;
    }
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    if (kv[2].trim() === '') {
      listKey = kv[1];
      raw[listKey] = [];
    } else {
      listKey = null;
      raw[kv[1]] = scalar(kv[2]);
    }
  }
  const str = (k: string) => (typeof raw[k] === 'string' ? (raw[k] as string) : '');
  const list = (k: string) => (Array.isArray(raw[k]) ? (raw[k] as string[]) : typeof raw[k] === 'string' && raw[k] ? [raw[k] as string] : []);
  const known = new Set(['title', 'summary', 'related', 'sources', 'updated', 'placeholder']);
  const extra = Object.fromEntries(Object.entries(raw).filter(([k]) => !known.has(k)));
  return {
    meta: {
      title: str('title'),
      summary: str('summary'),
      related: list('related'),
      sources: list('sources'),
      updated: str('updated') || undefined,
      placeholder: raw.placeholder === true,
      extra,
    },
    body,
  };
}
