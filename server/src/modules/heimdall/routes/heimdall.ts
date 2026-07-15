import type { FastifyInstance } from 'fastify';
import { closeAdminSession, openAdminSession, type AuthService } from '../../../core/auth/index.js';
import type { Logger } from '../../../core/logger/index.js';
import type { LoginThrottle } from '../login-throttle.js';
import type { GetSettingsUseCase, UpdateSettingsUseCase } from '../usecases/manage-settings.js';
import type { GetStatsUseCase } from '../usecases/get-stats.js';
import type { ListUploadsUseCase } from '../usecases/list-uploads.js';

export interface HeimdallRoutesDeps {
  auth: AuthService;
  throttle: LoginThrottle;
  log: Logger;
  getSettings: GetSettingsUseCase;
  updateSettings: UpdateSettingsUseCase;
  getStats: GetStatsUseCase;
  listUploads: ListUploadsUseCase;
}

const loginSchema = {
  type: 'object',
  required: ['pin'],
  additionalProperties: false,
  properties: { pin: { type: 'string', minLength: 1, maxLength: 128 } },
} as const;

const settingsPatchSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    shortcut: { type: 'string', maxLength: 64 },
    tapCount: { type: 'integer' },
    defaultThemeId: { type: ['string', 'null'], maxLength: 32 },
  },
} as const;

const uploadsQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    limit: { type: 'integer', minimum: 1, maximum: 200 },
    offset: { type: 'integer', minimum: 0 },
  },
} as const;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function registerHeimdallRoutes(app: FastifyInstance, deps: HeimdallRoutesDeps): void {
  const guard = { preHandler: app.requireAdmin };

  // Public: the entry gesture needs the current shortcut + tap count to work.
  // Not a security boundary (the PIN is) — just the door, not the key.
  app.get('/api/heimdall/access', () => {
    const { shortcut, tapCount } = deps.getSettings.execute();
    return { shortcut, tapCount };
  });

  app.post<{ Body: { pin: string } }>(
    '/api/heimdall/login',
    { schema: { body: loginSchema } },
    async (request, reply) => {
      const { ip } = request;
      const decision = deps.throttle.check(ip);
      if (!decision.allowed) {
        deps.log.warn({ ip }, 'heimdall login blocked: rate limited');
        return reply
          .header('retry-after', Math.ceil(decision.retryAfterMs / 1000))
          .code(429)
          .send({ error: 'RATE_LIMITED', message: 'too many attempts — try again later' });
      }
      if (decision.delayMs > 0) await sleep(decision.delayMs);

      if (!deps.auth.verifyPin(request.body.pin)) {
        deps.throttle.fail(ip);
        deps.log.warn({ ip }, 'heimdall login failed: bad pin');
        return reply.code(401).send({ error: 'BAD_PIN', message: 'incorrect pin' });
      }

      deps.throttle.succeed(ip);
      openAdminSession(request, deps.auth);
      deps.log.info({ ip }, 'heimdall login ok');
      return reply.code(200).send({ ok: true });
    },
  );

  app.post('/api/heimdall/logout', (request, reply) => {
    closeAdminSession(request);
    return reply.code(204).send();
  });

  // Session probe: 200 when a live session exists, 401 otherwise. The client
  // uses this to decide panel-vs-404 on a direct /heimdall visit or refresh.
  app.get('/api/heimdall/session', guard, () => ({ ok: true }));

  app.post('/api/heimdall/revoke', guard, (request, reply) => {
    deps.auth.revokeAll();
    deps.log.warn({ ip: request.ip }, 'heimdall sessions revoked');
    return reply.code(204).send();
  });

  app.get('/api/heimdall/settings', guard, () => deps.getSettings.execute());

  app.patch<{ Body: { shortcut?: string; tapCount?: number; defaultThemeId?: string | null } }>(
    '/api/heimdall/settings',
    { ...guard, schema: { body: settingsPatchSchema } },
    (request) => deps.updateSettings.execute(request.body),
  );

  app.get<{ Querystring: { limit?: number; offset?: number } }>(
    '/api/heimdall/uploads',
    { ...guard, schema: { querystring: uploadsQuerySchema } },
    (request) => deps.listUploads.execute(request.query.limit, request.query.offset),
  );

  app.get('/api/heimdall/stats', guard, () => deps.getStats.execute());
}
