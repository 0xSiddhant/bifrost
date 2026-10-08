import Fastify, { type FastifyInstance } from 'fastify';
import type { EventBus } from '../bus/index.js';
import type { ContractCheckMode } from '../config/index.js';
import type { Logger } from '../logger/index.js';
import { registerContractCheck } from './contract.js';
import { registerOpenApi } from './openapi.js';

/**
 * Domain errors carry their HTTP status; everything else becomes an opaque
 * 500 — filesystem paths and stack traces never reach a client.
 */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
    /**
     * Machine-readable extras for refusals the client can *act* on rather than
     * only display — PLAN-17b's rename sends back the cleaned-up name it would
     * have used, so the UI can offer it as one click instead of asking the
     * user to guess what the sanitizer objected to. Parsing that out of the
     * prose message would be a contract nobody could see.
     */
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/** 255 characters × 12 encoded bytes each, rounded up. */
export const MAX_PARAM_LENGTH = 4096;

export interface HttpOptions {
  logger: Logger;
  /**
   * Publishes `http.requestCompleted` for every finished request, so a module
   * can measure the whole app without reaching into anyone else's routes
   * (PLAN-16b). Optional: tests that build a bare instance need not care.
   */
  bus?: EventBus;
  /** The response contract guard's mode (PLAN-32). Absent: `off`, for bare test instances. */
  contractCheck?: ContractCheckMode;
  /** The `info.version` of the generated OpenAPI description. */
  apiVersion?: string;
}

export async function buildHttp(options: HttpOptions): Promise<FastifyInstance> {
  // Cast once: fastify's instance generics carry the pino logger type, which
  // doesn't structurally assign back to the default FastifyInstance alias.
  // forceCloseConnections implements "drain/abort in-flight uploads" from the
  // shutdown sequence: close() would otherwise wait forever on a client that
  // is mid-stream through a 2 GB upload.
  const app = Fastify({
    loggerInstance: options.logger,
    forceCloseConnections: true,
    // The router's own cap on one path parameter, checked on the raw,
    // percent-encoded segment before any route runs (default 100 → a 414).
    // Stored names may be 255 characters, and one non-ASCII character is up
    // to 12 once encoded (4 UTF-8 bytes × `%XX`), so the cap must clear
    // 255 × 12; the route's own schema still decides what is valid (PLAN-33).
    routerOptions: { maxParamLength: MAX_PARAM_LENGTH },
    // PLAN-36: the web host forwards every request with X-Forwarded-For, and
    // the login throttle, presence, upload attribution, client-log relays and
    // Nimbus all key on request.ip. Believe the header only from loopback,
    // where the web host is: a LAN device cannot reach the loopback-bound API
    // to forge one, and a forged one sent to the web host is overwritten there.
    trustProxy: 'loopback',
  }) as unknown as FastifyInstance;

  // Both before auth and every module: swagger's route collector and the
  // contract guard's hooks only see routes registered after them (PLAN-32).
  await registerOpenApi(app, { version: options.apiVersion ?? '0.0.0' });
  registerContractCheck(app, options.contractCheck ?? 'off', options.logger);

  // Registered on the ROOT instance, which is the point: hooks are scoped to
  // the encapsulation context they are added in, and every module lives in its
  // own. Only core sees all of them.
  if (options.bus) {
    const bus = options.bus;
    app.addHook('onResponse', (request, reply, done) => {
      // The route TEMPLATE, never the concrete url — `/api/downloads/:id` is
      // one series, while the raw path would mint one per file id and turn a
      // histogram into a cardinality problem. Unmatched requests (404s, static
      // assets) share a single bucket for the same reason.
      bus.emit('http.requestCompleted', {
        route: request.routeOptions?.url ?? 'unmatched',
        method: request.method,
        statusCode: reply.statusCode,
        durationMs: reply.elapsedTime,
      });
      done();
    });
  }

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof AppError) {
      // The client is told *what* was refused; the archive is told *why*, in one
      // place instead of a log line per usecase. Fastify's own "request
      // completed" line carries the 4xx status but never the reason, so without
      // this a rejected settings patch, a 422 slug, or a 404 download leaves no
      // trace of what was wrong with it. `debug`, not `warn`: a domain
      // rejection is the system working, and at the trace-level default it
      // still reaches disk (PLAN-16a).
      request.log.debug(
        { code: error.code, statusCode: error.statusCode, reason: error.message },
        'request refused',
      );
      return reply.code(error.statusCode).send({
        error: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      });
    }
    if (error instanceof Error && 'validation' in error && error.validation) {
      return reply.code(400).send({ error: 'BAD_REQUEST', message: error.message });
    }
    // Well-formed 4xx from fastify plugins (rate limit, multipart caps, …):
    // client errors carry no internals, so their message may pass through.
    if (error instanceof Error) {
      const { statusCode, code } = error as Error & { statusCode?: unknown; code?: unknown };
      if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
        return reply.code(statusCode).send({
          error: typeof code === 'string' ? code : 'REQUEST_ERROR',
          message: error.message,
        });
      }
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.code(500).send({ error: 'INTERNAL', message: 'internal server error' });
  });

  // The client is the web host's to serve (PLAN-36); anything unmatched here
  // is an unknown API path.
  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ error: 'NOT_FOUND', message: 'route not found' }),
  );

  return app;
}
