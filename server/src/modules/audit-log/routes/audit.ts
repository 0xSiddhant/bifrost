import type { FastifyInstance } from 'fastify';
import { adminSecurity, errorResponses } from '../../../core/http/schemas.js';
import type { ListAuditUseCase } from '../usecases/list-audit.js';

export interface AuditRoutesDeps {
  listAudit: ListAuditUseCase;
}

const querySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    event: { type: 'string', maxLength: 64 },
    since: { type: 'integer', minimum: 0 },
    until: { type: 'integer', minimum: 0 },
    limit: { type: 'integer', minimum: 1, maximum: 500 },
    offset: { type: 'integer', minimum: 0 },
  },
} as const;

export function registerAuditRoutes(app: FastifyInstance, deps: AuditRoutesDeps): void {
  // Session-guarded (core/auth). Lives under /api/heimdall but the audit-log
  // module owns it — delete the module and only this endpoint disappears.
  app.get<{
    Querystring: {
      event?: string;
      since?: number;
      until?: number;
      limit?: number;
      offset?: number;
    };
  }>(
    '/api/heimdall/audit',
    {
      preHandler: app.requireAdmin,
      schema: {
        tags: ['audit-log'],
        summary: 'The audit history, newest first, filterable by event and time',
        operationId: 'listAudit',
        security: adminSecurity,
        querystring: querySchema,
        response: {
          200: {
            type: 'object',
            required: ['total', 'items', 'events'],
            properties: {
              total: { type: 'integer', description: 'Rows matching the filters' },
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['id', 'ts', 'event', 'deviceId', 'ip', 'summary'],
                  properties: {
                    id: { type: 'integer' },
                    ts: { type: 'integer', description: 'Unix epoch milliseconds' },
                    event: { type: 'string', description: 'A bus event name, e.g. heimdall.login' },
                    deviceId: { type: ['string', 'null'] },
                    ip: { type: ['string', 'null'] },
                    summary: { type: ['string', 'null'] },
                  },
                },
              },
              events: {
                type: 'array',
                items: { type: 'string' },
                description: 'Every distinct event name present, for the filter',
              },
            },
          },
          ...errorResponses(400, 401),
        },
      },
    },
    (request) => deps.listAudit.execute(request.query),
  );
}
