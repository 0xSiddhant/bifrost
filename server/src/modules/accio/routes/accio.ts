import type { FastifyInstance } from 'fastify';
import { deviceIdOf } from '../../../core/device.js';
import { errorResponses, noContent } from '../../../core/http/schemas.js';
import { cursorListPageSchema, pagedQueryProperties } from '../../../core/paging.js';
import { TAG_MAX_COUNT, TAG_MAX_LENGTH } from '../tags.js';
import { TITLE_MAX_LENGTH } from '../title.js';
import { URL_MAX_LENGTH } from '../url.js';
import type {
  DeleteLinkUseCase,
  ListLinksUseCase,
  SaveLinkUseCase,
  UpdateLinkUseCase,
} from '../usecases/manage-links.js';

export interface AccioRoutesDeps {
  list: ListLinksUseCase;
  save: SaveLinkUseCase;
  update: UpdateLinkUseCase;
  remove: DeleteLinkUseCase;
}

const tagsSchema = {
  type: 'array',
  maxItems: TAG_MAX_COUNT,
  items: { type: 'string', maxLength: TAG_MAX_LENGTH },
} as const;

const listQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    q: { type: 'string', maxLength: 120 },
    tag: { type: 'string', maxLength: TAG_MAX_LENGTH },
    sort: { enum: ['created', 'title', 'url'] },
    order: { enum: ['asc', 'desc'] },
    limit: { type: 'integer', minimum: 1, maximum: 500 },
    offset: { type: 'integer', minimum: 0 },
    ...pagedQueryProperties,
  },
} as const;

const saveBodySchema = {
  type: 'object',
  required: ['url'],
  additionalProperties: false,
  properties: {
    // Shape validation only — whether it is a *supported* URL is the usecase's
    // call (422 with a reason), not a schema rejection (400 with none).
    url: { type: 'string', minLength: 1, maxLength: URL_MAX_LENGTH },
    title: { type: 'string', maxLength: TITLE_MAX_LENGTH },
    tags: tagsSchema,
  },
} as const;

const updateBodySchema = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    // An empty string is meaningful here: it clears the title back to the URL.
    title: { type: 'string', maxLength: TITLE_MAX_LENGTH },
    tags: tagsSchema,
  },
} as const;

const idParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1, maxLength: 16 } },
} as const;

// Response shapes (PLAN-32), in the order the repository and usecases build them.
const linkSchema = {
  type: 'object',
  required: ['id', 'url', 'title', 'tags', 'authorDeviceId', 'createdAt'],
  properties: {
    id: { type: 'string' },
    url: { type: 'string', description: 'Normalized absolute http(s) URL' },
    title: {
      type: ['string', 'null'],
      description: 'null until one is given or the background lookup finds one',
    },
    tags: { type: 'array', items: { type: 'string' }, description: 'Lowercased, deduped' },
    authorDeviceId: { type: ['string', 'null'] },
    createdAt: { type: 'integer', description: 'Unix epoch milliseconds' },
  },
} as const;

const listResponseSchema = {
  description: 'Without `paged=true`, the bare array it always was; with it, one keyset page',
  anyOf: [
    { type: 'array', items: linkSchema },
    cursorListPageSchema(linkSchema, {
      tags: { type: 'array', items: { type: 'string' }, description: 'Every tag on the shelf' },
    }),
  ],
} as const;

const TAGS = ['accio'];

interface ListQuery {
  q?: string;
  tag?: string;
  sort?: string;
  order?: string;
  limit?: number;
  offset?: number;
  paged?: boolean;
  cursor?: string;
}

export function registerAccioRoutes(app: FastifyInstance, deps: AccioRoutesDeps): void {
  app.get<{ Querystring: ListQuery }>(
    '/api/accio',
    {
      schema: {
        tags: TAGS,
        summary: 'List saved links',
        description:
          'Search (`q`), filter by `tag` and sort. `paged=true` opts into the keyset envelope ' +
          '(PLAN-31), walked with `cursor`; without it the response is the legacy bare array.',
        operationId: 'listLinks',
        querystring: listQuerySchema,
        response: { 200: listResponseSchema, ...errorResponses(400) },
      },
    },
    // `paged=true` opts into the cursor envelope (PLAN-31); without it the
    // response is the bare array it always was.
    (request) =>
      request.query.paged ? deps.list.executePage(request.query) : deps.list.execute(request.query),
  );

  app.post<{ Body: { url: string; title?: string; tags?: string[] } }>(
    '/api/accio',
    {
      schema: {
        tags: TAGS,
        summary: 'Save a link',
        description: 'Without a title, one is looked up in the background and arrives by event.',
        operationId: 'saveLink',
        body: saveBodySchema,
        response: { 201: linkSchema, ...errorResponses(400, 413, 415, 422) },
      },
    },
    async (request, reply) => {
      const link = deps.save.execute({
        url: request.body.url,
        title: request.body.title,
        tags: request.body.tags,
        authorDeviceId: deviceIdOf(request),
      });
      // 201 the moment the row exists. Title enrichment runs off the bus and
      // reaches open shelves as an `accio.updated` SSE event, not in this body.
      return reply.code(201).send(link);
    },
  );

  app.patch<{ Params: { id: string }; Body: { title?: string; tags?: string[] } }>(
    '/api/accio/:id',
    {
      schema: {
        tags: TAGS,
        summary: "Change a link's title or tags",
        operationId: 'updateLink',
        params: idParamsSchema,
        body: updateBodySchema,
        response: { 200: linkSchema, ...errorResponses(400, 404, 413, 415) },
      },
    },
    (request) =>
      deps.update.execute({
        id: request.params.id,
        title: request.body.title,
        tags: request.body.tags,
      }),
  );

  app.delete<{ Params: { id: string } }>(
    '/api/accio/:id',
    {
      schema: {
        tags: TAGS,
        summary: 'Delete a link',
        operationId: 'deleteLink',
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
