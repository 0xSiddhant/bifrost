import type { Readable } from 'node:stream';

/**
 * Brotli quality levels this module will actually use. The route maps the
 * three-value `fast|balanced|best` enum onto these before the codec is ever
 * called, so nothing below this line has to sanity-check a raw 0–11 number.
 */
export const BROTLI_QUALITY = { fast: 4, balanced: 9, best: 11 } as const;

export type BrotliQualityName = keyof typeof BROTLI_QUALITY;
export type BrotliQuality = (typeof BROTLI_QUALITY)[BrotliQualityName];

export const BROTLI_QUALITY_NAMES = Object.keys(BROTLI_QUALITY) as BrotliQualityName[];

/**
 * The one seam `zlib` lives behind. PLAN-24's self-review caught a usecase
 * reaching for `fs` and a route reaching for `archiver`; this module starts on
 * the other side of that lesson — only `NodeBrotliCodec` imports zlib's Brotli
 * API, and the usecases depend on this interface.
 */
export interface BrotliCodec {
  /**
   * Compresses `input` at `quality`. The returned stream errors with a
   * `BrotliLimitError` if the source exceeds `maxInputBytes`.
   */
  compress(input: Readable, quality: BrotliQuality, maxInputBytes: number): Readable;
  /**
   * Decompresses `input`. The returned stream errors with a `BrotliLimitError`
   * if the OUTPUT would exceed `maxOutputBytes` (the decompression-bomb guard),
   * or with a `BrotliDecodeError` when the bytes are not valid Brotli at all.
   */
  decompress(input: Readable, maxOutputBytes: number): Readable;
}

/** A cap was blown — input on compress, manufactured output on decompress. */
export class BrotliLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrotliLimitError';
  }
}

/** The bytes were not valid Brotli (wrong file, truncated stream). */
export class BrotliDecodeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'BrotliDecodeError';
  }
}
