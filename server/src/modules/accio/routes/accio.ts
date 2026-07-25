import type { FastifyInstance } from 'fastify';
import { deviceIdOf } from '../../../core/device.js';
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

interface ListQuery {
  q?: string;
  tag?: string;
  sort?: string;
  order?: string;
  limit?: number;
  offset?: number;
}

export function registerAccioRoutes(app: FastifyInstance, deps: AccioRoutesDeps): void {
  app.get<{ Querystring: ListQuery }>(
    '/api/accio',
    { schema: { querystring: listQuerySchema } },
    (request) => deps.list.execute(request.query),
  );

  app.post<{ Body: { url: string; title?: string; tags?: string[] } }>(
    '/api/accio',
    { schema: { body: saveBodySchema } },
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
    { schema: { params: idParamsSchema, body: updateBodySchema } },
    (request) =>
      deps.update.execute({
        id: request.params.id,
        title: request.body.title,
        tags: request.body.tags,
      }),
  );

  app.delete<{ Params: { id: string } }>(
    '/api/accio/:id',
    { schema: { params: idParamsSchema } },
    async (request, reply) => {
      deps.remove.execute(request.params.id);
      return reply.code(204).send();
    },
  );
}
