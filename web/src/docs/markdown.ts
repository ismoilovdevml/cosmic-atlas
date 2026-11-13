/**
 * Minimal, safe Markdown → HTML for the docs articles.
 *
 * Safe by construction: every piece of source text is HTML-escaped, raw HTML in the file is shown
 * as text (never parsed), and the only tags emitted are the fixed set below. URLs are classified:
 *   doc:<slug> and #doc=<slug>   → in-app article link (data-doc)
 *   #focus=<name>                → fly the map to an object (data-focus)
 *   https: / http: / mailto:     → external link, new tab, rel="noopener noreferrer"
 *   anything else                → plain text (javascript:, data:, vbscript:, …)
 * Images: https: or a relative path (resolved by the caller); anything else is dropped.
 *
 * Supported: ATX headings (# → h2, the title is the page's h1), paragraphs, **strong**, *em*, `code`,
 * links, images (a lone image with a "title" becomes a figure with that caption, for credits),
 * <https://autolinks>, nested bullet and numbered lists, > blockquotes, fenced code, --- rules, GFM tables,
 * hard breaks (two trailing spaces or a trailing backslash), backslash escapes.
 */

export interface RenderOptions {
  /** resolve a relative image path (e.g. against docs/<lang>/) */
  resolveImage?: (src: string) => string;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export type LinkTarget =
  | { type: 'doc'; slug: string }
  | { type: 'focus'; name: string }
  | { type: 'layer'; id: string }
  | { type: 'external'; href: string }
  | { type: 'none' };

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

export function classifyLink(raw: string): LinkTarget {
  const href = raw.trim();
  let m = href.match(/^doc:([a-z0-9-]+)$/i) ?? href.match(/^#doc=([a-z0-9-]+)$/i);
  if (m && SLUG.test(m[1].toLowerCase())) return { type: 'doc', slug: m[1].toLowerCase() };
  m = href.match(/^#layer=([A-Za-z0-9_.-]{1,64})$/);
  if (m) return { type: 'layer', id: m[1] };
  m = href.match(/^#focus=(.+)$/);
  if (m) {
    let name = m[1];
    try {
      name = decodeURIComponent(name);
    } catch {
      /* keep the raw text */
    }
    return { type: 'focus', name };
  }
  if (/^(https?:\/\/|mailto:)/i.test(href) && !/[\s<>"]/.test(href)) return { type: 'external', href };
  return { type: 'none' };
}

function safeImageSrc(src: string, opts: RenderOptions): string | null {
  const s = src.trim();
  if (/^https:\/\//i.test(s) && !/[\s<>"]/.test(s)) return s;
  // relative path only: no scheme, no protocol-relative, no parent escapes
  if (/^[a-z0-9_][\w./-]*$/i.test(s) && !s.includes('..') && !s.startsWith('//')) return opts.resolveImage ? opts.resolveImage(s) : s;
  return null;
}

function linkHtml(target: LinkTarget, innerHtml: string): string {
  switch (target.type) {
    case 'doc':
      return `<a href="#doc=${escapeHtml(target.slug)}" data-doc="${escapeHtml(target.slug)}">${innerHtml}</a>`;
    case 'layer':
      return `<a href="#layer=${escapeHtml(target.id)}" data-layer="${escapeHtml(target.id)}" class="focus-link">${innerHtml}</a>`;
    case 'focus':
      return `<a href="#focus=${escapeHtml(encodeURIComponent(target.name))}" data-focus="${escapeHtml(target.name)}" class="focus-link">${innerHtml}</a>`;
    case 'external':
      return `<a href="${escapeHtml(target.href)}" target="_blank" rel="noopener noreferrer" class="ext">${innerHtml}</a>`;
    default:
      return innerHtml;
  }
}

/** find the index of the bracket closing the one at `open`, honouring nesting and escapes */
function closeBracket(s: string, open: number, o: string, c: string): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '\\') {
      i++;
      continue;
    }
    if (s[i] === o) depth++;
    else if (s[i] === c && --depth === 0) return i;
  }
  return -1;
}

/** "(url "title")" body → url + optional title */
function splitDest(d: string): { url: string; title?: string } {
  const m = d.trim().match(/^<?([^\s>]*)>?(?:\s+(?:"([^"]*)"|'([^']*)'))?$/);
  if (!m) return { url: d.trim() };
  return { url: m[1], title: m[2] ?? m[3] };
}

export function renderInline(src: string, opts: RenderOptions = {}, inLink = false): string {
  let out = '';
  let text = '';
  const flush = () => {
    out += escapeHtml(text);
    text = '';
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    // backslash escape / hard break
    if (ch === '\\') {
      if (src[i + 1] === '\n') {
        flush();
        out += '<br>';
        i += 2;
        continue;
      }
      if (i + 1 < src.length && /[\\`*_{}[\]()#+\-.!|<>~]/.test(src[i + 1])) {
        text += src[i + 1];
        i += 2;
        continue;
      }
    }
    if (ch === '\n') {
      if (text.endsWith('  ')) {
        text = text.replace(/ +$/, '');
        flush();
        out += '<br>';
      } else text += ' ';
      i++;
      continue;
    }
    // code span
    if (ch === '`') {
      const run = src.slice(i).match(/^`+/)![0];
      const end = src.indexOf(run, i + run.length);
      if (end > 0) {
        flush();
        out += `<code>${escapeHtml(src.slice(i + run.length, end).replace(/\n/g, ' ').trim())}</code>`;
        i = end + run.length;
        continue;
      }
    }
    // image ![alt](src "title")
    if (ch === '!' && src[i + 1] === '[') {
      const cb = closeBracket(src, i + 1, '[', ']');
      if (cb > 0 && src[cb + 1] === '(') {
        const cp = closeBracket(src, cb + 1, '(', ')');
        if (cp > 0) {
          const alt = src.slice(i + 2, cb);
          const { url, title } = splitDest(src.slice(cb + 2, cp));
          const safe = safeImageSrc(url, opts);
          flush();
          if (safe) out += `<img src="${escapeHtml(safe)}" alt="${escapeHtml(alt)}" loading="lazy"${title ? ` title="${escapeHtml(title)}"` : ''}>`;
          else out += escapeHtml(alt);
          i = cp + 1;
          continue;
        }
      }
    }
    // link [text](url)
    if (ch === '[' && !inLink) {
      const cb = closeBracket(src, i, '[', ']');
      if (cb > 0 && src[cb + 1] === '(') {
        const cp = closeBracket(src, cb + 1, '(', ')');
        if (cp > 0) {
          const { url } = splitDest(src.slice(cb + 2, cp));
          flush();
          out += linkHtml(classifyLink(url), renderInline(src.slice(i + 1, cb), opts, true));
          i = cp + 1;
          continue;
        }
      }
    }
    // autolink <https://…>
    if (ch === '<' && !inLink) {
      const m = src.slice(i).match(/^<((?:https?:\/\/|mailto:)[^\s<>"]+)>/i);
      if (m) {
        flush();
        out += linkHtml(classifyLink(m[1]), escapeHtml(m[1]));
        i += m[0].length;
        continue;
      }
    }
    // strong / em
    if (ch === '*' || ch === '_') {
      const dbl = src[i + 1] === ch;
      const mark = dbl ? ch + ch : ch;
      const prev = i > 0 ? src[i - 1] : ' ';
      const next = src[i + mark.length] ?? ' ';
      // underscores inside words (snake_case) are literal; a run must not open before a space
      const canOpen = next !== ' ' && next !== '\n' && !(ch === '_' && /[\p{L}\p{N}]/u.test(prev));
      if (canOpen) {
        let j = i + mark.length;
        let end = -1;
        while ((j = src.indexOf(mark, j)) > 0) {
          const before = src[j - 1];
          const after = src[j + mark.length] ?? ' ';
          const okClose = before !== ' ' && before !== '\\' && !(ch === '_' && /[\p{L}\p{N}]/u.test(after));
          // a single * must not close on the first half of a ** run
          if (okClose && !(mark.length === 1 && src[j + 1] === ch && src[j - 1] !== ch)) {
            end = j;
            break;
          }
          j += mark.length;
        }
        if (end > i + mark.length) {
          flush();
          const tag = dbl ? 'strong' : 'em';
          out += `<${tag}>${renderInline(src.slice(i + mark.length, end), opts, inLink)}</${tag}>`;
          i = end + mark.length;
          continue;
        }
      }
    }
    text += ch;
    i++;
  }
  flush();
  return out;
}

// ------------------------------------------------------------------ blocks

const RE_FENCE = /^\s{0,3}(```+|~~~+)\s*([\w-]*)\s*$/;
const RE_HEAD = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RE_HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const RE_QUOTE = /^\s{0,3}>\s?(.*)$/;
const RE_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const RE_TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function indentOf(line: string): number {
  const m = line.match(/^ */)![0].length;
  return m + (line.match(/^\t*/)![0].length * 4);
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (s[i] === '|') {
      cells.push(cur.trim());
      cur = '';
    } else cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

function startsBlock(line: string, next: string | undefined): boolean {
  return RE_FENCE.test(line) || RE_HEAD.test(line) || RE_HR.test(line) || RE_QUOTE.test(line) || RE_ITEM.test(line)
    || (line.includes('|') && next !== undefined && RE_TABLE_SEP.test(next));
}

export function renderMarkdown(md: string, opts: RenderOptions = {}): string {
  return renderBlocks(md.replace(/\r\n?/g, '\n').split('\n'), opts);
}

function renderBlocks(lines: string[], opts: RenderOptions, tight = false): string {
  let out = '';
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    // fenced code
    const fence = line.match(RE_FENCE);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      out += `<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`;
      continue;
    }
    const head = line.match(RE_HEAD);
    if (head) {
      const level = Math.min(4, Math.max(2, head[1].length));
      out += `<h${level}>${renderInline(head[2], opts)}</h${level}>`;
      i++;
      continue;
    }
    if (RE_HR.test(line)) {
      out += '<hr>';
      i++;
      continue;
    }
    if (RE_QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && lines[i].trim() && RE_QUOTE.test(lines[i])) body.push(lines[i++].match(RE_QUOTE)![1]);
      out += `<blockquote>${renderBlocks(body, opts)}</blockquote>`;
      continue;
    }
    if (RE_ITEM.test(line)) {
      const r = renderList(lines, i, opts);
      out += r.html;
      i = r.next;
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && RE_TABLE_SEP.test(lines[i + 1])) {
      const header = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : ''));
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(splitRow(lines[i++]));
      const cell = (tag: string, c: string, k: number) => `<${tag}${aligns[k] ? ` class="${aligns[k]}"` : ''}>${renderInline(c, opts)}</${tag}>`;
      out += '<div class="table-wrap"><table><thead><tr>' + header.map((c, k) => cell('th', c, k)).join('') + '</tr></thead><tbody>'
        + rows.map((r) => '<tr>' + header.map((_, k) => cell('td', r[k] ?? '', k)).join('') + '</tr>').join('') + '</tbody></table></div>';
      continue;
    }
    // paragraph
    const para: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i], lines[i + 1])) para.push(lines[i++]);
    const text = para.map((l) => l.replace(/^\s+/, '')).join('\n');
    const lone = text.match(/^!\[([^\]]*)\]\(([^)\s]+)\s+"([^"]+)"\)$/);
    if (lone) {
      const src = safeImageSrc(lone[2], opts);
      if (src) {
        out += `<figure><img src="${escapeHtml(src)}" alt="${escapeHtml(lone[1])}" loading="lazy"><figcaption>${renderInline(lone[3], opts)}</figcaption></figure>`;
        continue;
      }
    }
    out += tight ? renderInline(text, opts) : `<p>${renderInline(text, opts)}</p>`;
  }
  return out;
}

function renderList(lines: string[], start: number, opts: RenderOptions): { html: string; next: number } {
  const first = lines[start].match(RE_ITEM)!;
  const baseIndent = indentOf(first[1]);
  const ordered = /\d/.test(first[2]);
  const startNum = ordered ? parseInt(first[2], 10) : 1;
  const items: string[][] = [];
  let loose = false;
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(RE_ITEM);
    if (m && indentOf(m[1]) === baseIndent && /\d/.test(m[2]) === ordered) {
      items.push([m[3]]);
      i++;
      continue;
    }
    if (!line.trim()) {
      // a blank line continues the list only if more indented content or another item follows
      const nxt = lines[i + 1];
      const nm = nxt?.match(RE_ITEM);
      const sameList = !!nm && indentOf(nm[1]) === baseIndent && /\d/.test(nm[2]) === ordered;
      if (nxt !== undefined && nxt.trim() && (indentOf(nxt) > baseIndent || sameList)) {
        if (indentOf(nxt) <= baseIndent) loose = true;
        items[items.length - 1].push('');
        i++;
        continue;
      }
      break;
    }
    if (indentOf(line) > baseIndent) {
      items[items.length - 1].push(line.slice(Math.min(indentOf(line), baseIndent + 2)));
      i++;
      continue;
    }
    // lazy continuation of the item's paragraph
    if (!startsBlock(line, lines[i + 1]) && items[items.length - 1].at(-1)?.trim()) {
      items[items.length - 1].push(line.trim());
      i++;
      continue;
    }
    break;
  }
  const tag = ordered ? 'ol' : 'ul';
  const attr = ordered && startNum !== 1 ? ` start="${startNum}"` : '';
  const html = `<${tag}${attr}>${items.map((it) => `<li>${renderBlocks(it, opts, !loose)}</li>`).join('')}</${tag}>`;
  return { html, next: i };
}
