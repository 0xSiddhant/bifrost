import type { Readable } from 'node:stream';
import type { Logger } from '../../../core/logger/index.js';
import type { BrotliCodec, BrotliQuality } from '../ports.js';

export interface CompressContentDeps {
  codec: BrotliCodec;
  log: Logger;
  maxInputBytes: number;
}

export interface CompressRequest {
  input: Readable;
  quality: BrotliQuality;
  /** What the client declared in `content-length`, for the log line only. */
  declaredBytes: number | null;
}

/**
 * Thin orchestration over the codec: read the configured cap, start the
 * stream, log what happens to it. No zlib here — that is the service's, and
 * only the service's (PLAN-24's layering lesson, applied up front).
 */
export class CompressContentUseCase {
  constructor(private readonly deps: CompressContentDeps) {}

  execute(request: CompressRequest): Readable {
    const { codec, log, maxInputBytes } = this.deps;
    const context = { quality: request.quality, bytes: request.declaredBytes };
    log.debug(context, 'brotli: compress started');

    const output = codec.compress(request.input, request.quality, maxInputBytes);
    // Logged where it is handled: the route turns this into a status or a
    // destroyed connection, but the reason it failed is recorded here once.
    output.on('error', (err: Error) => log.warn({ err, ...context }, 'brotli: compress failed'));
    return output;
  }
}
