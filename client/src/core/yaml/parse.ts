import { parseAllDocuments, parseDocument, type Document } from 'yaml';

/**
 * Cap on alias expansions per materialisation. YAML aliases are a
 * **billion-laughs amplifier**: seven nested nine-way anchors turn a 300-byte
 * document into billions of nodes, so a byte cap does not bound the parse.
 *
 * The guard belongs on `toJS()`, not on `parseDocument()` — building the AST
 * never expands an alias (it stores `*a` as one node); expansion happens the
 * moment the document is turned into a value. Formatting therefore never needs
 * the guard, and `toValue` always does.
 *
 * 100 is generously above any hand-written config and far below the point
 * where expansion costs anything.
 */
export const MAX_ALIAS_COUNT = 100;

/** Parse to the comment-preserving document model. Never throws. */
export function parseYamlDocument(text: string): Document.Parsed {
  return parseDocument(text, { keepSourceTokens: false });
}

/** Every document in a `---`-separated stream. Never throws. */
export function parseYamlDocuments(text: string): Document.Parsed[] {
  return parseAllDocuments(text, { keepSourceTokens: false });
}

/**
 * Materialise a document to a plain JS value, bounded by {@link MAX_ALIAS_COUNT}.
 * Returns `{ ok: false }` on a bomb rather than throwing, because every caller
 * is rendering a UI and an exception here would take the page with it.
 */
export function toValue(doc: Document.Parsed): { ok: true; value: unknown } | { ok: false; reason: string } {
  try {
    return { ok: true, value: doc.toJS({ maxAliasCount: MAX_ALIAS_COUNT }) };
  } catch (error) {
    // Not a swallow: the reason is returned and every caller surfaces it. The
    // library signals the bomb by throwing, so this is the only way to catch it.
    return {
      ok: false,
      reason:
        error instanceof Error && /alias/i.test(error.message)
          ? `This document expands to too many nodes (over ${MAX_ALIAS_COUNT} alias uses) — refusing to expand it.`
          : 'This document could not be turned into a value.',
    };
  }
}

/**
 * The library's messages carry a caret diagram — "Map keys must be unique at
 * line 2, column 1:\n\na: 1\n^\n" — which is right for a terminal and wrong for
 * a one-line lint tooltip that already sits on the offending line.
 */
export function shortMessage(message: string): string {
  const cut = message.split(/ at line \d+, column \d+/)[0] ?? message;
  return cut.trim() || message.split('\n')[0]?.trim() || 'Invalid YAML.';
}

/** 1-based line number for a document offset. */
export function lineAt(text: string, offset: number): number {
  let line = 1;
  const limit = Math.min(offset, text.length);
  for (let index = 0; index < limit; index += 1) {
    if (text.charCodeAt(index) === 10) line += 1;
  }
  return line;
}
