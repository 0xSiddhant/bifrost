/**
 * "Does this look like Markdown?" as a boolean — genuinely new code, because
 * nothing else in this codebase has ever needed to answer it (PLAN-25).
 *
 * Every other format in the detector can lean on a real parser: JSON, XML and
 * YAML each *fail* on text that isn't them. Markdown's grammar is permissive
 * enough that nearly anything parses as some Markdown, so "did it parse" is
 * worthless here — a prose paragraph is a valid Markdown document, and offering
 * "Open in Edda" for every plain-text file is exactly the always-true fallback
 * this detector was asked not to be.
 *
 * So: count *kinds* of construct, and require at least two distinct ones. One
 * stray asterisk in a sentence is not Markdown; a heading with a list under it
 * is. Two is deliberately the floor rather than one — a single `#` at the top
 * of a config file or one bare hyphen list in a changelog fragment is weaker
 * evidence than this button's copy ("Open in Edda") implies.
 */

const CONSTRUCTS: readonly RegExp[] = [
  /** ATX heading: `# ` through `###### `. */
  /^ {0,3}#{1,6}\s+\S/m,
  /** Fenced code block. */
  /^ {0,3}(?:```|~~~)/m,
  /** Bullet list item — the space matters, or `*emphasis*` counts as a list. */
  /^ {0,3}[-*+]\s+\S/m,
  /** Ordered list item. */
  /^ {0,3}\d+[.)]\s+\S/m,
  /** Inline link or image. */
  /!?\[[^\]\n]*\]\([^)\s]+[^)]*\)/,
  /** Bold or italic, paired on one line so a lone marker never counts. */
  /(\*\*|__)(?!\s)[^\n*_]+(\*\*|__)|(?<![*\w])[*_](?!\s)[^\n*_]+[*_](?![*\w])/,
  /** Blockquote. */
  /^ {0,3}>\s+\S/m,
  /** Setext underline, or a table's delimiter row. */
  /^ {0,3}(?:={3,}|-{3,})\s*$|^\s*\|?[\s:-]*\|[\s:|-]*$/m,
];

/** How many distinct construct kinds appear. Exported for the tests to explain a verdict. */
export function markdownConstructCount(text: string): number {
  return CONSTRUCTS.filter((pattern) => pattern.test(text)).length;
}

/** True once at least two distinct Markdown constructs are present. */
export function looksLikeMarkdown(text: string): boolean {
  return markdownConstructCount(text) >= 2;
}
