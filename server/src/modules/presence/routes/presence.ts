import type { FastifyInstance } from 'fastify';
import type { BuildPresenceUseCase, ClaimNameUseCase } from '../usecases/presence.js';

export interface PresenceRoutesDeps {
  buildPresence: BuildPresenceUseCase;
  claimName: ClaimNameUseCase;
}

const nameBodySchema = {
  type: 'object',
  required: ['deviceId'],
  additionalProperties: false,
  properties: {
    deviceId: { type: 'string', minLength: 1, maxLength: 64 },
    name: { type: ['string', 'null'], maxLength: 40 },
  },
} as const;

export function registerPresenceRoutes(app: FastifyInstance, deps: PresenceRoutesDeps): void {
  app.get('/api/presence', () => ({ devices: deps.buildPresence.execute() }));

  app.patch<{ Body: { deviceId: string; name?: string | null } }>(
    '/api/presence/name',
    { schema: { body: nameBodySchema } },
    (request) => ({ devices: deps.claimName.execute(request.body.deviceId, request.body.name ?? null) }),
  );
}
