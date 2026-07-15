import type { FastifyInstance } from 'fastify';
import { AppError } from '../../../core/http/index.js';
import { ThemeValidationError } from '../ports.js';
import type {
  AddThemeUseCase,
  DeleteThemeUseCase,
  GetThemeUseCase,
  ListThemesUseCase,
} from '../usecases/manage-themes.js';

export interface ThemeRoutesDeps {
  listThemes: ListThemesUseCase;
  getTheme: GetThemeUseCase;
  addTheme: AddThemeUseCase;
  deleteTheme: DeleteThemeUseCase;
  /** PLAN-05 swaps this flag for Heimdall session auth. */
  writeApiEnabled: boolean;
}

const idParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', pattern: '^[a-z0-9-]{2,32}$' } },
} as const;

export function registerThemeRoutes(app: FastifyInstance, deps: ThemeRoutesDeps): void {
  app.get('/api/themes', () => deps.listThemes.execute());

  app.get<{ Params: { id: string } }>(
    '/api/themes/:id',
    { schema: { params: idParamsSchema } },
    (request) => deps.getTheme.execute(request.params.id),
  );

  app.post('/api/themes', async (request, reply) => {
    assertWritable(deps);
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
    { schema: { params: idParamsSchema } },
    async (request, reply) => {
      assertWritable(deps);
      await deps.deleteTheme.execute(request.params.id);
      return reply.code(204).send();
    },
  );
}

function assertWritable(deps: ThemeRoutesDeps): void {
  if (!deps.writeApiEnabled) {
    throw new AppError('theme write api is disabled', 403, 'WRITE_DISABLED');
  }
}
