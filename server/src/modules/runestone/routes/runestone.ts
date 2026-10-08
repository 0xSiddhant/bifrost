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
  DeleteRunestoneUseCase,
  GetRunestoneUseCase,
  ListRunestonesUseCase,
  SaveRunestoneUseCase,
  UpdateRunestoneUseCase,
} from '../usecases/manage-runestones.js';

export interface RunestoneRoutesDeps {
  maxDocKb: number;
  list: ListRunestonesUseCase;
  save: SaveRunestoneUseCase;
  get: GetRunestoneUseCase;
  update: UpdateRunestoneUseCase;
  remove: DeleteRunestoneUseCase;
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
    content: { type: 'string', minLength: 1 },
  },
} as const;

const updateBodySchema = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 80 },
    content: { type: 'string', minLength: 1 },
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

const rawHeaders = corsHeader;

const TAGS = ['runestone'];

interface ListQuery {
  q?: string;
  author?: string;
  sort?: string;
  order?: string;
  limit?: number;
  offset?: number;
  paged?: boolean;
}

export function registerRunestoneRoutes(app: FastifyInstance, deps: RunestoneRoutesDeps): void {
  // PLAN-33: a document up to the cap must fit in the body (see body-limit.ts),
  // and one over Fastify's limit is refused with the usecase's own code.
  const bodyLimit = documentBodyLimit(deps.maxDocKb);
  const tooLarge = bodyTooLargeAs('document exceeds the size limit');
  app.get<{ Querystring: ListQuery }>(
    '/api/runestone',
    {
      schema: {
        tags: TAGS,
        summary: 'List saved JSON documents',
        description:
          'Filter by name (`q`) or author device (`author`) and sort. `paged=true` opts into the ' +
          'offset envelope (PLAN-31); without it the response is the legacy bare array.',
        operationId: 'listRunestones',
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
    '/api/runestone',
    {
      bodyLimit,
      errorHandler: tooLarge,
      schema: {
        tags: TAGS,
        summary: 'Save a new JSON document',
        description: 'An omitted or blank name gets a generated, collision-free one.',
        operationId: 'createRunestone',
        body: saveBodySchema,
        response: { 201: recordSchema, ...errorResponses(400, 413, 415, 422) },
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

  // Public read-only data endpoint (owner requirement, post-Part-B): the raw
  // document JSON at /runestone/api/:slug — outside /api/ so a saved runestone
  // doubles as a stable data URL for third-party tools. Registered routes win
  // over the SPA fallback, so only this exact shape escapes the client app.
  // CORS is wide open: it serves nothing but the document the URL names.
  app.get<{ Params: { slug: string } }>(
    '/runestone/api/:slug',
    {
      schema: {
        tags: TAGS,
        summary: 'The raw document text, as a public data URL',
        description:
          'Outside `/api/` on purpose, with CORS open: a saved document doubles as a stable URL ' +
          'for other tools.',
        operationId: 'getRunestoneRaw',
        params: slugParamsSchema,
        response: {
          200: rawBody('application/json', 'The stored text, byte for byte', rawHeaders),
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
        return reply.redirect(`/runestone/api/${encodeURIComponent(record.slug)}`, 301);
      }
      // Raw stored text, not a re-serialization — formatting and number
      // precision survive exactly as carved.
      return reply.type('application/json; charset=utf-8').send(record.content);
    },
  );

  // :slug resolves saved docs; a stale-name slug with a valid id 301s to the
  // canonical slug so renamed documents keep every shared link alive.
  app.get<{ Params: { slug: string } }>(
    '/api/runestone/:slug',
    {
      schema: {
        tags: TAGS,
        summary: 'Read one JSON document by slug',
        operationId: 'getRunestone',
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
        return reply.redirect(`/api/runestone/${encodeURIComponent(record.slug)}`, 301);
      }
      return record;
    },
  );

  app.put<{ Params: { id: string }; Body: { name?: string; content?: string } }>(
    '/api/runestone/:id',
    {
      bodyLimit,
      errorHandler: tooLarge,
      schema: {
        tags: TAGS,
        summary: 'Rename a JSON document or replace its content',
        description: 'A rename regenerates the slug; links to the old one keep resolving.',
        operationId: 'updateRunestone',
        params: idParamsSchema,
        body: updateBodySchema,
        response: { 200: recordSchema, ...errorResponses(400, 404, 413, 415, 422) },
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
    '/api/runestone/:id',
    {
      schema: {
        tags: TAGS,
        summary: 'Delete a JSON document',
        operationId: 'deleteRunestone',
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
