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
  constructor(public readonly bytes: Uint8Array) {
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
    throw new NotTextError(bytes);
  }
}

/** A binary format recognised by its leading bytes, for naming a download. */
export interface FileType {
  /** How the panel's sentence names it: "a PNG image". */
  label: string;
  extension: string;
  mime: string;
}

/**
 * Leading-byte signatures, each fixed by its format's own specification, so a
 * match is never a guess. Only the kinds people actually paste as Base64: an
 * image out of a data URI, a PDF out of an API response, an archive out of a
 * config value. `null` is a byte the format leaves free (WebP's RIFF length).
 * Anything else is offered as `.bin`, which is still the right bytes.
 */
const SIGNATURES: ReadonlyArray<{ magic: ReadonlyArray<number | null>; type: FileType }> = [
  {
    magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    type: { label: 'a PNG image', extension: 'png', mime: 'image/png' },
  },
  {
    magic: [0xff, 0xd8, 0xff],
    type: { label: 'a JPEG image', extension: 'jpg', mime: 'image/jpeg' },
  },
  {
    magic: [0x47, 0x49, 0x46, 0x38],
    type: { label: 'a GIF image', extension: 'gif', mime: 'image/gif' },
  },
  {
    magic: [0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50],
    type: { label: 'a WebP image', extension: 'webp', mime: 'image/webp' },
  },
  {
    magic: [0x25, 0x50, 0x44, 0x46, 0x2d],
    type: { label: 'a PDF', extension: 'pdf', mime: 'application/pdf' },
  },
  {
    magic: [0x50, 0x4b, 0x03, 0x04],
    type: { label: 'a zip archive', extension: 'zip', mime: 'application/zip' },
  },
  {
    magic: [0x1f, 0x8b],
    type: { label: 'gzip data', extension: 'gz', mime: 'application/gzip' },
  },
];

/** What the leading bytes say the data is, or `null` when they match nothing known. */
export function sniffFileType(bytes: Uint8Array): FileType | null {
  const match = SIGNATURES.find(
    ({ magic }) =>
      bytes.length >= magic.length && magic.every((byte, i) => byte === null || bytes[i] === byte),
  );
  return match ? match.type : null;
}

/** Bytes that decoded fine but are not text: offered as a file instead. */
export interface DecodedBinary {
  bytes: Uint8Array;
  type: FileType | null;
  /** `decoded.png`, or `decoded.bin` when the type is unknown. */
  filename: string;
  /** The sentence the panel shows where the text would have been. */
  message: string;
}

function describeBinary(bytes: Uint8Array): DecodedBinary {
  const type = sniffFileType(bytes);
  const what = type
    ? `its first bytes mark it as ${type.label}.`
    : 'a compressed blob, an image or a key, for instance.';
  return {
    bytes,
    type,
    filename: `decoded.${type ? type.extension : 'bin'}`,
    message: `That is valid Base64, but it decodes to ${bytes.length} bytes of binary data rather than text — ${what}`,
  };
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
  /**
   * Set, with `error` null, when the Base64 decodes to bytes that are not
   * text. Not an error: the decode worked, and the bytes are offered as a file.
   */
  binary: DecodedBinary | null;
}

/** The tool's one entry point: never throws, returns the message to show. */
export function runBase64(
  input: string,
  mode: 'encode' | 'decode',
  variant: Base64Variant,
): Base64Result {
  if (!input) return { value: '', error: null, binary: null };
  try {
    return {
      value: mode === 'encode' ? encodeBase64(input, variant) : decodeBase64(input),
      error: null,
      binary: null,
    };
  } catch (error) {
    if (error instanceof NotTextError) {
      return { value: '', error: null, binary: describeBinary(error.bytes) };
    }
    return {
      value: '',
      error:
        mode === 'decode'
          ? 'That is not valid Base64 — check for stray characters or a truncated string.'
          : 'Could not encode that text.',
      binary: null,
    };
  }
}
