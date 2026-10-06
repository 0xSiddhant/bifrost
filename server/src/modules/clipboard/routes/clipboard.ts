import type { FastifyInstance } from 'fastify';
import { deviceIdOf } from '../../../core/device.js';
import { errorResponses, noContent } from '../../../core/http/schemas.js';
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

/** `ClipboardEntry`, in the order the repository and usecase build it. */
const entrySchema = {
  type: 'object',
  required: ['id', 'text', 'kind', 'lang', 'deviceId', 'createdAt'],
  properties: {
    id: { type: 'string' },
    text: { type: 'string' },
    kind: { type: 'string', enum: ['text', 'code'] },
    lang: { type: ['string', 'null'], description: 'Highlighting language for code entries' },
    deviceId: { type: ['string', 'null'], description: 'The posting device, when known' },
    createdAt: { type: 'integer', description: 'Unix epoch milliseconds' },
  },
} as const;

const TAGS = ['clipboard'];

export function registerClipboardRoutes(app: FastifyInstance, deps: ClipboardRoutesDeps): void {
  app.get(
    '/api/clipboard',
    {
      schema: {
        tags: TAGS,
        summary: 'The shared clipboard, newest first (expired entries excluded)',
        operationId: 'listClipboard',
        response: { 200: { type: 'array', items: entrySchema } },
      },
    },
    () => deps.listEntries.execute(),
  );

  app.post<{ Body: { text: string; kind?: string; lang?: string; ttlSeconds?: number } }>(
    '/api/clipboard',
    {
      schema: {
        tags: TAGS,
        summary: 'Add a clipboard entry',
        description: 'The oldest entries beyond the cap are dropped; `ttlSeconds` makes it expire.',
        operationId: 'addClipboardEntry',
        body: bodySchema,
        response: { 201: entrySchema, ...errorResponses(400, 413, 415) },
      },
    },
    async (request, reply) => {
      const entry = deps.addEntry.execute({ ...request.body, deviceId: deviceIdOf(request) });
      return reply.code(201).send(entry);
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/clipboard/:id',
    {
      schema: {
        tags: TAGS,
        summary: 'Delete a clipboard entry',
        operationId: 'deleteClipboardEntry',
        params: idParamsSchema,
        response: { 204: noContent, ...errorResponses(400, 404) },
      },
    },
    async (request, reply) => {
      deps.deleteEntry.execute(request.params.id);
      return reply.code(204).send();
    },
  );
}
