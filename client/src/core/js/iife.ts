/**
 * Wrap source in an arrow IIFE and unwrap it back (Loki, PLAN-12). Inverses:
 * `unwrapIife(wrapIife(code)) === code` for any input (property-tested).
 */

const INDENT = '  ';

/** Wrap `code` in `(() => { … })();`, indenting the body by two spaces. */
export function wrapIife(code: string): string {
  const body = code
    .split('\n')
    // Don't indent blank lines — avoids introducing trailing whitespace that
    // unwrap would then have to guess about.
    .map((line) => (line === '' ? '' : INDENT + line))
    .join('\n');
  return `(() => {\n${body}\n})();`;
}

const OPEN = /^\(\s*(?:async\s+)?(?:function\s*\*?\s*[A-Za-z0-9_$]*\s*\([^)]*\)|\([^)]*\)\s*=>)\s*\{\n?/;
const CLOSE = /\n?\}\s*\)\s*\(\s*\)\s*;?\s*$/;

/**
 * Unwrap a single wrapping IIFE, dedenting the body by two spaces. Returns the
 * input unchanged when it is not recognizably a wrapping IIFE.
 */
export function unwrapIife(code: string): string {
  const trimmed = code.trim();
  const openMatch = OPEN.exec(trimmed);
  if (!openMatch || !CLOSE.test(trimmed)) return code;
  const inner = trimmed.slice(openMatch[0].length).replace(CLOSE, '');
  return inner
    .split('\n')
    .map((line) => (line.startsWith(INDENT) ? line.slice(INDENT.length) : line))
    .join('\n');
}
