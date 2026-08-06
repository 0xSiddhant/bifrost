/**
 * Password generation (PLAN-18). Bytes come from `crypto.getRandomValues`,
 * which — unlike `crypto.randomUUID`/`crypto.subtle` — is not restricted to a
 * secure context, so this works on every LAN device and not just the host Mac.
 */

export interface CharsetOptions {
  lower: boolean;
  upper: boolean;
  digits: boolean;
  symbols: boolean;
  /** Drop 0/O/1/l/I — the characters people mistype off a screen. */
  avoidAmbiguous: boolean;
}

const SETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.?/',
};

const AMBIGUOUS = new Set(['0', 'O', 'o', '1', 'l', 'I', '5', 'S', '2', 'Z']);

export function buildAlphabet(options: CharsetOptions): string {
  let alphabet = '';
  if (options.lower) alphabet += SETS.lower;
  if (options.upper) alphabet += SETS.upper;
  if (options.digits) alphabet += SETS.digits;
  if (options.symbols) alphabet += SETS.symbols;
  if (options.avoidAmbiguous) {
    alphabet = [...alphabet].filter((char) => !AMBIGUOUS.has(char)).join('');
  }
  return alphabet;
}

/**
 * Pick `length` characters uniformly.
 *
 * Rejection sampling, not `byte % alphabet.length`: with a 24-character symbol
 * set the modulo maps 256 byte values onto 24 characters unevenly, so the
 * first 16 become measurably more likely than the rest. Discarding the bytes
 * that fall in the ragged tail costs a few extra draws and makes the entropy
 * figure below actually true.
 */
export function generatePassword(length: number, options: CharsetOptions): string {
  const alphabet = buildAlphabet(options);
  if (alphabet.length === 0) return '';
  const size = Math.min(256, Math.max(1, Math.trunc(length) || 1));
  const limit = Math.floor(256 / alphabet.length) * alphabet.length;

  let out = '';
  const buffer = new Uint8Array(size * 2);
  while (out.length < size) {
    crypto.getRandomValues(buffer);
    for (const byte of buffer) {
      if (out.length >= size) break;
      if (byte >= limit) continue;
      out += alphabet.charAt(byte % alphabet.length);
    }
  }
  return out;
}

export interface Strength {
  bits: number;
  label: 'weak' | 'fair' | 'strong' | 'very strong';
  alphabetSize: number;
}

/**
 * Entropy of the *generator*, not of a particular string: length × log2(set).
 * Honest only because the picking above is uniform.
 */
export function estimateStrength(length: number, options: CharsetOptions): Strength {
  const alphabetSize = buildAlphabet(options).length;
  const bits = alphabetSize > 0 ? Math.round(length * Math.log2(alphabetSize)) : 0;
  let label: Strength['label'] = 'weak';
  if (bits >= 128) label = 'very strong';
  else if (bits >= 80) label = 'strong';
  else if (bits >= 60) label = 'fair';
  return { bits, label, alphabetSize };
}
