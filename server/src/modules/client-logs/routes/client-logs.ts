import type { FastifyInstance } from 'fastify';
import type { AppConfig, LogLevel } from '../../../core/config/index.js';
import { LOG_LEVELS } from '../../../core/config/index.js';
import type { Logger } from '../../../core/logger/index.js';
import { deviceIdOf } from '../../../core/device.js';
import { atOrAboveFloor } from '../levels.js';

/** One reported line, after schema validation. */
export interface ClientLogEntry {
  level: LogLevel;
  msg: string;
  module?: string;
  route?: string;
  stack?: string;
  /** Browser clock, ms. Kept as a field — the line's own `time` is the server's. */
  ts?: number;
}

export interface ClientLogRoutesDeps {
  settings: AppConfig['clientLogs'];
  /** A `source: "client"` logger bound to the reporting feature's name. */
  loggerFor: (moduleName: string) => Logger;
  /** This module's own server-side logger. */
  log: Logger;
}

/** Feature name for reports that don't belong to a page (shell, boot, router). */
const DEFAULT_MODULE = 'app';

const MAX_MSG = 2000;
const MAX_STACK = 8000;
const MAX_ROUTE = 200;

const batchSchema = (maxBatch: number) =>
  ({
    type: 'object',
    required: ['entries'],
    additionalProperties: false,
    properties: {
      entries: {
        type: 'array',
        minItems: 1,
        maxItems: maxBatch,
        items: {
          type: 'object',
          required: ['level', 'msg'],
          additionalProperties: false,
          properties: {
            level: { type: 'string', enum: LOG_LEVELS },
            msg: { type: 'string', minLength: 1, maxLength: MAX_MSG },
            // Matches the server's module naming so the label lines up with a
            // server module of the same name.
            module: { type: 'string', pattern: '^[a-z0-9-]{1,40}$' },
            route: { type: 'string', maxLength: MAX_ROUTE },
            stack: { type: 'string', maxLength: MAX_STACK },
            ts: { type: 'integer' },
          },
        },
      },
    },
  }) as const;

export function registerClientLogRoutes(app: FastifyInstance, deps: ClientLogRoutesDeps): void {
  const { settings } = deps;

  // Public, and read once on boot: the client is a static build that never sees
  // .env, so the floor has to be delivered over the wire. Same shape as
  // /api/loki/config and /api/screensaver/config.
  app.get('/api/client-logs/config', () => ({
    level: settings.level,
    maxBatch: settings.maxBatch,
  }));

  app.post<{ Body: { entries: ClientLogEntry[] } }>(
    '/api/client-logs',
    {
      // Both bounds matter and they bound different things: bodyLimit stops one
      // enormous request (413 before the body is read), the rate limit stops
      // many small ones. This is an unauthenticated write path into the same
      // files the server's own archive lives in.
      bodyLimit: settings.maxBodyBytes,
      config: { rateLimit: { max: settings.rateLimitPerMin, timeWindow: 60_000 } },
      schema: { body: batchSchema(settings.maxBatch) },
    },
    (request, reply) => {
      const deviceId = deviceIdOf(request);
      const ua = request.headers['user-agent'] ?? null;
      let accepted = 0;
      let dropped = 0;

      for (const entry of request.body.entries) {
        if (!atOrAboveFloor(entry.level, settings.level)) {
          dropped += 1;
          continue;
        }
        const log = deps.loggerFor(entry.module ?? DEFAULT_MODULE);
        // "Which device, which page" is the first question every time — the
        // owner is not sitting at the phone that hit this.
        log[entry.level](
          {
            deviceId,
            route: entry.route ?? null,
            ua,
            ip: request.ip,
            clientTime: entry.ts ?? null,
            stack: entry.stack,
          },
          entry.msg,
        );
        accepted += 1;
      }

      // Returned rather than swallowed so "my client logs aren't showing up"
      // has an answer that doesn't require reading the server's source.
      if (dropped > 0) {
        deps.log.debug({ dropped, floor: settings.level }, 'client log entries below the floor');
      }
      return reply.code(202).send({ accepted, dropped });
    },
  );
}
