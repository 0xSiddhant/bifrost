/**
 * Text ⇄ bytes, number bases, and text statistics (PLAN-18).
 */

export type ByteFormat = 'hex' | 'binary' | 'decimal';
export type NumberBase = 2 | 8 | 10 | 16;

const RADIX: Record<ByteFormat, number> = { hex: 16, binary: 2, decimal: 10 };
const WIDTH: Record<ByteFormat, number> = { hex: 2, binary: 8, decimal: 0 };

/** UTF-8 bytes of `text` in the requested notation, space-separated. */
export function textToBytes(text: string, format: ByteFormat): string {
  const bytes = new TextEncoder().encode(text);
  return Array.from(bytes, (byte) => byte.toString(RADIX[format]).padStart(WIDTH[format], '0')).join(
    ' ',
  );
}

/**
 * The reverse. Separators are optional for hex and binary — a wall of hex
 * digits is what people paste — but *required* for decimal, where `1234` is
 * genuinely ambiguous between one byte and four.
 */
export function bytesToText(input: string, format: ByteFormat): { value: string; error: string | null } {
  const compact = input.trim();
  if (!compact) return { value: '', error: null };

  let tokens: string[];
  const separated = compact.split(/[\s,]+/).filter(Boolean);
  if (format === 'decimal') {
    tokens = separated;
  } else if (separated.length > 1) {
    tokens = separated;
  } else {
    const width = WIDTH[format];
    const digits = compact.replace(/^0[xb]/i, '');
    if (digits.length % width !== 0) {
      return {
        value: '',
        error: `That is ${digits.length} digits — ${format} bytes come in groups of ${width}.`,
      };
    }
    tokens = digits.match(new RegExp(`.{${width}}`, 'g')) ?? [];
  }

  const bytes = new Uint8Array(tokens.length);
  for (let i = 0; i < tokens.length; i += 1) {
    const token = (tokens[i] ?? '').replace(/^0[xb]/i, '');
    const value = Number.parseInt(token, RADIX[format]);
    if (!/^[0-9a-f]+$/i.test(token) || Number.isNaN(value) || value < 0 || value > 255) {
      return { value: '', error: `"${tokens[i]}" is not a byte in ${format}.` };
    }
    bytes[i] = value;
  }
  try {
    return { value: new TextDecoder('utf-8', { fatal: true }).decode(bytes), error: null };
  } catch {
    return { value: '', error: 'Those bytes are not valid UTF-8 text.' };
  }
}

export interface BaseConversion {
  binary: string;
  octal: string;
  decimal: string;
  hex: string;
}

/**
 * Convert between number bases through **BigInt**: a 64-bit id pasted here —
 * a Snowflake, a database key — is past `Number.MAX_SAFE_INTEGER`, and
 * silently rounding the last few digits would be the worst possible failure
 * for a conversion tool.
 */
export function convertBase(input: string, from: NumberBase): BaseConversion | null {
  const text = input.trim().replace(/[\s_,]/g, '').replace(/^0[xbo]/i, '');
  if (!text) return null;
  const allowed: Record<NumberBase, RegExp> = {
    2: /^[01]+$/,
    8: /^[0-7]+$/,
    10: /^\d+$/,
    16: /^[0-9a-f]+$/i,
  };
  if (!allowed[from].test(text)) return null;
  let value: bigint;
  try {
    value = [...text.toLowerCase()].reduce(
      (acc, digit) => acc * BigInt(from) + BigInt(Number.parseInt(digit, from)),
      0n,
    );
  } catch {
    return null;
  }
  return {
    binary: value.toString(2),
    octal: value.toString(8),
    decimal: value.toString(10),
    hex: value.toString(16).toUpperCase(),
  };
}

export interface TextStats {
  bytes: number;
  characters: number;
  /** Code points, which is what a person means by "characters". */
  graphemes: number;
  words: number;
  lines: number;
}

export function textStats(text: string): TextStats {
  return {
    bytes: new TextEncoder().encode(text).length,
    characters: text.length,
    graphemes: [...text].length,
    words: text.trim() ? text.trim().split(/\s+/).length : 0,
    lines: text === '' ? 0 : text.split('\n').length,
  };
}
