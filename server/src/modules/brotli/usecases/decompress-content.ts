import type { Readable } from 'node:stream';
import type { Logger } from '../../../core/logger/index.js';
import type { BrotliCodec } from '../ports.js';

export interface DecompressContentDeps {
  codec: BrotliCodec;
  log: Logger;
  maxOutputBytes: number;
}

export interface DecompressRequest {
  input: Readable;
  /** What the client declared in `content-length`, for the log line only. */
  declaredBytes: number | null;
}

/**
 * The decompress half. It takes no quality — Brotli decompression is symmetric
 * regardless of the level the input was compressed at — and its cap bounds the
 * OUTPUT, which is the one limit in this codebase on bytes the server
 * manufactures rather than bytes a client sent.
 */
export class DecompressContentUseCase {
  constructor(private readonly deps: DecompressContentDeps) {}

  execute(request: DecompressRequest): Readable {
    const { codec, log, maxOutputBytes } = this.deps;
    const context = { bytes: request.declaredBytes };
    log.debug(context, 'brotli: decompress started');

    const output = codec.decompress(request.input, maxOutputBytes);
    output.on('error', (err: Error) => log.warn({ err, ...context }, 'brotli: decompress failed'));
    return output;
  }
}
