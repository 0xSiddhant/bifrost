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
  DeleteEddaUseCase,
  GetEddaUseCase,
  ListEddasUseCase,
  SaveEddaUseCase,
  UpdateEddaUseCase,
} from '../usecases/manage-eddas.js';

export interface EddaRoutesDeps {
  maxDocKb: number;
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
    paged: pagedQueryProperties.paged,
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

const listResponseSchema = {
  description: 'Without `paged=true`, the bare array it always was; with it, one page',
  anyOf: [{ type: 'array', items: summarySchema }, documentListPageSchema(summarySchema)],
} as const;

const rawHeaders = {
  ...corsHeader,
  'content-disposition': {
    type: 'string',
    description: 'With `?download`: `attachment; filename="<name>.md"`',
  },
};

const TAGS = ['edda'];

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
  // PLAN-33: a document up to the cap must fit in the body (see body-limit.ts),
  // and one over Fastify's limit is refused with the usecase's own code.
  const bodyLimit = documentBodyLimit(deps.maxDocKb);
  const tooLarge = bodyTooLargeAs('document exceeds the size limit');
  app.get<{ Querystring: ListQuery }>(
    '/api/v1/edda',
    {
      schema: {
        tags: TAGS,
        summary: 'List saved Markdown documents',
        description:
          'Filter by name (`q`) or author device (`author`) and sort. `paged=true` opts into the ' +
          'offset envelope (PLAN-31); without it the response is the legacy bare array.',
        operationId: 'listEddas',
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
    '/api/v1/edda',
    {
      bodyLimit,
      errorHandler: tooLarge,
      schema: {
        tags: TAGS,
        summary: 'Save a new Markdown document',
        description: 'An omitted or blank name gets a generated, collision-free one.',
        operationId: 'createEdda',
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

  // Public read-only raw endpoint (owner spec — "api" literally in the path):
  // the raw Markdown at /edda/api/v1/:slug, outside /api/ so a saved edda doubles
  // as a stable data URL. Registered routes win over the SPA fallback, so only
  // this exact shape escapes the client app. CORS is wide open: it serves
  // nothing but the document the URL names. `?download=1` → attachment.
  app.get<{ Params: { slug: string }; Querystring: { download?: string } }>(
    '/edda/api/v1/:slug',
    {
      schema: {
        tags: TAGS,
        summary: 'The raw document text, as a public data URL',
        description:
          'Outside `/api/` on purpose, with CORS open: a saved document doubles as a stable URL ' +
          'for other tools. `?download` adds an attachment `content-disposition`.',
        operationId: 'getEddaRaw',
        params: slugParamsSchema,
        querystring: rawQuerySchema,
        response: {
          200: rawBody('text/markdown', 'The stored text, byte for byte', rawHeaders),
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
        return reply.redirect(`/edda/api/v1/${encodeURIComponent(record.slug)}${suffix}`, 301);
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
    '/api/v1/edda/:slug',
    {
      schema: {
        tags: TAGS,
        summary: 'Read one Markdown document by slug',
        operationId: 'getEdda',
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
        return reply.redirect(`/api/v1/edda/${encodeURIComponent(record.slug)}`, 301);
      }
      return record;
    },
  );

  app.put<{ Params: { id: string }; Body: { name?: string; content?: string } }>(
    '/api/v1/edda/:id',
    {
      bodyLimit,
      errorHandler: tooLarge,
      schema: {
        tags: TAGS,
        summary: 'Rename a Markdown document or replace its content',
        description: 'A rename regenerates the slug; links to the old one keep resolving.',
        operationId: 'updateEdda',
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
    '/api/v1/edda/:id',
    {
      schema: {
        tags: TAGS,
        summary: 'Delete a Markdown document',
        operationId: 'deleteEdda',
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
