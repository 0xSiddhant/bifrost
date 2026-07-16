import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { DOWNLOAD_ID_PATTERN } from '../../../core/download-id.js';
import { FALLBACK_MIME, mimeForExt } from '../../../core/http/mime.js';
import { parseRange } from '../../../core/http/range.js';
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
      const inline = request.query.inline === '1';
      const { name, size } = await deps.getDownloadStream.resolve(id);

      reply.header('accept-ranges', 'bytes');
      const mime = inline ? mimeForExt(path.extname(name)) : FALLBACK_MIME;
      reply.header('content-type', mime);
      reply.header(
        'content-disposition',
        `${inline ? 'inline' : 'attachment'}; ${dispositionFilename(name)}`,
      );

      const ranged = parseRange(request.headers.range, size);
      if (ranged.kind === 'unsatisfiable') {
        return reply
          .code(416)
          .header('content-range', `bytes */${size}`)
          .header('content-type', 'application/json; charset=utf-8')
          .send({ error: 'RANGE_NOT_SATISFIABLE', message: 'requested range not satisfiable' });
      }
      if (ranged.kind === 'partial') {
        const { start, end } = ranged.range;
        const { stream } = await deps.getDownloadStream.open(id, { start, end });
        return reply
          .code(206)
          .header('content-range', `bytes ${start}-${end}/${size}`)
          .header('content-length', end - start + 1)
          .send(stream);
      }
      const { stream } = await deps.getDownloadStream.open(id);
      return reply.header('content-length', size).send(stream);
    },
  );
}

/** RFC 6266/5987: ascii fallback plus UTF-8 filename* so unicode names survive. */
function dispositionFilename(name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
