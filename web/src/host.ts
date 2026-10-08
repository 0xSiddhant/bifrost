import fs from 'node:fs';
import path from 'node:path';
import Fastify, { LogController, type FastifyInstance, type FastifyReply } from 'fastify';
import fastifyStatic from '@fastify/static';
import httpProxy from '@fastify/http-proxy';
import type { Logger } from './logger.js';
import { resolveStandalone, SECURITY_HEADERS } from './standalone-rules.js';

/**
 * The hub's web host (PLAN-36): one small Fastify app in front of the API.
 *
 * - **hub** (`full` mode): serves `client/dist` with the SPA fallback, exactly
 *   as the API server used to, and forwards the API's path roots to it on
 *   loopback. The browser stays on one origin, so cookies, SSE, raw-document
 *   links and the join QR are all unchanged.
 * - **standalone** (`web` mode): serves `client/dist-standalone` with the
 *   container's nginx rules and forwards nothing, so a hub path lands on the
 *   app, which shows "The Bifröst is closed".
 */

/** The API's own path roots: Vite's dev proxy list plus `/metrics`. */
export const PROXIED_ROOTS = [
  '/api',
  '/runestone/api',
  '/edda/api',
  '/groot/api',
  '/atlas/api',
  '/go',
  '/metrics',
] as const;

export type WebHostOptions =
  | {
      kind: 'hub';
      clientDir: string;
      upstream: { host: string; port: number };
      logger: Logger;
    }
  | { kind: 'standalone'; clientDir: string; logger: Logger };

/**
 * People follow `/go/<slug>` links, not the client, so a JSON 502 would land
 * raw in their browser. This is the sheet's copy, as a page of its own.
 */
export const GO_CLOSED_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Bifröst is closed</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.5 system-ui, sans-serif; margin: 0; min-height: 100vh; display: grid; place-items: center; }
  main { max-width: 28rem; padding: 2rem; text-align: center; }
  h1 { font-size: 1.4rem; margin: 0 0 .5rem; }
  p { margin: 0; opacity: .8; }
</style></head>
<body><main><h1>The Bifröst is closed</h1>
<p>This needs your Bifrost hub, and the bridge to it isn't open from here. Try again in a moment.</p></main></body></html>
`;

function hostForUrl(host: string): string {
  return host.includes(':') ? `[${host}]` : host;
}

export async function buildWebHost(options: WebHostOptions): Promise<FastifyInstance> {
  const { logger } = options;
  const app = Fastify({
    loggerInstance: logger,
    // The API logs every request it answers; logging each one here as well
    // would double the archive for no new information. This process logs its
    // own life, the upstream's state, and aborted streams.
    logController: new LogController({ disableRequestLogging: true }),
    forceCloseConnections: true,
  }) as unknown as FastifyInstance;

  // The web host's own liveness, for launchers, Docker and the API's upgrade
  // check. Never proxied, so it answers while the API is down.
  app.get('/healthz', async () => ({ ok: true, mode: options.kind }));

  app.addHook('onRequestAbort', (request, done) => {
    request.log.info({ method: request.method, url: request.url }, 'request aborted mid-stream');
    done();
  });

  if (options.kind === 'standalone') {
    await registerStandalone(app, options.clientDir);
    return app;
  }

  const { host, port } = options.upstream;
  const upstream = `http://${hostForUrl(host)}:${port}`;
  let upstreamDown = false;

  const upstreamFailed = (reply: FastifyReply, error: Error): void => {
    const request = reply.request;
    if (!upstreamDown) {
      upstreamDown = true;
      logger.warn(
        { upstream, url: request.url, err: error },
        'api upstream unreachable — answering HUB_UNAVAILABLE until it is back',
      );
    }
    if (request.url === '/go' || request.url.startsWith('/go/')) {
      void reply
        .code(503)
        .header('retry-after', '5')
        .header('cache-control', 'no-store')
        .type('text/html; charset=utf-8')
        .send(GO_CLOSED_PAGE);
      return;
    }
    void reply
      .code(502)
      .header('cache-control', 'no-store')
      .send({ error: 'HUB_UNAVAILABLE', message: 'the Bifrost API server is not answering' });
  };

  for (const prefix of PROXIED_ROOTS) {
    await app.register(httpProxy, {
      // reply-from logs every forwarded request at info ("fetching from
      // remote server", "response received"); the API already logs each one.
      logLevel: 'warn',
      upstream,
      prefix,
      rewritePrefix: prefix,
      // Spiked (decisions.md, PLAN-36): streams, SSE and 1 GB uploads pass
      // through unbuffered. The timeouts are off because a direct connection
      // had none: a slow 2 GB upload would otherwise outlast undici's 300 s
      // header timeout before the API could answer. The API's own limits rule.
      undici: { bodyTimeout: 0, headersTimeout: 0 },
      replyOptions: {
        rewriteRequestHeaders: (request, headers) => ({
          ...headers,
          // The API keeps seeing the address the device opened.
          host: request.headers.host,
          // Overwritten, never appended: this is the edge, and a forged header
          // from the LAN must not reach the API's loopback-only trustProxy.
          'x-forwarded-for': request.ip,
          'x-forwarded-proto': request.protocol,
        }),
        onResponse: (_request, reply, res) => {
          if (upstreamDown) {
            upstreamDown = false;
            logger.info({ upstream }, 'api upstream answering again');
          }
          // reply-from hands over the upstream body as `stream` (its types
          // still describe the raw response object).
          void reply.send((res as unknown as { stream: NodeJS.ReadableStream }).stream);
        },
        // reply-from types the reply for HTTP/2 too; this host is HTTP/1 only.
        onError: (reply, { error }) => upstreamFailed(reply as unknown as FastifyReply, error),
      },
    });
  }

  if (fs.existsSync(path.join(options.clientDir, 'index.html'))) {
    await app.register(fastifyStatic, { root: options.clientDir });
    // SPA fallback: unknown GETs get index.html so client routes deep-link.
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' || request.method === 'HEAD')
        return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'route not found' });
    });
  }

  return app;
}

async function registerStandalone(app: FastifyInstance, clientDir: string): Promise<void> {
  await app.register(fastifyStatic, { root: clientDir, serve: false });
  app.addHook('onSend', async (_request, reply) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) reply.header(name, value);
  });
  app.route({
    method: ['GET', 'HEAD'],
    url: '/*',
    handler: (request, reply) => {
      const pathname = decodeURIComponent(new URL(request.url, 'http://x').pathname);
      const hit = resolveStandalone(clientDir, pathname);
      reply.header('cache-control', hit.rule.cacheControl);
      if (!hit.file) {
        return reply.code(404).type('text/html').send('<h1>404 Not Found</h1>');
      }
      if (hit.rule.defaultType && !path.extname(hit.file)) reply.type(hit.rule.defaultType);
      return reply.sendFile(path.relative(clientDir, hit.file), { cacheControl: false });
    },
  });
  // nginx's static handler answers 405 to anything but GET and HEAD.
  app.setNotFoundHandler((_request, reply) => reply.code(405).send());
}
