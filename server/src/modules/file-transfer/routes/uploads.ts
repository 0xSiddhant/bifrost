import type { FastifyInstance } from 'fastify';
import type { ManageUploadsUseCase } from '../usecases/manage-uploads.js';
import { respondWithFile } from './file-response.js';

export interface UploadRoutesDeps {
  manageUploads: ManageUploadsUseCase;
}

/**
 * A stored name is one path segment. Fastify decodes params, so `%2f` can
 * arrive as a real slash — the pattern refuses separators, and refuses a
 * leading dot so neither a hidden file nor the in-flight staging copies are
 * addressable. The store's realpath check is the second lock behind this.
 */
const nameParamSchema = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 255, pattern: '^[^./\\\\][^/\\\\]*$' },
  },
} as const;

const renameBodySchema = {
  type: 'object',
  required: ['name'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 255 },
  },
} as const;

const contentQuerySchema = {
  type: 'object',
  properties: {
    inline: { type: 'string', enum: ['1', '0'] },
  },
} as const;

export function registerUploadRoutes(app: FastifyInstance, deps: UploadRoutesDeps): void {
  // Move to downloads/ — the one action that makes a file visible to the LAN.
  app.post<{ Params: { name: string } }>(
    '/api/files/:name/publish',
    { schema: { params: nameParamSchema } },
    (request) => {
      // Attribution only: it decides whose browser skips the banner, and the
      // client can lie about it — see the plan on why that is fine.
      const header = request.headers['x-bifrost-device'];
      const deviceId = typeof header === 'string' && header !== '' ? header : null;
      return deps.manageUploads.publish(request.params.name, deviceId);
    },
  );

  app.patch<{ Params: { name: string }; Body: { name: string } }>(
    '/api/files/:name',
    { schema: { params: nameParamSchema, body: renameBodySchema } },
    (request) => deps.manageUploads.rename(request.params.name, request.body.name),
  );

  app.delete<{ Params: { name: string } }>(
    '/api/files/:name',
    { schema: { params: nameParamSchema } },
    async (request, reply) => {
      await deps.manageUploads.remove(request.params.name);
      return reply.code(204).send();
    },
  );

  // Bytes for the preview (`previews` serves the metadata for the same file).
  app.get<{ Params: { name: string }; Querystring: { inline?: string } }>(
    '/api/files/:name/content',
    { schema: { params: nameParamSchema, querystring: contentQuerySchema } },
    async (request, reply) => {
      const { name } = request.params;
      const { size } = await deps.manageUploads.stat(name);
      return respondWithFile(request, reply, {
        name,
        size,
        inline: request.query.inline === '1',
        open: (slice) => deps.manageUploads.open(name, slice),
      });
    },
  );
}
