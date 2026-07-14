import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../../../core/http/index.js';
import type { IncomingFile } from '../ports.js';
import type { UploadFilesUseCase } from '../usecases/upload-files.js';

export interface FileRoutesDeps {
  uploadFiles: UploadFilesUseCase;
  maxUploadBytes: number;
  maxFilesPerUpload: number;
  maxUploadSizeMb: number;
  blockedExtensions: readonly string[];
  rateLimitPerMinute: number;
}

// Generous allowance for multipart boundaries/headers on top of the payload.
const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

export function registerFileRoutes(app: FastifyInstance, deps: FileRoutesDeps): void {
  const bodyCap = deps.maxUploadBytes * deps.maxFilesPerUpload + MULTIPART_OVERHEAD_BYTES;

  app.post(
    '/api/files',
    {
      config: {
        rateLimit: { max: deps.rateLimitPerMinute, timeWindow: 60_000 },
      },
    },
    async (request, reply) => {
      if (!request.isMultipart()) {
        throw new AppError('expected a multipart/form-data body', 400, 'BAD_REQUEST');
      }
      // Early reject on declared size — the only whole-request bound knowable
      // up front (per-file caps are enforced while streaming).
      const declared = Number(request.headers['content-length']);
      if (Number.isFinite(declared) && declared > bodyCap) {
        throw new AppError('request body too large', 413, 'PAYLOAD_TOO_LARGE');
      }

      const result = await deps.uploadFiles.execute(incomingFiles(request)).catch((error) => {
        // Busboy aborts the whole request past the files cap — surface it as a
        // clean 413 instead of the generic opaque 500.
        if ((error as { code?: string }).code === 'FST_FILES_LIMIT') {
          throw new AppError(
            `at most ${deps.maxFilesPerUpload} files per upload`,
            413,
            'TOO_MANY_FILES',
          );
        }
        throw error;
      });
      if (result.accepted.length === 0 && result.rejected.length === 0) {
        throw new AppError('no files in request', 400, 'BAD_REQUEST');
      }
      // Contract: 413 on oversize — when nothing was accepted and every
      // rejection was the size cap; mixed batches stay 201 with per-file errors.
      const allTooLarge =
        result.accepted.length === 0 &&
        result.rejected.every((entry) => entry.reason === 'too-large');
      return reply.code(allTooLarge ? 413 : 201).send(result);
    },
  );

  // The client reads its pre-flight validation limits from here instead of
  // hardcoding values that actually live in .env.
  app.get('/api/files/config', () => ({
    maxUploadSizeMb: deps.maxUploadSizeMb,
    maxFilesPerUpload: deps.maxFilesPerUpload,
    blockedExtensions: deps.blockedExtensions,
  }));
}

async function* incomingFiles(request: FastifyRequest): AsyncIterable<IncomingFile> {
  for await (const part of request.files()) {
    yield { name: part.filename, stream: part.file };
  }
}
