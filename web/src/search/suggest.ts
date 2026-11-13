/**
 * The search dropdown's ranked list: multilingual aliases (Solar System bodies, named views, kind
 * words) merged with local catalogue matches, then the CDS Sesame fallback. Pure, for tests.
 */

import type { CatalogEntry } from '../data/manifest';
import { searchCatalog } from '../data/resolve';
import { baseKind } from '../objects/kinds';
import { ALIASES, NAMED_VIEWS, fold, matchAliases, type AliasEntry } from './aliases';

/** live Solar System positions; registered by the Solar System module */
export interface BodyProvider {
  has(id: string): boolean;
  /** select the body (info card) and fly to it */
  focus(id: string): void;
}

export type SuggestItem =
  | { type: 'catalog'; entry: CatalogEntry; matched: string; score: number }
  | { type: 'alias'; entry: AliasEntry; matched: string; score: number }
  /** a kind word: the article plus how many objects of that kind are listed below it */
  | { type: 'kind'; entry: AliasEntry; matched: string; score: number; count: number }
  | { type: 'sesame'; q: string };

const KIND_LIST_MAX = 5;

export function buildSuggestions(q: string, catalog: CatalogEntry[], limit = 9): SuggestItem[] {
  const query = q.trim();
  if (!query) return [];
  const aliases = matchAliases(query, 6);
  const cats = searchCatalog(catalog, query, limit);
  const out: SuggestItem[] = [];
  const used = new Set<CatalogEntry>();

  // a confident kind word ("black holes") lists objects of that kind under its article
  const kindHit = aliases.find((a) => a.entry.target.type === 'kind' && a.score >= 60);
  const kindItems: SuggestItem[] = [];
  if (kindHit && kindHit.entry.target.type === 'kind') {
    const kinds = new Set(kindHit.entry.target.kinds);
    const members = catalog
      .filter((e) => e.xyz && kinds.has(baseKind(e.kind)))
      .sort((a, b) => (a.mag ?? 99) - (b.mag ?? 99));
    kindItems.push({ type: 'kind', entry: kindHit.entry, matched: kindHit.matched, score: kindHit.score, count: members.length });
    for (const e of members.slice(0, KIND_LIST_MAX)) {
      kindItems.push({ type: 'catalog', entry: e, matched: e.name, score: kindHit.score - 1 });
      used.add(e);
    }
    // planets: the Solar System bodies themselves
    for (const id of kindHit.entry.target.bodies ?? []) {
      const body = aliases.find((a) => a.entry.target.type === 'body' && a.entry.target.id === id);
      if (!body) kindItems.push({ type: 'alias', entry: bodyEntry(id), matched: '', score: kindHit.score - 2 });
    }
  }

  // a view whose target is a catalogue object yields to that object (its card has more to say)
  const catNames = new Set(cats.flatMap((c) => [c.entry.name, ...(c.entry.alt ?? [])].map(fold)));
  for (const a of aliases) {
    if (a === kindHit) continue;
    if (a.entry.target.type === 'kind') {
      if (a.score >= 85) out.push({ type: 'kind', entry: a.entry, matched: a.matched, score: a.score, count: -1 });
      continue;
    }
    if (a.entry.target.type === 'view') {
      const v = NAMED_VIEWS[a.entry.target.id];
      const names = v && 'catalog' in v.target ? v.target.catalog : [];
      if (names.some((n) => catNames.has(fold(n)))) continue;
    }
    out.push({ type: 'alias', entry: a.entry, matched: a.matched, score: a.score });
  }
  for (const c of cats) if (!used.has(c.entry)) out.push({ type: 'catalog', entry: c.entry, matched: c.matched, score: c.score });

  // stable sort by score; aliases (bodies, views) win ties against catalogue rows
  const order = (s: SuggestItem) => (s.type === 'alias' ? 0 : s.type === 'kind' ? 1 : 2);
  out.sort((a, b) => ('score' in b ? b.score : 0) - ('score' in a ? a.score : 0) || order(a) - order(b));
  const merged = kindItems.length ? [...kindItems, ...out.filter((s) => s.type !== 'catalog' || s.score >= 70)] : out;
  const list = merged.slice(0, limit);
  if (query.length >= 2) list.push({ type: 'sesame', q: query });
  return list;
}

function bodyEntry(id: string): AliasEntry {
  return ALIASES.find((e) => e.target.type === 'body' && e.target.id === id)!;
}
