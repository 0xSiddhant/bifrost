import type { FastifyInstance } from 'fastify';
import { deviceIdOf } from '../../../core/device.js';
import { bodyTooLargeAs, documentBodyLimit } from '../../../core/http/body-limit.js';
import {
  corsHeader,
  errorResponses,
  noContent,
  rawBody,
  redirect,
} from '../../../core/http/schemas.js';
import { documentListPageSchema, pagedQueryProperties } from '../../../core/paging.js';
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
    paged: pagedQueryProperties.paged,
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

// Response shapes (PLAN-32). Properties are listed in the order the repository
// and usecases build them: the serializer writes schema order, and the
// contract guard holds every response to the handler's exact bytes.
const summaryProperties = {
  id: { type: 'string' },
  name: { type: 'string' },
  slug: {
    type: 'string',
    description: '`<kebab-name>-<id>`; changes on rename, and a stale slug answers 301',
  },
  authorDeviceId: {
    type: ['string', 'null'],
    description: 'The saving device, or null when it was not known',
  },
  sizeBytes: { type: 'integer', description: 'UTF-8 bytes of the content' },
  createdAt: { type: 'integer', description: 'Unix epoch milliseconds' },
  modifiedAt: { type: 'integer', description: 'Unix epoch milliseconds' },
} as const;

const summarySchema = {
  type: 'object',
  required: ['id', 'name', 'slug', 'authorDeviceId', 'sizeBytes', 'createdAt', 'modifiedAt'],
  properties: summaryProperties,
} as const;

const recordSchema = {
  type: 'object',
  required: [...summarySchema.required, 'content'],
  properties: {
    id: summaryProperties.id,
    name: summaryProperties.name,
    slug: summaryProperties.slug,
    content: { type: 'string', description: 'The document text exactly as saved' },
    authorDeviceId: summaryProperties.authorDeviceId,
    sizeBytes: summaryProperties.sizeBytes,
    createdAt: summaryProperties.createdAt,
    modifiedAt: summaryProperties.modifiedAt,
  },
} as const;

const configResponseSchema = {
  type: 'object',
  required: ['maxDocKb'],
  properties: {
    maxDocKb: { type: 'integer', description: 'The largest document the server accepts, in KiB' },
  },
} as const;

const listResponseSchema = {
  description: 'Without `paged=true`, the bare array it always was; with it, one page',
  anyOf: [{ type: 'array', items: summarySchema }, documentListPageSchema(summarySchema)],
} as const;

const rawHeaders = {
  ...corsHeader,
  'content-disposition': {
    type: 'string',
    description: 'With `?download`: `attachment; filename="<name>.xml"`',
  },
};

const TAGS = ['atlas'];

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
  paged?: boolean;
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
  // PLAN-33: a document up to the cap must fit in the body (see body-limit.ts),
  // and one over Fastify's limit is refused with the usecase's own code.
  const bodyLimit = documentBodyLimit(deps.maxDocKb);
  const tooLarge = bodyTooLargeAs('document exceeds the size limit');
  // The client reads the doc-size cap, never hardcodes it.
  app.get(
    '/api/atlas/config',
    {
      schema: {
        tags: TAGS,
        summary: 'The limits the editor must respect',
        operationId: 'getAtlasConfig',
        response: { 200: configResponseSchema },
      },
    },
    () => ({ maxDocKb: deps.maxDocKb }),
  );

  app.get<{ Querystring: ListQuery }>(
    '/api/atlas',
    {
      schema: {
        tags: TAGS,
        summary: 'List saved XML documents',
        description:
          'Filter by name (`q`) or author device (`author`) and sort. `paged=true` opts into the ' +
          'offset envelope (PLAN-31); without it the response is the legacy bare array.',
        operationId: 'listAtlasDocs',
        querystring: listQuerySchema,
        response: { 200: listResponseSchema, ...errorResponses(400) },
      },
    },
    // `paged=true` opts into the envelope (PLAN-31); without it the response
    // is the bare array it always was, so the CLI and scripts are unaffected.
    (request) =>
      request.query.paged ? deps.list.executePage(request.query) : deps.list.execute(request.query),
  );

  app.post<{ Body: { name?: string; content: string } }>(
    '/api/atlas',
    {
      bodyLimit,
      errorHandler: tooLarge,
      schema: {
        tags: TAGS,
        summary: 'Save a new XML document',
        description: 'An omitted or blank name gets a generated, collision-free one.',
        operationId: 'createAtlasDoc',
        body: saveBodySchema,
        response: { 201: recordSchema, ...errorResponses(400, 413, 415) },
      },
    },
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
    {
      schema: {
        tags: TAGS,
        summary: 'The raw document text, as a public data URL',
        description:
          'Outside `/api/` on purpose, with CORS open: a saved document doubles as a stable URL ' +
          'for other tools. `?download` adds an attachment `content-disposition`.',
        operationId: 'getAtlasDocRaw',
        params: slugParamsSchema,
        querystring: rawQuerySchema,
        response: {
          200: rawBody('application/xml', 'The stored text, byte for byte', rawHeaders),
          301: {
            ...redirect('A stale slug: the canonical raw URL'),
            headers: { ...redirect('').headers, ...corsHeader },
          },
          ...errorResponses(400, 404),
        },
      },
    },
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
    {
      schema: {
        tags: TAGS,
        summary: 'Read one XML document by slug',
        operationId: 'getAtlasDoc',
        params: slugParamsSchema,
        response: {
          200: recordSchema,
          301: redirect('A stale slug whose id still matches: the canonical URL'),
          ...errorResponses(400, 404),
        },
      },
    },
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
    {
      bodyLimit,
      errorHandler: tooLarge,
      schema: {
        tags: TAGS,
        summary: 'Rename a XML document or replace its content',
        description: 'A rename regenerates the slug; links to the old one keep resolving.',
        operationId: 'updateAtlasDoc',
        params: idParamsSchema,
        body: updateBodySchema,
        response: { 200: recordSchema, ...errorResponses(400, 404, 413, 415) },
      },
    },
    (request) =>
      deps.update.execute({
        id: request.params.id,
        name: request.body.name,
        content: request.body.content,
      }),
  );

  app.delete<{ Params: { id: string } }>(
    '/api/atlas/:id',
    {
      schema: {
        tags: TAGS,
        summary: 'Delete a XML document',
        operationId: 'deleteAtlasDoc',
        params: idParamsSchema,
        response: { 204: noContent, ...errorResponses(400, 404) },
      },
    },
    async (request, reply) => {
      deps.remove.execute(request.params.id);
      return reply.code(204).send();
    },
  );
}
