import type { FastifyInstance } from 'fastify';
import { deviceIdOf } from '../../../core/device.js';
import type {
  DeleteGrootUseCase,
  GetGrootUseCase,
  ListGrootsUseCase,
  SaveGrootUseCase,
  UpdateGrootUseCase,
} from '../usecases/manage-groots.js';

export interface GrootRoutesDeps {
  maxDocKb: number;
  list: ListGrootsUseCase;
  save: SaveGrootUseCase;
  get: GetGrootUseCase;
  update: UpdateGrootUseCase;
  remove: DeleteGrootUseCase;
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
    // Stored as text and never parsed here — an empty document is allowed.
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
 * Document name → `<name>.yaml` attachment filename. Strips path separators,
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
  return `${safe || 'groot'}.yaml`;
}

export function registerGrootRoutes(app: FastifyInstance, deps: GrootRoutesDeps): void {
  // The client reads the doc-size cap from here, never hardcodes it — so the
  // editor can refuse an over-cap save before spending the request.
  app.get('/api/groot/config', () => ({ maxDocKb: deps.maxDocKb }));

  app.get<{ Querystring: ListQuery }>(
    '/api/groot',
    { schema: { querystring: listQuerySchema } },
    (request) => deps.list.execute(request.query),
  );

  app.post<{ Body: { name?: string; content: string } }>(
    '/api/groot',
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

  // Public read-only raw endpoint, the Edda/Runestone pattern: the stored YAML
  // at /groot/api/:slug, outside /api/ so a saved document doubles as a stable
  // data URL something else can fetch. Registered routes win over the SPA
  // fallback, so only this exact shape escapes the client app. CORS is wide
  // open: it serves nothing but the document the URL names.
  // `?download=1` → attachment.
  app.get<{ Params: { slug: string }; Querystring: { download?: string } }>(
    '/groot/api/:slug',
    { schema: { params: slugParamsSchema, querystring: rawQuerySchema } },
    async (request, reply) => {
      const { record, canonical } = deps.get.execute(request.params.slug);
      reply.header('access-control-allow-origin', '*');
      if (!canonical) {
        const suffix = request.query.download ? '?download=1' : '';
        return reply.redirect(`/groot/api/${encodeURIComponent(record.slug)}${suffix}`, 301);
      }
      if (request.query.download) {
        reply.header(
          'content-disposition',
          `attachment; filename="${downloadFilename(record.name)}"`,
        );
      }
      // Raw stored text, not a re-serialization: comments, key order and
      // quoting style are all part of what was saved. `application/yaml` is
      // the registered type since RFC 9512 (2024) — not `text/yaml`.
      return reply.type('application/yaml; charset=utf-8').send(record.content);
    },
  );

  // :slug resolves saved docs; a stale-name slug with a valid id 301s to the
  // canonical slug so renamed documents keep every shared link alive.
  app.get<{ Params: { slug: string } }>(
    '/api/groot/:slug',
    { schema: { params: slugParamsSchema } },
    async (request, reply) => {
      const { record, canonical } = deps.get.execute(request.params.slug);
      if (!canonical) {
        return reply.redirect(`/api/groot/${encodeURIComponent(record.slug)}`, 301);
      }
      return record;
    },
  );

  app.put<{ Params: { id: string }; Body: { name?: string; content?: string } }>(
    '/api/groot/:id',
    { schema: { params: idParamsSchema, body: updateBodySchema } },
    (request) =>
      deps.update.execute({
        id: request.params.id,
        name: request.body.name,
        content: request.body.content,
      }),
  );

  app.delete<{ Params: { id: string } }>(
    '/api/groot/:id',
    { schema: { params: idParamsSchema } },
    async (request, reply) => {
      deps.remove.execute(request.params.id);
      return reply.code(204).send();
    },
  );
}
