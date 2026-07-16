import type { FastifyInstance } from 'fastify';
import { deviceIdOf } from '../../../core/device.js';
import type {
  AddClipboardEntryUseCase,
  DeleteClipboardEntryUseCase,
  ListClipboardUseCase,
} from '../usecases/manage-clipboard.js';

export interface ClipboardRoutesDeps {
  listEntries: ListClipboardUseCase;
  addEntry: AddClipboardEntryUseCase;
  deleteEntry: DeleteClipboardEntryUseCase;
}

const bodySchema = {
  type: 'object',
  required: ['text'],
  additionalProperties: false,
  properties: {
    text: { type: 'string', minLength: 1 },
    kind: { enum: ['text', 'code'] },
    lang: { type: 'string', maxLength: 32 },
    ttlSeconds: { type: 'integer', minimum: 1, maximum: 604800 },
  },
} as const;

const idParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
} as const;

export function registerClipboardRoutes(app: FastifyInstance, deps: ClipboardRoutesDeps): void {
  app.get('/api/clipboard', () => deps.listEntries.execute());

  app.post<{ Body: { text: string; kind?: string; lang?: string; ttlSeconds?: number } }>(
    '/api/clipboard',
    { schema: { body: bodySchema } },
    async (request, reply) => {
      const entry = deps.addEntry.execute({ ...request.body, deviceId: deviceIdOf(request) });
      return reply.code(201).send(entry);
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/clipboard/:id',
    { schema: { params: idParamsSchema } },
    async (request, reply) => {
      deps.deleteEntry.execute(request.params.id);
      return reply.code(204).send();
    },
  );
}
