import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../../../core/http/index.js';
import { errorResponses } from '../../../core/http/schemas.js';
import type { IncomingFile, UploadRejectionReason } from '../ports.js';
import type { UploadFilesUseCase } from '../usecases/upload-files.js';
import { TAGS, uploadResultSchema, uploadTooLargeResponse } from './schemas.js';

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

/**
 * The folder destination (PLAN-24). Same shape the stored-name params use: one
 * segment, no separators, no leading dot — so neither traversal nor a hidden
 * folder is expressible. The sanitizer still runs behind it.
 */
const uploadQuerySchema = {
  type: 'object',
  properties: {
    folder: { type: 'string', minLength: 1, maxLength: 255, pattern: '^[^./\\\\][^/\\\\]*$' },
  },
} as const;

export function registerFileRoutes(app: FastifyInstance, deps: FileRoutesDeps): void {
  const bodyCap = deps.maxUploadBytes * deps.maxFilesPerUpload + MULTIPART_OVERHEAD_BYTES;

  app.post<{ Querystring: { folder?: string } }>(
    '/api/files',
    {
      schema: {
        tags: TAGS,
        summary: 'Upload files (multipart/form-data)',
        description:
          'Each file part is streamed to tmp and placed under its sanitized name. Without ' +
          '`folder` the files are staged in uploads/; with it they land in downloads/<folder>/. ' +
          'A mixed batch is 201 with per-file rejections.',
        operationId: 'uploadFiles',
        querystring: uploadQuerySchema,
        response: {
          201: uploadResultSchema,
          413: uploadTooLargeResponse,
          ...errorResponses(400, 409, 415, 429),
        },
      },
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

      // Attribution only — it decides whose browser skips the folder banner,
      // and the client can lie about it (the /publish route's own reasoning).
      const header = request.headers['x-bifrost-device'];
      const { folder } = request.query;

      const result = await deps.uploadFiles
        .execute(incomingFiles(request), {
          uploaderHint: request.ip,
          ...(folder !== undefined && { folder }),
          originDeviceId: typeof header === 'string' && header !== '' ? header : null,
        })
        .catch((error) => {
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
      // Contract: 413 on oversize, 409 on a folder that is really a file —
      // when nothing was accepted and every rejection was that one cause.
      // Mixed batches stay 201 with per-file errors, as they always have.
      const allRejectedBecause = (reason: UploadRejectionReason): boolean =>
        result.accepted.length === 0 &&
        result.rejected.length > 0 &&
        result.rejected.every((entry) => entry.reason === reason);

      if (allRejectedBecause('folder-conflict')) {
        throw new AppError(
          `"${folder}" is already a file on the host, not a folder`,
          409,
          'FOLDER_CONFLICT',
        );
      }
      return reply.code(allRejectedBecause('too-large') ? 413 : 201).send(result);
    },
  );

  // The client reads its pre-flight validation limits from here instead of
  // hardcoding values that actually live in .env.
  app.get(
    '/api/files/config',
    {
      schema: {
        tags: TAGS,
        summary: 'The upload limits the client checks before sending',
        operationId: 'getUploadConfig',
        response: {
          200: {
            type: 'object',
            required: ['maxUploadSizeMb', 'maxFilesPerUpload', 'blockedExtensions'],
            properties: {
              maxUploadSizeMb: { type: 'integer' },
              maxFilesPerUpload: { type: 'integer' },
              blockedExtensions: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },
    () => ({
      maxUploadSizeMb: deps.maxUploadSizeMb,
      maxFilesPerUpload: deps.maxFilesPerUpload,
      blockedExtensions: deps.blockedExtensions,
    }),
  );
}

async function* incomingFiles(request: FastifyRequest): AsyncIterable<IncomingFile> {
  for await (const part of request.files()) {
    yield { name: part.filename, stream: part.file };
  }
}
