import type { Readable } from 'node:stream';
import { Readable as NodeReadable } from 'node:stream';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../../../core/http/index.js';
import type { Logger } from '../../../core/logger/index.js';
import {
  BROTLI_QUALITY,
  BROTLI_QUALITY_NAMES,
  BrotliDecodeError,
  BrotliLimitError,
  type BrotliQualityName,
} from '../ports.js';
import type { CompressContentUseCase } from '../usecases/compress-content.js';
import type { DecompressContentUseCase } from '../usecases/decompress-content.js';

export interface BrotliRoutesDeps {
  compress: CompressContentUseCase;
  decompress: DecompressContentUseCase;
  log: Logger;
  maxInputBytes: number;
  maxInputMb: number;
  maxOutputMb: number;
  rateLimitPerMinute: number;
}

const qualityQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    // Three names, never a raw 0–11 level: the only thing left to validate is
    // "is this one of three strings", and the mapping stays server-side.
    quality: { type: 'string', enum: BROTLI_QUALITY_NAMES },
  },
} as const;

export function registerBrotliRoutes(app: FastifyInstance, deps: BrotliRoutesDeps): void {
  /**
   * Both routes move raw bytes, so the body is never parsed or buffered — the
   * handler pipes `request.raw` straight into the codec, the same posture
   * `respondWithFile` already applies on the way out. Encapsulated to this
   * module's plugin scope, so no other module's parsing changes.
   */
  app.addContentTypeParser(
    'application/octet-stream',
    (_request: FastifyRequest, payload: NodeJS.ReadableStream, done) => {
      done(null, payload);
    },
  );

  /** Limits live in .env, so the page reads them instead of hardcoding a menu. */
  app.get('/api/brotli/config', () => ({
    maxInputMb: deps.maxInputMb,
    maxOutputMb: deps.maxOutputMb,
    qualities: BROTLI_QUALITY_NAMES,
    defaultQuality: 'balanced' satisfies BrotliQualityName,
  }));

  app.post<{ Querystring: { quality?: BrotliQualityName } }>(
    '/api/brotli/compress',
    {
      schema: { querystring: qualityQuerySchema },
      // Compress and decompress each get their own budget: a route-level config
      // gets its own store, so a long decompress session cannot spend the
      // allowance the other route needs.
      config: { rateLimit: { max: deps.rateLimitPerMinute, timeWindow: 60_000 } },
    },
    async (request, reply) => {
      const declaredBytes = declaredLength(request);
      // The only whole-request bound knowable before reading a byte. The
      // streaming counter behind the codec is the real enforcement — a chunked
      // request declares nothing at all.
      if (declaredBytes !== null && declaredBytes > deps.maxInputBytes) {
        throw new AppError(
          `input exceeds the configured ${deps.maxInputMb} MB cap`,
          413,
          'PAYLOAD_TOO_LARGE',
        );
      }
      const quality = request.query.quality ?? 'balanced';
      const produced = deps.compress.execute({
        input: request.raw,
        quality: BROTLI_QUALITY[quality],
        declaredBytes,
      });
      return sendBytes(reply, produced, deps.log);
    },
  );

  app.post(
    '/api/brotli/decompress',
    { config: { rateLimit: { max: deps.rateLimitPerMinute, timeWindow: 60_000 } } },
    async (request, reply) => {
      // No pre-check exists on this side, by the nature of the risk: a
      // compressed size says nothing about the size it expands to. The output
      // counter inside the codec is the whole guard.
      const produced = deps.decompress.execute({
        input: request.raw,
        declaredBytes: declaredLength(request),
      });
      return sendBytes(reply, produced, deps.log);
    },
  );
}

/** `content-length` as a number, or null when absent or unparseable (chunked). */
function declaredLength(request: FastifyRequest): number | null {
  const raw = Number(request.headers['content-length']);
  return Number.isFinite(raw) ? raw : null;
}

/**
 * Sends a codec stream, holding the status open until the first byte exists.
 *
 * A stream handed straight to `reply.send()` commits its status the moment
 * piping starts, which is too early to be honest here: whether a blown cap or
 * a failed decode can still become a clean 413/422 depends entirely on whether
 * anything has gone out yet. So the first chunk is awaited first — a failure
 * before it arrives still has a status code available, and a failure after it
 * does not, which is exactly the split this module documents rather than
 * promising one uniform outcome.
 */
async function sendBytes(reply: FastifyReply, produced: Readable, log: Logger): Promise<unknown> {
  // A client that vanishes mid-request leaves nobody to read this; destroying
  // it tears the pipeline — zlib stream included — down with it, rather than
  // leaving a codec running for no reader (Nimbus's download-guard pattern).
  reply.raw.on('close', () => {
    if (reply.raw.writableEnded) return;
    produced.destroy();
  });

  let body: Readable;
  try {
    body = await firstByteHeld(produced);
  } catch (error) {
    throw asHttpError(error);
  }

  // Past this point there is no status left to send. The failure is already
  // logged by the usecase; this line records the HTTP consequence, which is
  // the part only the route knows.
  body.on('error', (err: Error) =>
    log.warn({ err }, 'brotli: stream failed after headers; connection destroyed'),
  );

  return reply
    .header('content-type', 'application/octet-stream')
    // Deliberately no content-disposition: the client already holds the bytes
    // and names the download itself, so the server never invents a filename.
    .header('cache-control', 'no-store')
    .send(body);
}

/** Pulls one chunk, then hands back a stream that replays it and the rest. */
async function firstByteHeld(produced: Readable): Promise<Readable> {
  const iterator = produced[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
  const first = await iterator.next();
  const rest: AsyncIterable<Buffer> = { [Symbol.asyncIterator]: () => iterator };

  async function* replay(): AsyncGenerator<Buffer> {
    if (first.done !== true) yield first.value;
    yield* rest;
  }
  return NodeReadable.from(replay(), { objectMode: false });
}

/** Codec failures that happened while a status code was still available. */
function asHttpError(error: unknown): unknown {
  if (error instanceof BrotliLimitError) {
    return new AppError(error.message, 413, 'PAYLOAD_TOO_LARGE');
  }
  if (error instanceof BrotliDecodeError) {
    return new AppError('input is not valid brotli data', 422, 'INVALID_BROTLI');
  }
  return error;
}
