import type { FastifyInstance } from 'fastify';
import { deviceIdOf } from '../../../core/device.js';
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

interface ListQuery {
  q?: string;
  author?: string;
  sort?: string;
  order?: string;
  limit?: number;
  offset?: number;
}

export function registerRunestoneRoutes(app: FastifyInstance, deps: RunestoneRoutesDeps): void {
  // Part A contract: the client reads the doc-size cap, never hardcodes it.
  app.get('/api/runestone/config', () => ({ maxDocKb: deps.maxDocKb }));

  app.get<{ Querystring: ListQuery }>(
    '/api/runestone',
    { schema: { querystring: listQuerySchema } },
    (request) => deps.list.execute(request.query),
  );

  app.post<{ Body: { name?: string; content: string } }>(
    '/api/runestone',
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

  // :slug resolves saved docs; a stale-name slug with a valid id 301s to the
  // canonical slug so renamed documents keep every shared link alive.
  app.get<{ Params: { slug: string } }>(
    '/api/runestone/:slug',
    { schema: { params: slugParamsSchema } },
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
    { schema: { params: idParamsSchema, body: updateBodySchema } },
    (request) =>
      deps.update.execute({
        id: request.params.id,
        name: request.body.name,
        content: request.body.content,
      }),
  );

  app.delete<{ Params: { id: string } }>(
    '/api/runestone/:id',
    { schema: { params: idParamsSchema } },
    async (request, reply) => {
      deps.remove.execute(request.params.id);
      return reply.code(204).send();
    },
  );
}
