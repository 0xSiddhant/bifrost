import type { XmlSpan } from './index';

/**
 * Apple property lists as a *typed* tree (PLAN-23).
 *
 * The point of this file is the one thing every plist library throws away: the
 * **declared** XML type. `plist`, `@plist/parse` and friends parse to native JS
 * values, where `<integer>` and `<real>` are both `number` and `<string>` and
 * `<data>` are the same string once decoded. Xcode's editor exists to show that
 * distinction, so the tree below keeps the element name each value was written
 * with and never converts anything the author did not ask for.
 *
 * Every node also carries its **source span**, because the table's promise is
 * about bytes: editing a string's text must change that string's span and leave
 * the rest of the file untouched. The spans come from `scanElementSpans`;
 * without them there is a document but no table.
 */

export type PlistType =
  | 'dict'
  | 'array'
  | 'string'
  | 'integer'
  | 'real'
  | 'date'
  | 'data'
  | 'boolean';

/** Xcode's own reading order in the type popup, minus its number ambiguity. */
export const PLIST_TYPES: readonly PlistType[] = [
  'array',
  'boolean',
  'data',
  'date',
  'dict',
  'integer',
  'real',
  'string',
];

/**
 * `integer` and `real` are labelled apart rather than both as Xcode's "Number".
 * Keeping them distinct is the reason this module exists at all — a table that
 * cannot tell 1 from 1.0 is the generic library's table.
 */
export const PLIST_TYPE_LABEL: Record<PlistType, string> = {
  dict: 'Dictionary',
  array: 'Array',
  string: 'String',
  integer: 'Integer',
  real: 'Real',
  date: 'Date',
  data: 'Data',
  boolean: 'Boolean',
};

export function isContainerType(type: PlistType): boolean {
  return type === 'dict' || type === 'array';
}

export interface PlistNode {
  type: PlistType;
  /** The `<key>` text for a dict entry; null for array items and the root. */
  key: string | null;
  /** Source span of the `<key>` element, for renames. Null when unkeyed. */
  keySpan: XmlSpan | null;
  /** Source span of the value element itself. */
  span: XmlSpan;
  /** Scalar text as written; `'true'`/`'false'` for boolean, `''` for containers. */
  value: string;
  children: PlistNode[];
  /** Child indices from the root — a row's identity across re-parses. */
  path: number[];
}

export interface PlistParse {
  root: PlistNode | null;
  /** Why a `<plist>` document has no usable tree. Null when it has one. */
  error: string | null;
}

/** One replacement against the code pane's buffer. */
export interface XmlChange {
  from: number;
  to: number;
  insert: string;
}

const TYPE_OF_TAG: Record<string, PlistType> = {
  dict: 'dict',
  array: 'array',
  string: 'string',
  integer: 'integer',
  real: 'real',
  date: 'date',
  data: 'data',
  true: 'boolean',
  false: 'boolean',
};

/**
 * A real Apple plist declares `-//Apple//DTD PLIST 1.0//EN`, but hand-edited
 * ones routinely drop or mangle the DOCTYPE line, so the root element is what
 * decides. Leniency here costs nothing: a non-plist document called `<plist>`
 * simply fails the typed walk below and falls back to the code pane.
 */
export function isPlistDocument(doc: Document): boolean {
  return doc.documentElement?.nodeName === 'plist';
}

/**
 * Most plists on a Mac are the **binary** `bplist00` format — compiled
 * `Info.plist`s, nearly every `NSUserDefaults` file — and this plan scopes
 * binary out. Sniffing the magic turns a wall of misdescribing XML parse errors
 * into one sentence naming the fix.
 */
export function looksBinaryPlist(text: string): boolean {
  return text.startsWith('bplist0');
}

/** What a brand-new Atlas document starts from — Xcode never hands you a blank file. */
export function plistSkeleton(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict/>',
    '</plist>',
    '',
  ].join('\n');
}

/**
 * The typed walk. Returns an error rather than a partial tree: a half-read
 * plist would render a table that silently omits rows, and the code pane is
 * always there to edit the document back into shape.
 */
export function parsePlist(doc: Document, spans: Map<Element, XmlSpan>): PlistParse {
  const root = doc.documentElement;
  if (!root || root.nodeName !== 'plist') return { root: null, error: 'not a plist document' };

  const body = root.firstElementChild;
  if (!body) return { root: null, error: 'this plist has no root value' };
  if (body.nextElementSibling) {
    return { root: null, error: 'a plist holds exactly one root value' };
  }

  let error: string | null = null;

  const walk = (
    element: Element,
    key: string | null,
    keySpan: XmlSpan | null,
    path: number[],
  ): PlistNode | null => {
    if (error) return null;
    const type = TYPE_OF_TAG[element.nodeName];
    if (!type) {
      error = `<${element.nodeName}> is not a plist value`;
      return null;
    }
    const span = spans.get(element);
    if (!span) {
      // Empty when the span scan and the DOM disagreed (see `zipSpans`). The
      // table's edits are byte offsets, so without them there is no table.
      error = 'source positions for this document are unavailable';
      return null;
    }

    const node: PlistNode = {
      type,
      key,
      keySpan,
      span,
      // A container has no value of its own: `textContent` on a <dict> is the
      // concatenation of every descendant's text, which would both display as
      // gibberish and follow a scalar conversion into the document.
      value: isContainerType(type)
        ? ''
        : type === 'boolean'
          ? String(element.nodeName === 'true')
          : (element.textContent ?? ''),
      children: [],
      path,
    };

    if (type === 'dict') {
      const kids = [...element.children];
      for (let i = 0; i < kids.length; i += 1) {
        const keyElement = kids[i];
        if (!keyElement) continue;
        if (keyElement.nodeName !== 'key') {
          error = `a <dict> entry must start with <key>, found <${keyElement.nodeName}>`;
          return null;
        }
        const valueElement = kids[i + 1];
        if (!valueElement) {
          error = `<key>${keyElement.textContent ?? ''}</key> has no value`;
          return null;
        }
        const childKeySpan = spans.get(keyElement) ?? null;
        if (!childKeySpan) {
          error = 'source positions for this document are unavailable';
          return null;
        }
        const child = walk(
          valueElement,
          keyElement.textContent ?? '',
          childKeySpan,
          [...path, node.children.length],
        );
        if (!child) return null;
        node.children.push(child);
        i += 1;
      }
    } else if (type === 'array') {
      for (const child of element.children) {
        const walked = walk(child, null, null, [...path, node.children.length]);
        if (!walked) return null;
        node.children.push(walked);
      }
    }

    return node;
  };

  const tree = walk(body, null, null, []);
  return tree ? { root: tree, error: null } : { root: null, error };
}

/** Find a node by the `path` its own walk gave it. */
export function nodeAtPath(root: PlistNode, path: readonly number[]): PlistNode | null {
  let node: PlistNode = root;
  for (const index of path) {
    const next = node.children[index];
    if (!next) return null;
    node = next;
  }
  return node;
}

// ---------------------------------------------------------------------------
// Edits
//
// Every edit is a single replacement against the source text, scoped to the
// smallest span that can express it. Value edits touch one value's characters;
// a type change has no "rename this element" DOM operation behind it, so it
// rewrites that element's own tags and nothing outside them.
// ---------------------------------------------------------------------------

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The whitespace at the start of the line `offset` sits on. */
function indentAt(text: string, offset: number): string {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  const prefix = text.slice(lineStart, offset);
  return /^[ \t]*$/.test(prefix) ? prefix : '';
}

/** Where an entry begins in the source: its `<key>` for a dict, its value otherwise. */
function blockStart(node: PlistNode): number {
  return node.keySpan ? node.keySpan.start : node.span.start;
}

function blockOf(node: PlistNode, text: string): string {
  return text.slice(blockStart(node), node.span.end);
}

/** Element text for a value of `type` holding `value` — the one emitter. */
export function renderValueElement(type: PlistType, value: string): string {
  switch (type) {
    case 'boolean':
      return value === 'true' ? '<true/>' : '<false/>';
    case 'dict':
      return '<dict/>';
    case 'array':
      return '<array/>';
    default:
      return `<${type}>${escapeText(value)}</${type}>`;
  }
}

/**
 * Commit a scalar's new text. A self-closing element (`<string/>`) has no inner
 * range to replace, so it is rewritten whole; everything else changes only the
 * characters between its tags, which is what makes the diff show one line.
 */
export function valueChange(node: PlistNode, value: string): XmlChange | null {
  if (isContainerType(node.type)) return null;
  if (node.type === 'boolean' || node.span.empty) {
    return { from: node.span.start, to: node.span.end, insert: renderValueElement(node.type, value) };
  }
  return { from: node.span.innerStart, to: node.span.innerEnd, insert: escapeText(value) };
}

/** Rename a dict entry's key. A collision is allowed — the advisory rail says so. */
export function keyChange(node: PlistNode, key: string): XmlChange | null {
  const span = node.keySpan;
  if (!span) return null;
  if (span.empty) return { from: span.start, to: span.end, insert: `<key>${escapeText(key)}</key>` };
  return { from: span.innerStart, to: span.innerEnd, insert: escapeText(key) };
}

/**
 * Convert a value between types, matching Xcode: a scalar turned into a
 * container loses its value (there is no sensible String→Array reading), and
 * between scalars anything with an obvious reading is carried across.
 */
export function convertValue(
  from: PlistType,
  to: PlistType,
  value: string,
  now: () => number = Date.now,
): string {
  if (isContainerType(to)) return '';
  const trimmed = value.trim();
  switch (to) {
    case 'string':
      return from === 'boolean' ? (trimmed === 'true' ? 'YES' : 'NO') : trimmed;
    case 'integer': {
      if (from === 'boolean') return trimmed === 'true' ? '1' : '0';
      const parsed = Number.parseFloat(trimmed);
      return Number.isFinite(parsed) ? String(Math.trunc(parsed)) : '0';
    }
    case 'real': {
      if (from === 'boolean') return trimmed === 'true' ? '1' : '0';
      const parsed = Number.parseFloat(trimmed);
      return Number.isFinite(parsed) ? String(parsed) : '0';
    }
    case 'boolean': {
      if (from === 'integer' || from === 'real') return String(Number.parseFloat(trimmed) !== 0);
      return String(/^(true|yes|1)$/i.test(trimmed));
    }
    case 'date':
      // A date has no meaningful empty form — `<date></date>` is not a date —
      // so an unparseable value becomes "now", which is what Xcode inserts too.
      return isPlistDate(trimmed) ? trimmed : formatPlistDate(now());
    case 'data':
      return isBase64(trimmed) ? trimmed : '';
    default:
      return trimmed;
  }
}

/** Replace a value element with one of a different type, tags and all. */
export function typeChange(
  node: PlistNode,
  to: PlistType,
  now: () => number = Date.now,
): XmlChange {
  return {
    from: node.span.start,
    to: node.span.end,
    insert: renderValueElement(to, convertValue(node.type, to, node.value, now)),
  };
}

/** "New item", then "New item 1", … — never silently overwriting a sibling. */
export function nextEntryKey(existing: readonly string[]): string {
  const taken = new Set(existing);
  if (!taken.has('New item')) return 'New item';
  for (let i = 1; i < 1000; i += 1) {
    const candidate = `New item ${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `New item ${Date.now()}`;
}

/**
 * Append an entry to a dict or array. A self-closing container has to be opened
 * up first — there is nowhere to put a child inside `<dict/>`.
 */
export function addEntryChange(
  container: PlistNode,
  text: string,
  indentUnit: string,
): XmlChange | null {
  if (!isContainerType(container.type)) return null;
  const containerIndent = indentAt(text, container.span.start);
  const last = container.children[container.children.length - 1];
  const childIndent = last ? indentAt(text, blockStart(last)) : containerIndent + indentUnit;

  const keyPart =
    container.type === 'dict'
      ? `<key>${escapeText(nextEntryKey(container.children.map((child) => child.key ?? '')))}</key>\n${childIndent}`
      : '';
  const block = `${keyPart}${renderValueElement('string', '')}`;

  if (container.span.empty) {
    return {
      from: container.span.start,
      to: container.span.end,
      insert: `<${container.type}>\n${childIndent}${block}\n${containerIndent}</${container.type}>`,
    };
  }
  const at = last ? last.span.end : container.span.innerStart;
  return { from: at, to: at, insert: `\n${childIndent}${block}` };
}

/**
 * Remove an entry, taking its whole line with it — leaving the indentation
 * behind would grow a column of blank space over a few deletes.
 */
export function removeEntryChange(node: PlistNode, text: string): XmlChange {
  const start = blockStart(node);
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const onlyIndentBefore = /^[ \t]*$/.test(text.slice(lineStart, start));
  const from = onlyIndentBefore && lineStart > 0 ? lineStart - 1 : start;
  return { from, to: node.span.end, insert: '' };
}

/**
 * Move a child to another index inside the same container.
 *
 * Rewrites only the span between the two entries involved, and re-emits each
 * entry from its **own source slice**, so every moved node stays byte-identical
 * down to its indentation. The separators between entries keep their positions
 * rather than travelling with a row — so a comment between two entries stays
 * where the author put it, the same way "move line up" behaves in any editor.
 */
export function reorderChange(
  container: PlistNode,
  fromIndex: number,
  toIndex: number,
  text: string,
): XmlChange | null {
  const entries = container.children;
  if (fromIndex === toIndex) return null;
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= entries.length || toIndex >= entries.length) {
    return null;
  }

  const lo = Math.min(fromIndex, toIndex);
  const hi = Math.max(fromIndex, toIndex);
  const window = entries.slice(lo, hi + 1);
  const blocks = window.map((entry) => blockOf(entry, text));
  const separators: string[] = [];
  for (let i = 0; i < window.length - 1; i += 1) {
    const left = window[i];
    const right = window[i + 1];
    if (!left || !right) return null;
    separators.push(text.slice(left.span.end, blockStart(right)));
  }

  const moved = blocks.splice(fromIndex - lo, 1)[0];
  if (moved === undefined) return null;
  blocks.splice(toIndex - lo, 0, moved);

  const first = window[0];
  const last = window[window.length - 1];
  if (!first || !last) return null;
  const insert = blocks.reduce(
    (acc, block, index) => (index === 0 ? block : acc + (separators[index - 1] ?? '\n') + block),
    '',
  );
  return { from: blockStart(first), to: last.span.end, insert };
}

// ---------------------------------------------------------------------------
// Value formats — shared with the advisory rail so both agree on what is valid.
// ---------------------------------------------------------------------------

/** Apple writes plist dates as `YYYY-MM-DDTHH:MM:SSZ`, always UTC. */
export const PLIST_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

export function isPlistDate(value: string): boolean {
  if (!PLIST_DATE_RE.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

export function formatPlistDate(at: number): string {
  return `${new Date(at).toISOString().slice(0, 19)}Z`;
}

/**
 * `<data>` is base64 and is written wrapped across lines, so whitespace is
 * stripped before the check — a valid, indented blob must not be flagged.
 */
export function isBase64(value: string): boolean {
  const compact = value.replace(/\s+/g, '');
  if (compact === '') return true;
  if (compact.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(compact);
}
