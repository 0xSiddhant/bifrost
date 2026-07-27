import type { FastifyInstance } from 'fastify';
import { deviceIdOf } from '../../../core/device.js';
import { SLUG_MAX_LENGTH } from '../slug.js';
import { NOTE_MAX_LENGTH } from '../usecases/manage-portkeys.js';
import { TARGET_MAX_LENGTH } from '../target.js';
import type {
  CreatePortkeyUseCase,
  DeletePortkeyUseCase,
  ListPortkeysUseCase,
  ResolvePortkeyUseCase,
  UpdatePortkeyUseCase,
} from '../usecases/manage-portkeys.js';

export interface PortkeyRoutesDeps {
  list: ListPortkeysUseCase;
  create: CreatePortkeyUseCase;
  update: UpdatePortkeyUseCase;
  remove: DeletePortkeyUseCase;
  resolve: ResolvePortkeyUseCase;
  /**
   * Fire-and-forget hit accounting. The module schedules the DB write to run
   * AFTER the redirect is flushed (and swallows/logs its own failures), so the
   * hop is never delayed by it.
   */
  countHit: (slug: string) => void;
}

const listQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    q: { type: 'string', maxLength: 120 },
    limit: { type: 'integer', minimum: 1, maximum: 1000 },
    offset: { type: 'integer', minimum: 0 },
  },
} as const;

const createBodySchema = {
  type: 'object',
  required: ['slug', 'url'],
  additionalProperties: false,
  properties: {
    // Shape only — whether the slug/url are *acceptable* is the usecase's call
    // (422 with a reason, or 409), not a schema rejection (400 with none).
    slug: { type: 'string', minLength: 1, maxLength: SLUG_MAX_LENGTH },
    url: { type: 'string', minLength: 1, maxLength: TARGET_MAX_LENGTH },
    note: { type: 'string', maxLength: NOTE_MAX_LENGTH },
  },
} as const;

const updateBodySchema = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    url: { type: 'string', minLength: 1, maxLength: TARGET_MAX_LENGTH },
    // An empty string is meaningful: it clears the note.
    note: { type: 'string', maxLength: NOTE_MAX_LENGTH },
  },
} as const;

const slugParamsSchema = {
  type: 'object',
  required: ['slug'],
  properties: { slug: { type: 'string', minLength: 1, maxLength: SLUG_MAX_LENGTH } },
} as const;

/** The public /go/:slug param is looser — an unknown/odd slug becomes a 404 hop. */
const goParamsSchema = {
  type: 'object',
  required: ['slug'],
  properties: { slug: { type: 'string', minLength: 1, maxLength: 200 } },
} as const;

interface ListQuery {
  q?: string;
  limit?: number;
  offset?: number;
}

export function registerPortkeyRoutes(app: FastifyInstance, deps: PortkeyRoutesDeps): void {
  app.get<{ Querystring: ListQuery }>(
    '/api/portkey',
    { schema: { querystring: listQuerySchema } },
    (request) => deps.list.execute(request.query),
  );

  app.post<{ Body: { slug: string; url: string; note?: string } }>(
    '/api/portkey',
    { schema: { body: createBodySchema } },
    async (request, reply) => {
      const portkey = deps.create.execute({
        slug: request.body.slug,
        url: request.body.url,
        note: request.body.note,
        authorDeviceId: deviceIdOf(request),
      });
      return reply.code(201).send(portkey);
    },
  );

  app.patch<{ Params: { slug: string }; Body: { url?: string; note?: string } }>(
    '/api/portkey/:slug',
    { schema: { params: slugParamsSchema, body: updateBodySchema } },
    (request) =>
      deps.update.execute({
        slug: request.params.slug,
        url: request.body.url,
        note: request.body.note,
      }),
  );

  app.delete<{ Params: { slug: string } }>(
    '/api/portkey/:slug',
    { schema: { params: slugParamsSchema } },
    async (request, reply) => {
      deps.remove.execute(request.params.slug);
      return reply.code(204).send();
    },
  );

  // The redirect itself. Registered before the SPA fallback (it's a real route,
  // so it wins), OUTSIDE /api/ so `bifrost.local/go/router` is the whole address
  // a person types. Always 302 — a router IP or NAS moves, and a 301 would pin
  // the stale target in every browser cache brutally.
  app.get<{ Params: { slug: string } }>(
    '/go/:slug',
    { schema: { params: goParamsSchema } },
    async (request, reply) => {
      const target = deps.resolve.execute(request.params.slug);
      if (!target) {
        // Creative 404: bounce to the management page with the missing slug so
        // its "enchant it now" form is pre-filled (the Runestone/Edda move).
        return reply.redirect(`/portkey?go=${encodeURIComponent(request.params.slug)}`, 302);
      }
      reply.header('cache-control', 'no-store');
      reply.redirect(target.url, 302);
      // AFTER the redirect is on its way: bump the hit count out of band, so a
      // slow DB write can never delay the hop (plan acceptance 1).
      deps.countHit(target.slug);
      return reply;
    },
  );
}
