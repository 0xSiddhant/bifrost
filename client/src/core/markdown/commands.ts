/**
 * Toolbar/keyboard markdown edits as pure functions (PLAN-11). Each takes the
 * current document + selection and returns the next document + selection, so
 * wrap/unwrap round-trips are unit-testable without a CodeMirror instance. The
 * editor's imperative handle turns the result into a minimal CM transaction.
 */

export interface DocSelection {
  doc: string;
  from: number;
  to: number;
}

export type MarkdownCommand =
  | 'bold'
  | 'italic'
  | 'strikethrough'
  | 'code'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'link'
  | 'quote'
  | 'bulletList'
  | 'numberList'
  | 'taskList'
  | 'codeFence'
  | 'table';

/** Toggle an inline wrap (bold/italic/code/strike) around the selection. */
function toggleWrap(sel: DocSelection, open: string, close: string = open): DocSelection {
  const { doc, from, to } = sel;
  const before = doc.slice(Math.max(0, from - open.length), from);
  const after = doc.slice(to, to + close.length);
  // Markers sit just outside the selection → unwrap them.
  if (before === open && after === close) {
    const doc2 = doc.slice(0, from - open.length) + doc.slice(from, to) + doc.slice(to + close.length);
    return { doc: doc2, from: from - open.length, to: to - open.length };
  }
  const selected = doc.slice(from, to);
  // Markers are inside the selection → unwrap them.
  if (
    selected.length >= open.length + close.length &&
    selected.startsWith(open) &&
    selected.endsWith(close)
  ) {
    const inner = selected.slice(open.length, selected.length - close.length);
    return { doc: doc.slice(0, from) + inner + doc.slice(to), from, to: from + inner.length };
  }
  const doc2 = doc.slice(0, from) + open + selected + close + doc.slice(to);
  return { doc: doc2, from: from + open.length, to: to + open.length };
}

/** The [start,end] offsets of the block of whole lines the selection touches. */
function lineBlock(doc: string, from: number, to: number): { start: number; end: number } {
  const start = doc.lastIndexOf('\n', from - 1) + 1;
  const nl = doc.indexOf('\n', to);
  const end = nl === -1 ? doc.length : nl;
  return { start, end };
}

/**
 * Selection to return from a block command. With no prior selection (the
 * insert-a-tag-then-type case) the cursor collapses to the end of the block, so
 * the next keystroke extends the block rather than replacing it — leaving the
 * whole block selected was the "type wipes the tag" bug. When the user did have
 * a selection, keep the block selected so a re-toggle covers all its lines.
 */
function blockResult(doc: string, sel: DocSelection, start: number, length: number): DocSelection {
  if (sel.from === sel.to) {
    const caret = start + length;
    return { doc, from: caret, to: caret };
  }
  return { doc, from: start, to: start + length };
}

/** Add/remove a per-line prefix over the selected block (bullets, quote, tasks). */
function togglePrefix(
  sel: DocSelection,
  prefix: string | ((index: number) => string),
  matcher: RegExp,
): DocSelection {
  const { doc } = sel;
  const { start, end } = lineBlock(doc, sel.from, sel.to);
  const block = doc.slice(start, end);
  const lines = block.split('\n');
  const allPrefixed = lines.every((line) => matcher.test(line));
  const next = lines
    .map((line, index) => {
      if (allPrefixed) return line.replace(matcher, '');
      return (typeof prefix === 'string' ? prefix : prefix(index)) + line;
    })
    .join('\n');
  const doc2 = doc.slice(0, start) + next + doc.slice(end);
  return blockResult(doc2, sel, start, next.length);
}

/** Toggle an ATX heading level on the block's lines (same level → plain). */
function toggleHeading(sel: DocSelection, level: number): DocSelection {
  const { doc } = sel;
  const { start, end } = lineBlock(doc, sel.from, sel.to);
  const block = doc.slice(start, end);
  const hashes = '#'.repeat(level);
  const lines = block.split('\n');
  const allAtLevel = lines.every((line) => line.startsWith(`${hashes} `));
  const next = lines
    .map((line) => {
      const stripped = line.replace(/^#{1,6}\s+/, '');
      return allAtLevel ? stripped : `${hashes} ${stripped}`;
    })
    .join('\n');
  const doc2 = doc.slice(0, start) + next + doc.slice(end);
  return blockResult(doc2, sel, start, next.length);
}

/** Wrap the selected lines in a fenced code block. */
function fence(sel: DocSelection): DocSelection {
  const { doc } = sel;
  const { start, end } = lineBlock(doc, sel.from, sel.to);
  const block = doc.slice(start, end);
  const inserted = `\`\`\`\n${block}\n\`\`\``;
  const doc2 = doc.slice(0, start) + inserted + doc.slice(end);
  // Select the language slot right after the opening fence.
  return { doc: doc2, from: start + 3, to: start + 3 };
}

const LINK_PLACEHOLDER = 'https://';

/**
 * `[text](https://)` with a collapsed cursor at the end of the URL scheme, so
 * typing extends the URL (`https://…`). Selecting the placeholder instead would
 * make the first keystroke delete the `https://` the user is meant to keep.
 */
function link(sel: DocSelection): DocSelection {
  const { doc, from, to } = sel;
  const text = doc.slice(from, to) || 'link text';
  const inserted = `[${text}](${LINK_PLACEHOLDER})`;
  const doc2 = doc.slice(0, from) + inserted + doc.slice(to);
  const caret = from + `[${text}](${LINK_PLACEHOLDER}`.length;
  return { doc: doc2, from: caret, to: caret };
}

const TABLE_SNIPPET =
  '| Column A | Column B |\n| --- | --- |\n| Cell | Cell |\n| Cell | Cell |';

/** Insert a starter GFM table on its own line(s). */
function table(sel: DocSelection): DocSelection {
  const { doc, from } = sel;
  const atLineStart = from === 0 || doc[from - 1] === '\n';
  const inserted = (atLineStart ? '' : '\n') + TABLE_SNIPPET + '\n';
  const doc2 = doc.slice(0, from) + inserted + doc.slice(from);
  return { doc: doc2, from: from + inserted.length, to: from + inserted.length };
}

export function runCommand(command: MarkdownCommand, sel: DocSelection): DocSelection {
  switch (command) {
    case 'bold':
      return toggleWrap(sel, '**');
    case 'italic':
      return toggleWrap(sel, '_');
    case 'strikethrough':
      return toggleWrap(sel, '~~');
    case 'code':
      return toggleWrap(sel, '`');
    case 'h1':
      return toggleHeading(sel, 1);
    case 'h2':
      return toggleHeading(sel, 2);
    case 'h3':
      return toggleHeading(sel, 3);
    case 'link':
      return link(sel);
    case 'quote':
      return togglePrefix(sel, '> ', /^> ?/);
    case 'bulletList':
      return togglePrefix(sel, '- ', /^[-*] /);
    case 'numberList':
      return togglePrefix(sel, (index) => `${index + 1}. `, /^\d+\.\s/);
    case 'taskList':
      return togglePrefix(sel, '- [ ] ', /^- \[[ xX]\]\s/);
    case 'codeFence':
      return fence(sel);
    case 'table':
      return table(sel);
  }
}
