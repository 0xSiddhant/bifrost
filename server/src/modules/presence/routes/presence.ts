import type { FastifyInstance } from 'fastify';
import type {
  BuildPresenceUseCase,
  ClaimNameUseCase,
  PruneStaleDevicesUseCase,
} from '../usecases/presence.js';

export interface PresenceRoutesDeps {
  buildPresence: BuildPresenceUseCase;
  claimName: ClaimNameUseCase;
  pruneStale: PruneStaleDevicesUseCase;
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

  // On-demand prune of devices offline for > 7 days — the Wardens surfaces call
  // this on open. Device activity elsewhere is preserved (no cascade).
  app.post('/api/presence/prune', () => deps.pruneStale.execute());

  app.patch<{ Body: { deviceId: string; name?: string | null } }>(
    '/api/presence/name',
    { schema: { body: nameBodySchema } },
    (request) => ({ devices: deps.claimName.execute(request.body.deviceId, request.body.name ?? null) }),
  );
}
