import type { FastifyInstance } from 'fastify';
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
  app.get<{ Querystring: { event?: string; since?: number; until?: number; limit?: number; offset?: number } }>(
    '/api/heimdall/audit',
    { preHandler: app.requireAdmin, schema: { querystring: querySchema } },
    (request) => deps.listAudit.execute(request.query),
  );
}
