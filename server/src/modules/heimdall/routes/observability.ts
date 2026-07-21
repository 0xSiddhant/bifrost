import fs from 'node:fs';
import os from 'node:os';
import type { FastifyInstance } from 'fastify';
import type { AppConfig, LogLevel } from '../../../core/config/index.js';
import type { Logger } from '../../../core/logger/index.js';
import type { LogTap } from '../../../core/logtap.js';
import type { AuthService } from '../../../core/auth/index.js';
import { getBuildInfo } from '../../../core/build-info.js';
import { fromRepoRoot } from '../../../core/paths.js';

const LEVEL_VALUE: Record<string, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

const HEARTBEAT_MS = 25_000;

export interface ObservabilityRoutesDeps {
  config: AppConfig;
  log: Logger;
  logTap: LogTap;
  setLogLevel: (level: LogLevel) => void;
  persistLevel: (level: LogLevel) => void;
  auth: AuthService;
}

/**
 * Is a log-stream connection still admin-authorized? Re-checked before every
 * `log.line` send (and on the heartbeat): the epoch + expiry are captured at
 * connect, so a revoke (epoch bump) or the session expiring stops delivery even
 * though the long-lived SSE request can't re-read the cookie.
 */
export function sessionStreamLive(
  epoch: unknown,
  expiresAt: unknown,
  currentEpoch: number,
  now: number,
): boolean {
  return (
    typeof epoch === 'number' &&
    epoch === currentEpoch &&
    typeof expiresAt === 'number' &&
    expiresAt > now
  );
}

const logsQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    lines: { type: 'integer', minimum: 1, maximum: 1000 },
    level: { type: 'string', enum: ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] },
    module: { type: 'string', maxLength: 40 },
  },
} as const;

const levelBodySchema = {
  type: 'object',
  required: ['level'],
  additionalProperties: false,
  properties: {
    level: { type: 'string', enum: ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] },
  },
} as const;

/** About + Logs endpoints for the Heimdall modal (PLAN-10). All admin-guarded. */
export function registerObservabilityRoutes(app: FastifyInstance, deps: ObservabilityRoutesDeps): void {
  const guard = { preHandler: app.requireAdmin };

  app.get('/api/heimdall/about', guard, () => ({
    ...getBuildInfo(),
    uptimeSeconds: Math.floor(process.uptime()),
    node: process.version,
    host: os.hostname(),
    profile: deps.config.profile,
  }));

  app.get('/api/heimdall/changelog', guard, () => {
    let content = '';
    try {
      content = fs.readFileSync(fromRepoRoot('CHANGELOG.md'), 'utf8');
    } catch {
      // no changelog yet
    }
    return { content };
  });

  app.get<{ Querystring: { lines?: number; level?: string; module?: string } }>(
    '/api/heimdall/logs',
    { ...guard, schema: { querystring: logsQuerySchema } },
    (request) => {
      const { lines = 200, level, module } = request.query;
      const min = level ? (LEVEL_VALUE[level] ?? 0) : 0;
      const all = deps.logTap.recent();
      let entries = all.filter((e) => e.level >= min && (!module || e.module === module));
      if (entries.length > lines) entries = entries.slice(entries.length - lines);
      const modules = [...new Set(all.map((e) => e.module).filter((m): m is string => Boolean(m)))].sort();
      return { level: deps.log.level, entries, modules };
    },
  );

  app.patch<{ Body: { level: LogLevel } }>(
    '/api/heimdall/logs/level',
    { ...guard, schema: { body: levelBodySchema } },
    (request) => {
      const { level } = request.body;
      deps.setLogLevel(level);
      deps.persistLevel(level);
      deps.log.info({ level }, 'log level changed at runtime');
      return { level };
    },
  );

  // Admin-gated live tail. requireAdmin guards the connect; each send re-checks
  // the epoch/expiry captured here, so revoke/Lock/expiry stops delivery. The
  // client closes the stream when the modal closes, which covers plain logout.
  app.get('/api/heimdall/logs/stream', guard, (request, reply) => {
    const epoch = request.session.get('epoch');
    const expiresAt = request.session.get('expiresAt');

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write(': connected\n\n');

    let closed = false;
    const stop = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    };
    const live = (): boolean => sessionStreamLive(epoch, expiresAt, deps.auth.currentEpoch, Date.now());

    const unsubscribe = deps.logTap.subscribe((entry) => {
      if (!live()) return stop();
      res.write(`event: log.line\ndata: ${JSON.stringify(entry)}\n\n`);
    });
    const heartbeat = setInterval(() => {
      if (!live()) return stop();
      res.write(': hb\n\n');
    }, HEARTBEAT_MS);
    heartbeat.unref();

    request.raw.on('close', stop);
  });
}
