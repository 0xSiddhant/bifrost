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
  const app = Fastify({ loggerInstance: options.logger }) as unknown as FastifyInstance;

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({ error: error.code, message: error.message });
    }
    if (error instanceof Error && 'validation' in error && error.validation) {
      return reply.code(400).send({ error: 'BAD_REQUEST', message: error.message });
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
