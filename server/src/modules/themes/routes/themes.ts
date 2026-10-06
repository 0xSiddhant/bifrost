import type { FastifyInstance } from 'fastify';
import {
  adminSecurity,
  errorResponseSchema,
  errorResponses,
  noContent,
} from '../../../core/http/schemas.js';
import { ThemeValidationError } from '../ports.js';
import type {
  AddThemeUseCase,
  DeleteThemeUseCase,
  GetThemeUseCase,
  ListManagedThemesUseCase,
  ListThemesUseCase,
  SetThemeEnabledUseCase,
} from '../usecases/manage-themes.js';

export interface ThemeRoutesDeps {
  listThemes: ListThemesUseCase;
  getTheme: GetThemeUseCase;
  addTheme: AddThemeUseCase;
  deleteTheme: DeleteThemeUseCase;
  listManagedThemes: ListManagedThemesUseCase;
  setThemeEnabled: SetThemeEnabledUseCase;
}

const idParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', pattern: '^[a-z0-9-]{2,32}$' } },
} as const;

const enabledBodySchema = {
  type: 'object',
  required: ['enabled'],
  additionalProperties: false,
  properties: { enabled: { type: 'boolean' } },
} as const;

// Response shapes (PLAN-32), in the order `toSummary` and `resolveTheme` build them.
const summaryProperties = {
  id: { type: 'string' },
  name: { type: 'string' },
  mode: { type: 'string', enum: ['dark', 'light'] },
  preview: {
    type: 'object',
    required: ['bg', 'accent'],
    properties: { bg: { type: 'string' }, accent: { type: 'string' } },
  },
  builtIn: { type: 'boolean' },
  warnings: {
    type: 'array',
    items: { type: 'string' },
    description: 'Contrast findings: a warning, never a refusal',
  },
} as const;

const summaryRequired = ['id', 'name', 'mode', 'preview', 'builtIn', 'warnings'] as const;

const summarySchema = {
  type: 'object',
  required: summaryRequired,
  properties: summaryProperties,
} as const;

const managedSummarySchema = {
  type: 'object',
  required: [...summaryRequired, 'enabled'],
  properties: { ...summaryProperties, enabled: { type: 'boolean' } },
} as const;

const resolvedThemeSchema = {
  type: 'object',
  required: [...summaryRequired, 'tokens'],
  properties: {
    ...summaryProperties,
    tokens: {
      type: 'object',
      additionalProperties: { type: 'string' },
      description: 'Every CSS custom property, derived ones included, in the order applied',
    },
  },
} as const;

const invalidThemeSchema = {
  description: 'The theme failed schema validation: every issue, with its path',
  type: 'object',
  required: ['error', 'message', 'issues'],
  properties: {
    error: { type: 'string', enum: ['INVALID_THEME'] },
    message: { type: 'string' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        required: ['path', 'message'],
        properties: { path: { type: 'string' }, message: { type: 'string' } },
      },
    },
  },
} as const;

const TAGS = ['themes'];

export function registerThemeRoutes(app: FastifyInstance, deps: ThemeRoutesDeps): void {
  // Reads are open; writes require a Heimdall session (PLAN-05 — replaces the
  // former THEME_WRITE_API flag). `requireAdmin` is decorated in core/auth.
  const guard = { preHandler: app.requireAdmin };

  app.get(
    '/api/themes',
    {
      schema: {
        tags: TAGS,
        summary: 'The enabled themes, and the server default if one is set and enabled',
        operationId: 'listThemes',
        response: {
          200: {
            type: 'object',
            required: ['defaultId', 'themes'],
            properties: {
              defaultId: { type: ['string', 'null'] },
              themes: { type: 'array', items: summarySchema },
            },
          },
        },
      },
    },
    () => deps.listThemes.execute(),
  );

  // Static path — Fastify matches it ahead of the `/:id` param route.
  app.get(
    '/api/themes/manage',
    {
      ...guard,
      schema: {
        tags: TAGS,
        summary: 'Every theme with its enabled flag',
        operationId: 'listManagedThemes',
        security: adminSecurity,
        response: {
          200: {
            type: 'object',
            required: ['themes'],
            properties: { themes: { type: 'array', items: managedSummarySchema } },
          },
          ...errorResponses(401),
        },
      },
    },
    () => deps.listManagedThemes.execute(),
  );

  app.get<{ Params: { id: string } }>(
    '/api/themes/:id',
    {
      schema: {
        tags: TAGS,
        summary: 'One theme with its resolved tokens',
        operationId: 'getTheme',
        params: idParamsSchema,
        response: { 200: resolvedThemeSchema, ...errorResponses(400, 404) },
      },
    },
    (request) => deps.getTheme.execute(request.params.id),
  );

  app.patch<{ Params: { id: string }; Body: { enabled: boolean } }>(
    '/api/themes/:id',
    {
      ...guard,
      schema: {
        tags: TAGS,
        summary: 'Enable or disable a theme; open switchers update live',
        operationId: 'setThemeEnabled',
        security: adminSecurity,
        params: idParamsSchema,
        body: enabledBodySchema,
        response: { 200: managedSummarySchema, ...errorResponses(400, 401, 404, 409, 413, 415) },
      },
    },
    (request) => deps.setThemeEnabled.execute(request.params.id, request.body.enabled),
  );

  app.post(
    '/api/themes',
    {
      ...guard,
      schema: {
        tags: TAGS,
        summary: 'Add a theme from its JSON (THEME-SPEC.md)',
        description:
          'The body is validated against the published theme schema in the usecase, so every ' +
          'issue comes back at once; a built-in id is 403, an existing one 409.',
        operationId: 'addTheme',
        security: adminSecurity,
        response: {
          201: summarySchema,
          422: {
            anyOf: [invalidThemeSchema, errorResponseSchema],
            description: invalidThemeSchema.description,
          },
          ...errorResponses(400, 401, 403, 409, 413, 415),
        },
      },
    },
    async (request, reply) => {
      try {
        const summary = await deps.addTheme.execute(request.body);
        return await reply.code(201).send(summary);
      } catch (error) {
        if (error instanceof ThemeValidationError) {
          return reply.code(422).send({
            error: 'INVALID_THEME',
            message: 'theme failed schema validation',
            issues: error.issues,
          });
        }
        throw error;
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/themes/:id',
    {
      ...guard,
      schema: {
        tags: TAGS,
        summary: 'Delete a user-added theme',
        operationId: 'deleteTheme',
        security: adminSecurity,
        params: idParamsSchema,
        response: { 204: noContent, ...errorResponses(400, 401, 403, 404) },
      },
    },
    async (request, reply) => {
      await deps.deleteTheme.execute(request.params.id);
      return reply.code(204).send();
    },
  );
}
