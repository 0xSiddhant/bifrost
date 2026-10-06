import type { FastifyInstance } from 'fastify';
import { closeAdminSession, openAdminSession, type AuthService } from '../../../core/auth/index.js';
import type { EventBus } from '../../../core/bus/index.js';
import { adminSecurity, errorResponses, noContent } from '../../../core/http/schemas.js';
import type { Logger } from '../../../core/logger/index.js';
import type { LoginThrottle } from '../login-throttle.js';
import type { GetSettingsUseCase, UpdateSettingsUseCase } from '../usecases/manage-settings.js';
import type { GetStatsUseCase } from '../usecases/get-stats.js';
import type { ListUploadFilesUseCase } from '../usecases/list-upload-files.js';

export interface HeimdallRoutesDeps {
  auth: AuthService;
  throttle: LoginThrottle;
  bus: EventBus;
  log: Logger;
  getSettings: GetSettingsUseCase;
  updateSettings: UpdateSettingsUseCase;
  getStats: GetStatsUseCase;
  listUploadFiles: ListUploadFilesUseCase;
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

const TAGS = ['heimdall'];

const okSchema = {
  type: 'object',
  required: ['ok'],
  properties: { ok: { type: 'boolean', enum: [true] } },
} as const;

/** `HeimdallSettings`, in the order the settings usecases build it. */
const settingsSchema = {
  type: 'object',
  required: ['shortcut', 'tapCount', 'defaultThemeId'],
  properties: {
    shortcut: { type: 'string', description: 'The key chord that opens the PIN prompt' },
    tapCount: { type: 'integer', description: 'Taps on the logo that open it on touch screens' },
    defaultThemeId: {
      type: ['string', 'null'],
      description: 'null: clients follow prefers-color-scheme',
    },
  },
} as const;

const statsSchema = {
  type: 'object',
  required: ['uptimeSeconds', 'connectedClients', 'uploads', 'disk', 'totalBytes', 'activity'],
  properties: {
    uptimeSeconds: { type: 'integer' },
    connectedClients: { type: 'integer', description: 'Open event streams' },
    uploads: {
      type: 'object',
      required: ['total', 'today'],
      properties: { total: { type: 'integer' }, today: { type: 'integer' } },
    },
    disk: {
      type: 'array',
      items: {
        type: 'object',
        required: ['folder', 'bytes', 'files'],
        properties: {
          folder: { type: 'string' },
          bytes: { type: 'integer' },
          files: { type: 'integer' },
        },
      },
    },
    totalBytes: { type: 'integer' },
    activity: {
      type: 'array',
      items: { type: 'integer' },
      description: '24 hourly upload counts, oldest first; the last is the current hour',
    },
  },
} as const;

const uploadsPageSchema = {
  type: 'object',
  required: ['total', 'items'],
  properties: {
    total: { type: 'integer' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'size', 'mtime'],
        properties: {
          name: { type: 'string' },
          size: { type: 'integer' },
          mtime: { type: 'integer', description: 'Unix epoch milliseconds' },
        },
      },
    },
  },
} as const;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function registerHeimdallRoutes(app: FastifyInstance, deps: HeimdallRoutesDeps): void {
  const guard = { preHandler: app.requireAdmin };

  // Public: the entry gesture needs the current shortcut + tap count to work.
  // Not a security boundary (the PIN is) — just the door, not the key.
  app.get(
    '/api/heimdall/access',
    {
      schema: {
        tags: TAGS,
        summary: 'The entry gesture: the shortcut and tap count that open the PIN prompt',
        description: 'Public on purpose: it is the door, not the key. The PIN is the boundary.',
        operationId: 'getHeimdallAccess',
        response: {
          200: {
            type: 'object',
            required: ['shortcut', 'tapCount'],
            properties: {
              shortcut: settingsSchema.properties.shortcut,
              tapCount: settingsSchema.properties.tapCount,
            },
          },
        },
      },
    },
    () => {
      const { shortcut, tapCount } = deps.getSettings.execute();
      return { shortcut, tapCount };
    },
  );

  app.post<{ Body: { pin: string } }>(
    '/api/heimdall/login',
    {
      schema: {
        tags: TAGS,
        summary: 'Log in with the PIN; sets the admin session cookie',
        description:
          'Failed attempts are throttled per IP: delayed, then refused with 429 and `retry-after`.',
        operationId: 'login',
        body: loginSchema,
        response: {
          200: okSchema,
          429: {
            ...errorResponses(429)[429],
            headers: { 'retry-after': { type: 'integer', description: 'Seconds' } },
          },
          ...errorResponses(400, 401, 413, 415),
        },
      },
    },
    async (request, reply) => {
      const { ip } = request;
      const decision = deps.throttle.check(ip);
      if (!decision.allowed) {
        deps.log.warn({ ip }, 'heimdall login blocked: rate limited');
        deps.bus.emit('heimdall.login', { outcome: 'locked', ip });
        return reply
          .header('retry-after', Math.ceil(decision.retryAfterMs / 1000))
          .code(429)
          .send({ error: 'RATE_LIMITED', message: 'too many attempts — try again later' });
      }
      if (decision.delayMs > 0) await sleep(decision.delayMs);

      if (!deps.auth.verifyPin(request.body.pin)) {
        deps.throttle.fail(ip);
        deps.log.warn({ ip }, 'heimdall login failed: bad pin');
        deps.bus.emit('heimdall.login', { outcome: 'failure', ip });
        return reply.code(401).send({ error: 'BAD_PIN', message: 'incorrect pin' });
      }

      deps.throttle.succeed(ip);
      openAdminSession(request, deps.auth);
      deps.log.info({ ip }, 'heimdall login ok');
      deps.bus.emit('heimdall.login', { outcome: 'success', ip });
      return reply.code(200).send({ ok: true });
    },
  );

  app.post(
    '/api/heimdall/logout',
    {
      schema: {
        tags: TAGS,
        summary: "End this browser's admin session",
        operationId: 'logout',
        response: { 204: noContent, ...errorResponses(400, 413, 415) },
      },
    },
    (request, reply) => {
      closeAdminSession(request);
      return reply.code(204).send();
    },
  );

  // Session probe: 200 when a live session exists, 401 otherwise. The client
  // uses this to decide panel-vs-404 on a direct /heimdall visit or refresh.
  app.get(
    '/api/heimdall/session',
    {
      ...guard,
      schema: {
        tags: TAGS,
        summary: 'Probe: 200 with a live admin session, 401 without',
        operationId: 'getSession',
        security: adminSecurity,
        response: { 200: okSchema, ...errorResponses(401) },
      },
    },
    () => ({ ok: true }),
  );

  app.post(
    '/api/heimdall/revoke',
    {
      ...guard,
      schema: {
        tags: TAGS,
        summary: 'Revoke every admin session, this one included',
        operationId: 'revokeSessions',
        security: adminSecurity,
        response: { 204: noContent, ...errorResponses(400, 401, 413, 415) },
      },
    },
    (request, reply) => {
      deps.auth.revokeAll();
      deps.log.warn({ ip: request.ip }, 'heimdall sessions revoked');
      return reply.code(204).send();
    },
  );

  app.get(
    '/api/heimdall/settings',
    {
      ...guard,
      schema: {
        tags: TAGS,
        summary: 'The runtime settings',
        operationId: 'getSettings',
        security: adminSecurity,
        response: { 200: settingsSchema, ...errorResponses(401) },
      },
    },
    () => deps.getSettings.execute(),
  );

  app.patch<{ Body: { shortcut?: string; tapCount?: number; defaultThemeId?: string | null } }>(
    '/api/heimdall/settings',
    {
      ...guard,
      schema: {
        tags: TAGS,
        summary: 'Change runtime settings; open clients rebind live',
        operationId: 'updateSettings',
        security: adminSecurity,
        body: settingsPatchSchema,
        response: { 200: settingsSchema, ...errorResponses(400, 401, 413, 415) },
      },
    },
    (request) => deps.updateSettings.execute(request.body),
  );

  app.get<{ Querystring: { limit?: number; offset?: number } }>(
    '/api/heimdall/uploads',
    {
      ...guard,
      schema: {
        tags: TAGS,
        summary: 'Files in uploads/, newest first',
        operationId: 'listUploadFiles',
        security: adminSecurity,
        querystring: uploadsQuerySchema,
        response: { 200: uploadsPageSchema, ...errorResponses(400, 401) },
      },
    },
    (request) => deps.listUploadFiles.execute(request.query.limit, request.query.offset),
  );

  app.get(
    '/api/heimdall/stats',
    {
      ...guard,
      schema: {
        tags: TAGS,
        summary: 'Dashboard figures: uptime, clients, uploads, disk, 24 h of activity',
        operationId: 'getStats',
        security: adminSecurity,
        response: { 200: statsSchema, ...errorResponses(401) },
      },
    },
    () => deps.getStats.execute(),
  );
}
