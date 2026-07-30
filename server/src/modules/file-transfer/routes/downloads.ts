import type { FastifyInstance } from 'fastify';
import { DOWNLOAD_ID_PATTERN } from '../../../core/download-id.js';
import { respondWithFile } from './file-response.js';
import type { GetDownloadStreamUseCase } from '../usecases/get-download-stream.js';
import type { ListDownloadsUseCase } from '../usecases/list-downloads.js';

export interface DownloadRoutesDeps {
  listDownloads: ListDownloadsUseCase;
  getDownloadStream: GetDownloadStreamUseCase;
}

const contentSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      // Ids are 16 chars of base64url — anything else never reaches the usecase.
      id: { type: 'string', pattern: DOWNLOAD_ID_PATTERN },
    },
  },
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
}
