import type { FastifyInstance } from 'fastify';
import { errorResponses } from '../../../core/http/schemas.js';
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

/** `PresenceDevice`, in the order the presence builder writes it. */
const deviceSchema = {
  type: 'object',
  required: ['deviceId', 'name', 'charName', 'label', 'online', 'lastSeen'],
  properties: {
    deviceId: { type: 'string' },
    name: { type: ['string', 'null'], description: 'The friendly name the device claimed' },
    charName: {
      type: ['string', 'null'],
      description: 'The auto-assigned alias, the default display name',
    },
    label: { type: 'string', description: 'From the user agent, e.g. "iPhone · Safari"' },
    online: { type: 'boolean', description: 'Holds an open event stream right now' },
    lastSeen: { type: 'integer', description: 'Unix epoch milliseconds' },
  },
} as const;

const devicesSchema = { type: 'array', items: deviceSchema } as const;

const TAGS = ['presence'];

export function registerPresenceRoutes(app: FastifyInstance, deps: PresenceRoutesDeps): void {
  app.get(
    '/api/presence',
    {
      schema: {
        tags: TAGS,
        summary: 'Every known device, online first, then most recently seen',
        operationId: 'listPresence',
        response: {
          200: { type: 'object', required: ['devices'], properties: { devices: devicesSchema } },
        },
      },
    },
    () => ({ devices: deps.buildPresence.execute() }),
  );

  // On-demand prune of devices offline for > 7 days — the Wardens surfaces call
  // this on open. Device activity elsewhere is preserved (no cascade).
  app.post(
    '/api/presence/prune',
    {
      schema: {
        tags: TAGS,
        summary: 'Forget devices offline for more than 7 days',
        operationId: 'prunePresence',
        response: {
          200: {
            type: 'object',
            required: ['removed', 'devices'],
            properties: { removed: { type: 'integer' }, devices: devicesSchema },
          },
          ...errorResponses(400, 413, 415),
        },
      },
    },
    () => deps.pruneStale.execute(),
  );

  app.patch<{ Body: { deviceId: string; name?: string | null } }>(
    '/api/presence/name',
    {
      schema: {
        tags: TAGS,
        summary: 'Claim (or clear, with null) a friendly name for a device',
        operationId: 'claimDeviceName',
        body: nameBodySchema,
        response: {
          200: { type: 'object', required: ['devices'], properties: { devices: devicesSchema } },
          ...errorResponses(400, 404, 413, 415),
        },
      },
    },
    (request) => ({
      devices: deps.claimName.execute(request.body.deviceId, request.body.name ?? null),
    }),
  );
}
