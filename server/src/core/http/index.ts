import fs from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import type { Logger } from '../logger/index.js';

/**
 * Domain errors carry their HTTP status; everything else becomes an opaque
 * 500 — filesystem paths and stack traces never reach a client.
 */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export interface HttpOptions {
  logger: Logger;
  /** Absolute path to the built client. Skipped when absent (dev mode: Vite serves it). */
  clientDistDir: string;
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
  }) as unknown as FastifyInstance;

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
      return reply.code(error.statusCode).send({ error: error.code, message: error.message });
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

  if (fs.existsSync(options.clientDistDir)) {
    await app.register(fastifyStatic, { root: options.clientDistDir });
    // SPA fallback: unknown non-API GETs get index.html so client routes deep-link.
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/')) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'route not found' });
    });
  } else {
    options.logger.info(
      { clientDistDir: options.clientDistDir },
      'client build not found — API only (dev mode serves the client via Vite)',
    );
    app.setNotFoundHandler((_request, reply) =>
      reply.code(404).send({ error: 'NOT_FOUND', message: 'route not found' }),
    );
  }

  return app;
}
