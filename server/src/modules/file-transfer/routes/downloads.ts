import type { FastifyInstance } from 'fastify';
import type { GetDownloadStreamUseCase } from '../usecases/get-download-stream.js';
import type { ListDownloadsUseCase } from '../usecases/list-downloads.js';

export interface DownloadRoutesDeps {
  listDownloads: ListDownloadsUseCase;
  getDownloadStream: GetDownloadStreamUseCase;
}

const idParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: {
    // Ids are 16 chars of base64url — anything else never reaches the usecase.
    id: { type: 'string', pattern: '^[A-Za-z0-9_-]{16}$' },
  },
} as const;

export function registerDownloadRoutes(app: FastifyInstance, deps: DownloadRoutesDeps): void {
  app.get('/api/downloads', () => deps.listDownloads.execute());

  app.get<{ Params: { id: string } }>(
    '/api/downloads/:id/content',
    { schema: { params: idParamsSchema } },
    async (request, reply) => {
      const { stream, size, name } = await deps.getDownloadStream.execute(request.params.id);
      return reply
        .header('content-type', 'application/octet-stream')
        .header('content-length', size)
        .header('content-disposition', contentDisposition(name))
        .send(stream);
    },
  );
}

/** RFC 6266/5987: ascii fallback plus UTF-8 filename* so unicode names survive. */
function contentDisposition(name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
