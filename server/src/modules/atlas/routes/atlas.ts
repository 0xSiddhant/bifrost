import type { FastifyInstance } from 'fastify';
import { deviceIdOf } from '../../../core/device.js';
import type {
  DeleteAtlasUseCase,
  GetAtlasUseCase,
  ListAtlasUseCase,
  SaveAtlasUseCase,
  UpdateAtlasUseCase,
} from '../usecases/manage-atlas-docs.js';

export interface AtlasRoutesDeps {
  maxDocKb: number;
  list: ListAtlasUseCase;
  save: SaveAtlasUseCase;
  get: GetAtlasUseCase;
  update: UpdateAtlasUseCase;
  remove: DeleteAtlasUseCase;
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
    // The server stores text and caps bytes — it never parses XML, so an empty
    // document is as valid here as an empty Markdown one.
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
 * Document name → `<name>.xml` attachment filename. Strips path separators,
 * quotes, and control chars (which would break the Content-Disposition header
 * or the saved path); spaces are fine inside a quoted filename and are kept.
 *
 * Always `.xml`, never `.plist`: the server does not parse the document, so it
 * genuinely does not know which one it is — and guessing from the bytes here
 * would be the server parsing XML by another name.
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
  return `${safe || 'atlas'}.xml`;
}

export function registerAtlasRoutes(app: FastifyInstance, deps: AtlasRoutesDeps): void {
  // The client reads the doc-size cap, never hardcodes it.
  app.get('/api/atlas/config', () => ({ maxDocKb: deps.maxDocKb }));

  app.get<{ Querystring: ListQuery }>(
    '/api/atlas',
    { schema: { querystring: listQuerySchema } },
    (request) => deps.list.execute(request.query),
  );

  app.post<{ Body: { name?: string; content: string } }>(
    '/api/atlas',
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

  // Public read-only raw endpoint, the runestone/edda/groot pattern: the stored
  // bytes at /atlas/api/:slug, outside /api/ so a saved document doubles as a
  // stable data URL. Registered routes win over the SPA fallback, so only this
  // exact shape escapes the client app. CORS is wide open: it serves nothing but
  // the document the URL names. `?download=1` → attachment.
  app.get<{ Params: { slug: string }; Querystring: { download?: string } }>(
    '/atlas/api/:slug',
    { schema: { params: slugParamsSchema, querystring: rawQuerySchema } },
    async (request, reply) => {
      const { record, canonical } = deps.get.execute(request.params.slug);
      reply.header('access-control-allow-origin', '*');
      if (!canonical) {
        const suffix = request.query.download ? '?download=1' : '';
        return reply.redirect(`/atlas/api/${encodeURIComponent(record.slug)}${suffix}`, 301);
      }
      if (request.query.download) {
        reply.header(
          'content-disposition',
          `attachment; filename="${downloadFilename(record.name)}"`,
        );
      }
      // Raw stored text, not a re-serialization — the document exactly as
      // written, comments, DOCTYPE and all. One content type for every
      // document regardless of plist-ness, because the server never looks:
      // Groot and Edda do not vary by sub-format either.
      return reply.type('application/xml; charset=utf-8').send(record.content);
    },
  );

  // :slug resolves saved docs; a stale-name slug with a valid id 301s to the
  // canonical slug so renamed documents keep every shared link alive.
  app.get<{ Params: { slug: string } }>(
    '/api/atlas/:slug',
    { schema: { params: slugParamsSchema } },
    async (request, reply) => {
      const { record, canonical } = deps.get.execute(request.params.slug);
      if (!canonical) {
        return reply.redirect(`/api/atlas/${encodeURIComponent(record.slug)}`, 301);
      }
      return record;
    },
  );

  app.put<{ Params: { id: string }; Body: { name?: string; content?: string } }>(
    '/api/atlas/:id',
    { schema: { params: idParamsSchema, body: updateBodySchema } },
    (request) =>
      deps.update.execute({
        id: request.params.id,
        name: request.body.name,
        content: request.body.content,
      }),
  );

  app.delete<{ Params: { id: string } }>(
    '/api/atlas/:id',
    { schema: { params: idParamsSchema } },
    async (request, reply) => {
      deps.remove.execute(request.params.id);
      return reply.code(204).send();
    },
  );
}
