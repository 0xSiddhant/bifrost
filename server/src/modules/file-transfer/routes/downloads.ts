import type { FastifyInstance } from 'fastify';
import { DOWNLOAD_ID_PATTERN } from '../../../core/download-id.js';
import { dispositionFilename, respondWithFile } from './file-response.js';
import type { ArchiveFolderUseCase } from '../usecases/archive-folder.js';
import type { GetDownloadStreamUseCase } from '../usecases/get-download-stream.js';
import type { ListDownloadsUseCase } from '../usecases/list-downloads.js';

export interface DownloadRoutesDeps {
  listDownloads: ListDownloadsUseCase;
  getDownloadStream: GetDownloadStreamUseCase;
  archiveFolder: ArchiveFolderUseCase;
}

const idParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: {
    // Ids are 16 chars of base64url — anything else never reaches the usecase.
    id: { type: 'string', pattern: DOWNLOAD_ID_PATTERN },
  },
} as const;

const contentSchema = {
  params: idParamsSchema,
  querystring: {
    type: 'object',
    properties: {
      inline: { type: 'string', enum: ['1', '0'] },
    },
  },
} as const;

export function registerDownloadRoutes(app: FastifyInstance, deps: DownloadRoutesDeps): void {
  app.get('/api/downloads', () => deps.listDownloads.execute());

  app.get<{ Params: { id: string }; Querystring: { inline?: string } }>(
    '/api/downloads/:id/content',
    { schema: contentSchema },
    async (request, reply) => {
      const { id } = request.params;
      const { name, size } = await deps.getDownloadStream.resolve(id);
      return respondWithFile(request, reply, {
        name,
        size,
        inline: request.query.inline === '1',
        open: (slice) => deps.getDownloadStream.open(id, slice),
      });
    },
  );

  // A folder id → a zip of its files. Same id family as /content, because the
  // id already resolves to an entry that knows whether it is a folder.
  app.get<{ Params: { id: string } }>(
    '/api/downloads/:id/archive',
    { schema: { params: idParamsSchema } },
    async (request, reply) => {
      const { stream, zipName } = await deps.archiveFolder.execute(request.params.id);
      return (
        reply
          .header('content-type', 'application/zip')
          // No content-length: a streamed zip's size is not known until
          // finalize() completes, so the response is chunked like any other
          // generated-on-the-fly stream.
          .header('content-disposition', `attachment; ${dispositionFilename(zipName)}`)
          .send(stream)
      );
    },
  );
}
