import { log } from '../log';
import { advisoriesFor, type XmlAdvisory } from './advisories';
import { isPlistDocument, parsePlist, type PlistNode } from './plist';

/**
 * Pure XML document utilities (PLAN-23). The Atlas editor uses all of these;
 * they are named for the **format**, not the tool, on the `core/yaml` and
 * `core/json` precedent — a second XML consumer may not import a feature.
 *
 * **No parsing library.** Every general-purpose plist package parses straight
 * to native JS values, where `<integer>` and `<real>` are both a `number` and
 * `<string>` and `<data>` are indistinguishable once decoded — which is exactly
 * the distinction Xcode's table exists to show. So: the browser's own
 * `DOMParser` for the tree, and the scanner below for source offsets.
 *
 * ## The entity-expansion question, settled by spike rather than reasoned about
 *
 * YAML's billion-laughs problem has an XML twin, and PLAN-23 made proving it
 * the first task rather than assuming an answer. Fed through a real Chromium's
 * `DOMParser`, on 2026-08-29:
 *
 * - A plain internal general entity **is** expanded (`<!ENTITY foo "BAR">` +
 *   `&foo;` → `BAR`).
 * - A nine-level billion-laughs bomb and a 100 MB quadratic blowup are both
 *   **refused in ~10ms** — libxml2's own "Maximum entity amplification factor
 *   exceeded" guard — as a `parsererror`, with no hang and no memory spike.
 * - An **external** entity is never resolved (no XXE), which is standard
 *   browser behaviour.
 *
 * So the guard this file needs is not a `maxAliasCount` equivalent — the
 * platform already has one, and adding a second would be inventing a limit
 * nobody can tune. What it needs instead is **correct error detection**, which
 * the same spike showed is easy to get wrong: see `parseErrorOf`.
 */

export type { XmlAdvisory, XmlAdvisoryKind } from './advisories';
export type { PlistNode, PlistType } from './plist';
export { isPlistDocument, looksBinaryPlist, plistSkeleton } from './plist';

/** Byte-offset issue, the shape `core/json` and `core/yaml` already use. */
export interface XmlIssue {
  offset: number;
  length: number;
  message: string;
}

/** Where one element sits in the source text. */
export interface XmlSpan {
  name: string;
  /** Offset of the `<` opening the start tag. */
  start: number;
  /** Offset just past the `>` closing the end tag (or the self-closing tag). */
  end: number;
  /** Offset just past the start tag's `>` — where child content begins. */
  innerStart: number;
  /** Offset of the `<` opening the end tag — where child content ends. */
  innerEnd: number;
  /** `<a/>`: there is no inner range, so inserting a child rewrites the tag. */
  empty: boolean;
}

export interface XmlStats {
  bytes: number;
  lines: number;
  elements: number;
  valid: boolean;
}

export interface XmlAnalysis {
  /** The live document — the one shared model the table mutates. Null if invalid. */
  doc: Document | null;
  /** Element → source span, in the text that was parsed. Empty if unmappable. */
  spans: Map<Element, XmlSpan>;
  issues: XmlIssue[];
  advisories: XmlAdvisory[];
  /** True when the root element is `<plist>` — the table's one precondition. */
  isPlist: boolean;
  /** The plist tree, when this is a plist whose body is usable. */
  plist: PlistNode | null;
  /** Why a plist document has no table, when that is the case. */
  plistError: string | null;
  stats: XmlStats;
}

/**
 * The namespaces browsers put a synthesised `<parsererror>` in. Checking the
 * namespace is load-bearing, not pedantry: the spike parsed
 * `<r><parsererror>not an error</parsererror></r>`, which is a perfectly valid
 * document, and a bare tag-name search calls it a failure. A real error element
 * always carries one of these; an author's own element carries neither.
 */
const PARSER_ERROR_NS = [
  // Chromium/WebKit.
  'http://www.w3.org/1999/xhtml',
  // Firefox, and jsdom (which the unit tests run under).
  'http://www.mozilla.org/newlayout/xml/parsererror.xml',
];

/**
 * Two shapes seen in the spike, because the error text is the browser's prose:
 * Chromium writes `error on line 1 at column 25: …`, jsdom writes `1:10: …`.
 * Neither is a contract, so a miss falls back to the top of the document rather
 * than to a wrong position.
 */
function positionOf(message: string, text: string): { offset: number; message: string } {
  const chromium = /error on line (\d+) at column (\d+): ([\s\S]*)/.exec(message);
  const jsdomLike = /^(\d+):(\d+):\s*([\s\S]*)/.exec(message.trim());
  const hit = chromium ?? jsdomLike;
  if (!hit) return { offset: 0, message: message.trim() };
  const line = Number(hit[1]);
  const column = Number(hit[2]);
  const lines = text.split('\n');
  let offset = 0;
  for (let i = 0; i < line - 1 && i < lines.length; i += 1) {
    offset += (lines[i]?.length ?? 0) + 1;
  }
  return {
    offset: Math.min(offset + Math.max(column - 1, 0), text.length),
    message: (hit[3] ?? message).trim(),
  };
}

/**
 * The document's parse error, or null. Searches the **whole tree**, not just
 * the root: the spike's entity bomb parsed its root element fine and had the
 * error element grafted in underneath, so `documentElement` said `lolz` and
 * looked healthy.
 */
function parseErrorOf(doc: Document, text: string): XmlIssue | null {
  for (const element of doc.getElementsByTagName('parsererror')) {
    if (!PARSER_ERROR_NS.includes(element.namespaceURI ?? '')) continue;
    const raw = (element.textContent ?? 'the document is not well-formed XML')
      .replace(/This page contains the following errors:/g, '')
      .replace(/Below is a rendering of the page up to the first error\./g, '')
      .trim();
    const { offset, message } = positionOf(raw, text);
    return { offset, length: 1, message: message || 'the document is not well-formed XML' };
  }
  return null;
}

/** Skips a quoted attribute value so a `>` inside one never ends a tag early. */
function tagEnd(text: string, from: number): number {
  let quote = '';
  for (let i = from; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return i;
    }
  }
  return text.length;
}

/** `<!DOCTYPE … [ … ]>`: the internal subset's own `>` characters don't end it. */
function declarationEnd(text: string, from: number): number {
  let quote = '';
  let depth = 0;
  for (let i = from; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '[') {
      depth += 1;
    } else if (ch === ']') {
      depth -= 1;
    } else if (ch === '>' && depth <= 0) {
      return i;
    }
  }
  return text.length;
}

const NAME_END = /[\s/>]/;

/**
 * Every element's source span, in document order.
 *
 * `DOMParser` reports no offsets at all, and the surgical-edit promise — a
 * value edit changes that value's span and nothing else — is a promise about
 * source positions. So the text is scanned once for element boundaries, and
 * `analyzeXml` zips the result onto the DOM's own document-order element list.
 *
 * Deliberately *not* a second parser: it decides nothing about validity, does
 * not decode entities, and never sees attribute or text semantics. `DOMParser`
 * stays the authority on all of that; this only answers "where".
 */
export function scanElementSpans(text: string): XmlSpan[] {
  const out: XmlSpan[] = [];
  const stack: XmlSpan[] = [];
  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt < 0) break;
    if (text.startsWith('<!--', lt)) {
      const close = text.indexOf('-->', lt + 4);
      i = close < 0 ? text.length : close + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', lt)) {
      const close = text.indexOf(']]>', lt + 9);
      i = close < 0 ? text.length : close + 3;
      continue;
    }
    if (text.startsWith('<?', lt)) {
      const close = text.indexOf('?>', lt + 2);
      i = close < 0 ? text.length : close + 2;
      continue;
    }
    if (text.startsWith('<!', lt)) {
      i = declarationEnd(text, lt + 2) + 1;
      continue;
    }
    if (text[lt + 1] === '/') {
      const gt = tagEnd(text, lt + 2);
      const open = stack.pop();
      if (open) {
        open.innerEnd = lt;
        open.end = gt + 1;
      }
      i = gt + 1;
      continue;
    }
    const gt = tagEnd(text, lt + 1);
    let nameEnd = lt + 1;
    while (nameEnd < gt && !NAME_END.test(text[nameEnd] ?? '')) nameEnd += 1;
    const selfClosing = text[gt - 1] === '/';
    const span: XmlSpan = {
      name: text.slice(lt + 1, nameEnd),
      start: lt,
      end: selfClosing ? gt + 1 : -1,
      innerStart: gt + 1,
      innerEnd: selfClosing ? gt + 1 : -1,
      empty: selfClosing,
    };
    out.push(span);
    if (!selfClosing) stack.push(span);
    i = gt + 1;
  }
  // An unclosed element leaves `end`/`innerEnd` at -1. The document does not
  // parse in that state, so nothing consumes the spans — but leaving a
  // negative offset in the map would be a trap for whoever does next.
  for (const span of stack) {
    span.innerEnd = text.length;
    span.end = text.length;
  }
  return out;
}

function elementsInOrder(doc: Document): Element[] {
  const out: Element[] = [];
  const visit = (element: Element) => {
    out.push(element);
    for (const child of element.children) visit(child);
  };
  if (doc.documentElement) visit(doc.documentElement);
  return out;
}

/**
 * Zip the scanned spans onto the DOM. A count mismatch means the two disagree
 * about how many elements exist — the one realistic way that happens is an
 * internal entity whose replacement text contains markup, which the DOM expands
 * and the scanner never sees. Rather than pair them up wrongly and hand the
 * table offsets that point at the wrong bytes, the map comes back empty and the
 * caller falls back to a code-pane-only document.
 */
function zipSpans(doc: Document, spans: XmlSpan[]): Map<Element, XmlSpan> {
  const elements = elementsInOrder(doc);
  const map = new Map<Element, XmlSpan>();
  if (elements.length !== spans.length) {
    log.warn(
      `xml: ${elements.length} parsed elements vs ${spans.length} in source — source offsets unavailable`,
      { module: 'atlas' },
    );
    return map;
  }
  elements.forEach((element, index) => {
    const span = spans[index];
    if (span) map.set(element, span);
  });
  return map;
}

/** Parse without analysis — the one place `DOMParser` is constructed. */
export function parseXml(text: string): { doc: Document | null; issue: XmlIssue | null } {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const issue = parseErrorOf(doc, text);
  return issue ? { doc: null, issue } : { doc, issue: null };
}

/**
 * One parse, everything derived from it: the document, its spans, blocking
 * issues, advisories, the plist tree and stats. Atlas calls this once per
 * debounce tick rather than parsing a 2 MB document four times over — the same
 * bargain `analyzeYaml` makes.
 */
export function analyzeXml(text: string): XmlAnalysis {
  const bytes = new TextEncoder().encode(text).length;
  const lines = text.length === 0 ? 0 : text.split('\n').length;
  const empty: XmlAnalysis = {
    doc: null,
    spans: new Map(),
    issues: [],
    advisories: [],
    isPlist: false,
    plist: null,
    plistError: null,
    stats: { bytes, lines, elements: 0, valid: false },
  };
  if (text.trim() === '') return empty;

  const { doc, issue } = parseXml(text);
  if (!doc) {
    return { ...empty, issues: issue ? [issue] : [] };
  }

  const spans = zipSpans(doc, scanElementSpans(text));
  const isPlist = isPlistDocument(doc);
  const parsed = isPlist ? parsePlist(doc, spans) : { root: null, error: null };

  return {
    doc,
    spans,
    issues: [],
    advisories: advisoriesFor(doc, spans, text),
    isPlist,
    plist: parsed.root,
    plistError: parsed.error,
    stats: { bytes, lines, elements: spans.size, valid: true },
  };
}

/** Every blocking problem, in source order (feeds the lint gutter). */
export function validateXml(text: string): XmlIssue[] {
  if (text.trim() === '') return [];
  const { issue } = parseXml(text);
  return issue ? [issue] : [];
}

export function xmlStats(text: string): XmlStats {
  return analyzeXml(text).stats;
}

export function escapeXmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return escapeXmlText(value).replace(/"/g, '&quot;');
}

function startTag(element: Element): string {
  const attrs = [...element.attributes]
    .map((attr) => ` ${attr.name}="${escapeAttr(attr.value)}"`)
    .join('');
  return `<${element.nodeName}${attrs}`;
}

/**
 * The document's prologue — XML declaration, comments, PIs and DOCTYPE — read
 * from the **source text** rather than rebuilt from the DOM.
 *
 * `XMLSerializer` drops the XML declaration entirely, and a plist without
 * `<?xml version="1.0" encoding="UTF-8"?>` and its Apple DOCTYPE is not the
 * file the author opened. Taking the bytes before the root element keeps them
 * exactly as written, comments included.
 */
function prologueOf(text: string, spans: XmlSpan[]): string {
  const root = spans[0];
  if (!root) return '';
  return text.slice(0, root.start).trim();
}

/** True when an element mixes real text with element children. */
function isMixed(element: Element): boolean {
  if (element.children.length === 0) return false;
  return [...element.childNodes].some(
    (node) => node.nodeType === 3 && (node.nodeValue ?? '').trim() !== '',
  );
}

function serializeNode(
  node: Node,
  indent: string,
  unit: string,
  pretty: boolean,
  childIndent = indent + unit,
): string {
  const nl = pretty ? '\n' : '';
  switch (node.nodeType) {
    case 8:
      return `${pretty ? indent : ''}<!--${node.nodeValue ?? ''}-->`;
    case 7: {
      const pi = node as ProcessingInstruction;
      return `${pretty ? indent : ''}<?${pi.target} ${pi.data}?>`;
    }
    case 4:
      return `${pretty ? indent : ''}<![CDATA[${node.nodeValue ?? ''}]]>`;
    case 3:
      return escapeXmlText(node.nodeValue ?? '');
    case 1:
      break;
    default:
      return '';
  }

  const element = node as Element;
  const open = startTag(element);
  const head = pretty ? indent : '';

  // Mixed content is left exactly as the author wrote it: re-indenting text
  // that sits beside an element changes what the document says.
  if (isMixed(element)) {
    const inner = [...element.childNodes]
      .map((child) => serializeNode(child, '', unit, false))
      .join('');
    return `${head}${open}>${inner}</${element.nodeName}>`;
  }

  const children = [...element.childNodes].filter((child) => {
    if (child.nodeType === 3) return (child.nodeValue ?? '').trim() !== '';
    return child.nodeType === 1 || child.nodeType === 8 || child.nodeType === 4;
  });

  if (children.length === 0) return `${head}${open}/>`;

  // A single text child stays on one line — `<key>CFBundleName</key>` is how
  // every plist in the world is written, and how Xcode writes it back.
  if (children.length === 1 && children[0]?.nodeType !== 1) {
    const only = children[0] as Node;
    return `${head}${open}>${serializeNode(only, '', unit, false)}</${element.nodeName}>`;
  }

  const inner = children
    .map((child) => serializeNode(child, pretty ? childIndent : '', unit, pretty))
    .join(nl);
  return `${head}${open}>${nl}${inner}${nl}${pretty ? indent : ''}</${element.nodeName}>`;
}

/**
 * The document's own indent unit: a tab if the first indented line uses one,
 * else two spaces. Worth detecting rather than imposing — Xcode writes plists
 * with tabs, and Format must not rewrite every line of a file it was asked to
 * tidy.
 */
export function detectIndentUnit(text: string): string {
  const hit = /\n([ \t]+)\S/.exec(text);
  const found = hit?.[1] ?? '';
  if (found.startsWith('\t')) return '\t';
  if (found.length > 0) return ' '.repeat(Math.min(found.length, 8));
  return '  ';
}

/** Pretty-print. A document that does not parse is returned untouched. */
export function formatXml(text: string): string {
  const { doc } = parseXml(text);
  if (!doc?.documentElement) return text;
  const unit = detectIndentUnit(text);
  const prologue = prologueOf(text, scanElementSpans(text));
  // Apple writes the root `<dict>` flush against `<plist>`, and every plist on
  // every Mac looks that way. Indenting it would shift every line of a real
  // Info.plist on a click that was only asked to tidy the file.
  const body = serializeNode(
    doc.documentElement,
    '',
    unit,
    true,
    isPlistDocument(doc) ? '' : unit,
  );
  return `${prologue ? `${prologue}\n` : ''}${body}\n`;
}

/** Collapse insignificant inter-tag whitespace — XML's answer to JSON minify. */
export function minifyXml(text: string): string {
  const { doc } = parseXml(text);
  if (!doc?.documentElement) return text;
  const prologue = prologueOf(text, scanElementSpans(text)).replace(/\s*\n\s*/g, '');
  return `${prologue}${serializeNode(doc.documentElement, '', '', false)}`;
}
