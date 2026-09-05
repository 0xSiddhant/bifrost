/**
 * Base64, UTF-8 correct (PLAN-18).
 *
 * `btoa` takes a "binary string" — one char per byte — so `btoa('héllo')`
 * throws InvalidCharacterError the moment anything outside Latin-1 appears, and
 * `btoa(unescape(encodeURIComponent(s)))` (the old workaround) leans on a
 * deprecated function. Encoding through TextEncoder/TextDecoder makes the byte
 * layer explicit and round-trips emoji, which a toolbox that anyone can paste
 * into has to do.
 */

export type Base64Variant = 'standard' | 'url-safe';

/** Base64 of the UTF-8 bytes of `text`. */
export function encodeBase64(text: string, variant: Base64Variant = 'standard'): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  // Chunked: String.fromCharCode(...bytes) blows the argument limit on a large
  // paste, which would read as "the tool broke on big inputs".
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  const standard = btoa(binary);
  return variant === 'url-safe' ? toUrlSafe(standard) : standard;
}

/**
 * Raised when the Base64 was perfectly good but what came out is not text.
 *
 * These are two different failures and they need two different answers. A
 * compressed blob, an image or a key decodes to bytes no UTF-8 decoder will
 * take, and telling someone their Base64 is malformed when it is not sends
 * them hunting for a stray character that was never there.
 */
export class NotTextError extends Error {
  constructor(public readonly byteLength: number) {
    super('the decoded bytes are not text');
    this.name = 'NotTextError';
  }
}

/** Bytes from Base64, accepting either variant and missing padding. */
export function decodeBase64Bytes(encoded: string): Uint8Array {
  const binary = atob(normalizeBase64(encoded));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Text from Base64. Throws `NotTextError` when the bytes decode but aren't text. */
export function decodeBase64(encoded: string): string {
  const bytes = decodeBase64Bytes(encoded);
  try {
    // `fatal` so mojibake surfaces as an error instead of a string of U+FFFD
    // that looks like a successful decode.
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new NotTextError(bytes.length);
  }
}

/** `+/` → `-_`, padding dropped (RFC 4648 §5). */
export function toUrlSafe(standard: string): string {
  return standard.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Accept what people actually paste: either alphabet, no padding, and stray
 * whitespace from a wrapped terminal copy.
 */
export function normalizeBase64(input: string): string {
  const compact = input.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const remainder = compact.length % 4;
  if (remainder === 0) return compact;
  // A length of 4n+1 is not valid base64 at all — leave it alone so atob
  // reports it rather than us inventing padding that hides the problem.
  if (remainder === 1) return compact;
  return compact + '='.repeat(4 - remainder);
}

export interface Base64Result {
  value: string;
  error: string | null;
}

/** The tool's one entry point: never throws, returns the message to show. */
export function runBase64(
  input: string,
  mode: 'encode' | 'decode',
  variant: Base64Variant,
): Base64Result {
  if (!input) return { value: '', error: null };
  try {
    return {
      value: mode === 'encode' ? encodeBase64(input, variant) : decodeBase64(input),
      error: null,
    };
  } catch (error) {
    if (error instanceof NotTextError) {
      return {
        value: '',
        error: `That is valid Base64, but it decodes to ${error.byteLength} bytes of binary data rather than text — a compressed blob, an image or a key, for instance.`,
      };
    }
    return {
      value: '',
      error:
        mode === 'decode'
          ? 'That is not valid Base64 — check for stray characters or a truncated string.'
          : 'Could not encode that text.',
    };
  }
}
