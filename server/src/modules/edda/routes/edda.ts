import type { FastifyInstance } from 'fastify';
import { deviceIdOf } from '../../../core/device.js';
import type {
  DeleteEddaUseCase,
  GetEddaUseCase,
  ListEddasUseCase,
  SaveEddaUseCase,
  UpdateEddaUseCase,
} from '../usecases/manage-eddas.js';

export interface EddaRoutesDeps {
  maxDocKb: number;
  livePreviewMaxKb: number;
  list: ListEddasUseCase;
  save: SaveEddaUseCase;
  get: GetEddaUseCase;
  update: UpdateEddaUseCase;
  remove: DeleteEddaUseCase;
}

const listQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    q: { type: 'string', maxLength: 120 },
    author: { type: 'string', maxLength: 64 },
    sort: { enum: ['name', 'created', 'modified', 'size'] },
    order: { enum: ['asc', 'desc'] },
    limit: { type: 'integer', minimum: 1, maximum: 500 },
    offset: { type: 'integer', minimum: 0 },
  },
} as const;

const saveBodySchema = {
  type: 'object',
  required: ['content'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', maxLength: 80 },
    // Markdown is free text — an empty document is allowed (unlike Runestone).
    content: { type: 'string' },
  },
} as const;

const updateBodySchema = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 80 },
    content: { type: 'string' },
  },
} as const;

const slugParamsSchema = {
  type: 'object',
  required: ['slug'],
  properties: { slug: { type: 'string', minLength: 1, maxLength: 80 } },
} as const;

const idParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1, maxLength: 16 } },
} as const;

const rawQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: { download: { type: 'string' } },
} as const;

interface ListQuery {
  q?: string;
  author?: string;
  sort?: string;
  order?: string;
  limit?: number;
  offset?: number;
}

/**
 * Document name → `<name>.md` attachment filename. Strips path separators,
 * quotes, and control chars (which would break the Content-Disposition header
 * or the saved path); spaces are fine inside a quoted filename and are kept.
 */
function downloadFilename(name: string): string {
  const stripped = [...name]
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      if (code < 0x20) return false;
      return !'/\\:*?"<>|'.includes(ch);
    })
    .join('');
  const safe = stripped.replace(/\s+/g, ' ').trim();
  return `${safe || 'edda'}.md`;
}

export function registerEddaRoutes(app: FastifyInstance, deps: EddaRoutesDeps): void {
  // The client reads the doc-size cap + the live-preview threshold, never hardcodes them.
  app.get('/api/edda/config', () => ({
    maxDocKb: deps.maxDocKb,
    livePreviewMaxKb: deps.livePreviewMaxKb,
  }));

  app.get<{ Querystring: ListQuery }>(
    '/api/edda',
    { schema: { querystring: listQuerySchema } },
    (request) => deps.list.execute(request.query),
  );

  app.post<{ Body: { name?: string; content: string } }>(
    '/api/edda',
    { schema: { body: saveBodySchema } },
    async (request, reply) => {
      const record = deps.save.execute({
        name: request.body.name,
        content: request.body.content,
        authorDeviceId: deviceIdOf(request),
      });
      return reply.code(201).send(record);
    },
  );

  // Public read-only raw endpoint (owner spec — "api" literally in the path):
  // the raw Markdown at /edda/api/:slug, outside /api/ so a saved edda doubles
  // as a stable data URL. Registered routes win over the SPA fallback, so only
  // this exact shape escapes the client app. CORS is wide open: it serves
  // nothing but the document the URL names. `?download=1` → attachment.
  app.get<{ Params: { slug: string }; Querystring: { download?: string } }>(
    '/edda/api/:slug',
    { schema: { params: slugParamsSchema, querystring: rawQuerySchema } },
    async (request, reply) => {
      const { record, canonical } = deps.get.execute(request.params.slug);
      reply.header('access-control-allow-origin', '*');
      if (!canonical) {
        const suffix = request.query.download ? '?download=1' : '';
        return reply.redirect(`/edda/api/${encodeURIComponent(record.slug)}${suffix}`, 301);
      }
      if (request.query.download) {
        reply.header(
          'content-disposition',
          `attachment; filename="${downloadFilename(record.name)}"`,
        );
      }
      // Raw stored text, not a re-serialization — the document exactly as written.
      return reply.type('text/markdown; charset=utf-8').send(record.content);
    },
  );

  // :slug resolves saved docs; a stale-name slug with a valid id 301s to the
  // canonical slug so renamed documents keep every shared link alive.
  app.get<{ Params: { slug: string } }>(
    '/api/edda/:slug',
    { schema: { params: slugParamsSchema } },
    async (request, reply) => {
      const { record, canonical } = deps.get.execute(request.params.slug);
      if (!canonical) {
        return reply.redirect(`/api/edda/${encodeURIComponent(record.slug)}`, 301);
      }
      return record;
    },
  );

  app.put<{ Params: { id: string }; Body: { name?: string; content?: string } }>(
    '/api/edda/:id',
    { schema: { params: idParamsSchema, body: updateBodySchema } },
    (request) =>
      deps.update.execute({
        id: request.params.id,
        name: request.body.name,
        content: request.body.content,
      }),
  );

  app.delete<{ Params: { id: string } }>(
    '/api/edda/:id',
    { schema: { params: idParamsSchema } },
    async (request, reply) => {
      deps.remove.execute(request.params.id);
      return reply.code(204).send();
    },
  );
}
