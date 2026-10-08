import type { FastifyInstance } from 'fastify';
import { deviceIdOf } from '../../../core/device.js';
import { errorResponses, noContent } from '../../../core/http/schemas.js';
import { cursorListPageSchema, pagedQueryProperties } from '../../../core/paging.js';
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
    ...pagedQueryProperties,
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

// Response shapes (PLAN-32), in the order the table and usecases build them.
const portkeySchema = {
  type: 'object',
  required: ['slug', 'url', 'note', 'hits', 'authorDeviceId', 'createdAt', 'lastUsedAt'],
  properties: {
    slug: { type: 'string', description: 'The memorable word; never changes' },
    url: { type: 'string', description: 'Normalized absolute http(s) target' },
    note: { type: ['string', 'null'] },
    hits: { type: 'integer', description: 'Redirects so far, counted after each hop' },
    authorDeviceId: { type: ['string', 'null'] },
    createdAt: { type: 'integer', description: 'Unix epoch milliseconds' },
    lastUsedAt: { type: ['integer', 'null'], description: 'null if never used' },
  },
} as const;

const listResponseSchema = {
  description: 'Without `paged=true`, the bare array it always was; with it, one keyset page',
  anyOf: [{ type: 'array', items: portkeySchema }, cursorListPageSchema(portkeySchema)],
} as const;

const TAGS = ['portkey'];

interface ListQuery {
  q?: string;
  limit?: number;
  offset?: number;
  paged?: boolean;
  cursor?: string;
}

export function registerPortkeyRoutes(app: FastifyInstance, deps: PortkeyRoutesDeps): void {
  app.get<{ Querystring: ListQuery }>(
    '/api/v1/portkey',
    {
      schema: {
        tags: TAGS,
        summary: 'List go-links',
        description:
          'Search with `q`. `paged=true` opts into the keyset envelope (PLAN-31), walked with ' +
          '`cursor`; without it the response is the legacy bare array.',
        operationId: 'listPortkeys',
        querystring: listQuerySchema,
        response: { 200: listResponseSchema, ...errorResponses(400) },
      },
    },
    // `paged=true` opts into the cursor envelope (PLAN-31); without it the
    // response is the bare array `bifrost portkey ls` still reads.
    (request) =>
      request.query.paged ? deps.list.executePage(request.query) : deps.list.execute(request.query),
  );

  app.post<{ Body: { slug: string; url: string; note?: string } }>(
    '/api/v1/portkey',
    {
      schema: {
        tags: TAGS,
        summary: 'Create a go-link: /go/<slug> → url',
        operationId: 'createPortkey',
        body: createBodySchema,
        response: { 201: portkeySchema, ...errorResponses(400, 409, 413, 415, 422) },
      },
    },
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
    '/api/v1/portkey/:slug',
    {
      schema: {
        tags: TAGS,
        summary: "Change a go-link's target or note",
        operationId: 'updatePortkey',
        params: slugParamsSchema,
        body: updateBodySchema,
        response: { 200: portkeySchema, ...errorResponses(400, 404, 413, 415, 422) },
      },
    },
    (request) =>
      deps.update.execute({
        slug: request.params.slug,
        url: request.body.url,
        note: request.body.note,
      }),
  );

  app.delete<{ Params: { slug: string } }>(
    '/api/v1/portkey/:slug',
    {
      schema: {
        tags: TAGS,
        summary: 'Delete a go-link',
        operationId: 'deletePortkey',
        params: slugParamsSchema,
        response: { 204: noContent, ...errorResponses(400, 404) },
      },
    },
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
    {
      schema: {
        tags: TAGS,
        summary: 'Follow a go-link',
        description:
          'A known slug redirects to its target (`cache-control: no-store`, so a changed target ' +
          'takes effect at once). An unknown one redirects to `/portkey?go=<slug>` to create it.',
        operationId: 'followPortkey',
        params: goParamsSchema,
        response: {
          302: {
            description: 'To the target, or to the create form for an unknown slug',
            type: 'null',
            headers: {
              location: { type: 'string' },
              'cache-control': { type: 'string', description: '`no-store` on a known slug' },
            },
          },
          ...errorResponses(400),
        },
      },
    },
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
