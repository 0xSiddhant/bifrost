import zlib from 'node:zlib';
import { pipeline, Readable, Transform } from 'node:stream';
import {
  BrotliDecodeError,
  BrotliLimitError,
  type BrotliCodec,
  type BrotliQuality,
} from '../ports.js';

/**
 * The only file in this module that imports zlib's Brotli API (PLAN-25).
 * Everything above it — usecases, routes — moves streams around and never
 * learns which codec is underneath.
 *
 * **Large-window mode is deliberately never enabled.** `BROTLI_PARAM_LARGE_WINDOW`
 * is an HTTP-compression extension that not every decoder supports, and this
 * tool's whole claim is that its output is universally decodable, so the
 * encoder is left at the standard window the reference codec defaults to. The
 * page states that as a fact in its footer; a unit test proves it by decoding
 * output with a decoder that refuses large-window streams.
 */
export class NodeBrotliCodec implements BrotliCodec {
  compress(input: Readable, quality: BrotliQuality, maxInputBytes: number): Readable {
    const counter = cappedCounter(
      maxInputBytes,
      `input exceeds the configured ${mb(maxInputBytes)} MB cap`,
    );
    const compressor = zlib.createBrotliCompress({
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: quality },
    });
    // Counting happens before the compressor so the cap bounds what was *sent*,
    // which is the number the client can be told about and the one the
    // content-length pre-check is an early approximation of.
    return guarded(pipeline(muted(input), counter, compressor, noopSettled), (error) => error);
  }

  decompress(input: Readable, maxOutputBytes: number): Readable {
    const counter = cappedCounter(
      maxOutputBytes,
      `decompressed output exceeds the configured ${mb(maxOutputBytes)} MB cap`,
    );
    const decompressor = zlib.createBrotliDecompress();
    // The counter sits AFTER the decompressor: what has to be bounded here is
    // the output this server manufactures, not the input a client sent. That is
    // the decompression-bomb guard, and there is no cheap pre-check for it —
    // a compressed size says nothing about the size it expands to.
    return guarded(pipeline(muted(input), decompressor, counter, noopSettled), (error) =>
      error instanceof BrotliLimitError
        ? error
        : new BrotliDecodeError('input is not valid brotli data', { cause: error }),
    );
  }
}

/** Whole megabytes, for a message a person reads rather than a machine parses. */
function mb(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}

/**
 * Errors are surfaced through the stream this returns (and logged by the
 * usecase that owns it), so `pipeline`'s callback has nothing left to do —
 * it exists only to keep a failure from being reported as unhandled.
 */
function noopSettled(): void {}

/**
 * `pipeline` reports a failure by destroying every stream it touches — the
 * source included, even when the failure came from further down it. The source
 * here is the live request, which nothing else is listening to for errors, so
 * that echo would land as an unhandled exception the moment a cap trips.
 *
 * Silence is correct: the very same failure is already carried out through the
 * stream this module returns, where the usecase logs it and the route answers
 * for it. Listening again here would only double the line.
 */
function muted(input: Readable): Readable {
  input.on('error', () => {});
  return input;
}

/**
 * Counts what flows through and destroys the pipeline the instant the cap
 * would be passed. Deliberately *not* the upload path's "keep draining"
 * behaviour: that exists so one oversized file doesn't take its siblings down
 * with it, and there are no siblings here — one request, one stream, and
 * reading further is precisely the thing being defended against.
 */
function cappedCounter(maxBytes: number, message: string): Transform {
  let total = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      total += chunk.length;
      if (total > maxBytes) {
        callback(new BrotliLimitError(message));
        return;
      }
      callback(null, chunk);
    },
  });
}

/**
 * Re-exposes a pipeline as a plain readable whose errors have been mapped to
 * this module's own error types, so a caller can tell a blown cap from a
 * failed decode without matching on zlib's messages.
 *
 * Destroying the returned stream (an aborted request) returns the underlying
 * iterator, which tears the pipeline — and its zlib stream — down with it.
 */
function guarded(source: Readable, mapError: (error: unknown) => unknown): Readable {
  async function* translated(): AsyncGenerator<Buffer> {
    try {
      yield* source;
    } catch (error) {
      throw mapError(error);
    }
  }
  return Readable.from(translated(), { objectMode: false });
}
