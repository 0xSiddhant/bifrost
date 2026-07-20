/**
 * Pure text normalizers for Variant's text mode (PLAN-08). The compare view
 * diffs normalized copies, so each option is a total function of the input —
 * no editor state involved.
 */

export interface TextNormalizeOptions {
  /** CRLF/CR → LF. Default on — line-ending-only differences are noise. */
  normalizeEol?: boolean;
  /** Strip leading and trailing whitespace on every line. */
  trimLines?: boolean;
  /** Remove every space/tab run entirely (implies trimLines). */
  stripWhitespace?: boolean;
  /** Lowercase the whole text. */
  ignoreCase?: boolean;
  /** Drop lines that are empty (after any trimming). */
  dropBlankLines?: boolean;
}

export function normalizeText(text: string, options: TextNormalizeOptions = {}): string {
  const {
    normalizeEol = true,
    trimLines = false,
    stripWhitespace = false,
    ignoreCase = false,
    dropBlankLines = false,
  } = options;

  let out = normalizeEol ? text.replace(/\r\n?/g, '\n') : text;
  if (stripWhitespace) {
    out = out
      .split('\n')
      .map((line) => line.replace(/[ \t]+/g, ''))
      .join('\n');
  } else if (trimLines) {
    out = out
      .split('\n')
      .map((line) => line.replace(/^[ \t]+|[ \t]+$/g, ''))
      .join('\n');
  }
  if (dropBlankLines) {
    out = out
      .split('\n')
      .filter((line) => line.trim() !== '')
      .join('\n');
  }
  if (ignoreCase) out = out.toLowerCase();
  return out;
}

/** True when any option beyond the always-on EOL normalization is active. */
export function hasActiveNormalization(options: TextNormalizeOptions): boolean {
  return Boolean(
    options.trimLines || options.stripWhitespace || options.ignoreCase || options.dropBlankLines,
  );
}
