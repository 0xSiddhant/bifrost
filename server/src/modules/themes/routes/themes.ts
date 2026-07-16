import type { FastifyInstance } from 'fastify';
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

export function registerThemeRoutes(app: FastifyInstance, deps: ThemeRoutesDeps): void {
  // Reads are open; writes require a Heimdall session (PLAN-05 — replaces the
  // former THEME_WRITE_API flag). `requireAdmin` is decorated in core/auth.
  const guard = { preHandler: app.requireAdmin };

  app.get('/api/themes', () => deps.listThemes.execute());

  // Static path — Fastify matches it ahead of the `/:id` param route.
  app.get('/api/themes/manage', guard, () => deps.listManagedThemes.execute());

  app.get<{ Params: { id: string } }>(
    '/api/themes/:id',
    { schema: { params: idParamsSchema } },
    (request) => deps.getTheme.execute(request.params.id),
  );

  app.patch<{ Params: { id: string }; Body: { enabled: boolean } }>(
    '/api/themes/:id',
    { ...guard, schema: { params: idParamsSchema, body: enabledBodySchema } },
    (request) => deps.setThemeEnabled.execute(request.params.id, request.body.enabled),
  );

  app.post('/api/themes', guard, async (request, reply) => {
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
  });

  app.delete<{ Params: { id: string } }>(
    '/api/themes/:id',
    { ...guard, schema: { params: idParamsSchema } },
    async (request, reply) => {
      await deps.deleteTheme.execute(request.params.id);
      return reply.code(204).send();
    },
  );
}
