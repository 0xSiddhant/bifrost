import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { RunningApp } from './app.js';
import { createTestApp, TEST_PIN } from './testing/app.js';

/**
 * PLAN-37 criteria 2 and 3: the paths from before versions existed still mean
 * v1. For every operation in `server/openapi.json`, the old path answers with
 * the v1 path's status and byte-identical body, and only the old path adds
 * `Deprecation` and the `successor-version` link. Both paths are one route, so
 * they share one rate-limit bucket and one admin guard.
 *
 * Every request here is one that changes nothing (a read, or a write refused
 * for its missing body or unknown target), so the second request of a pair
 * meets the state the first one did.
 */

type Json = Record<string, unknown>;

interface Operation {
  method: string;
  /** The v1 path template, `{param}` style. */
  template: string;
  admin: boolean;
  hasBody: boolean;
}

const spec = JSON.parse(fs.readFileSync(new URL('../openapi.json', import.meta.url), 'utf8')) as {
  paths: Record<string, Record<string, Json>>;
};

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'patch']);

/** Not APIs, so never versioned and never rewritten (asserted below). */
const UNVERSIONED = new Set(['/go/{slug}', '/metrics']);

/** A stream, not a body: checked on its own below. */
const STREAMS = new Set(['GET /api/v1/events']);

/**
 * Answers that change between two identical calls whatever the path, each
 * named field masked before the bytes are compared, with the reason.
 */
const VOLATILE: Record<string, { fields: string[]; reason: string }> = {
  'GET /api/v1/health': { fields: ['uptime'], reason: 'seconds since boot, read at each call' },
};

/** Calls that end the admin session: sent without one, so both answer 401. */
const SESSION_ENDING = new Set(['POST /api/v1/heimdall/logout', 'POST /api/v1/heimdall/revoke']);

/**
 * A valid body for the admin writes whose fields are not all optional. Sent
 * without a session, so it is refused before it can change anything.
 */
const GUARD_BODIES: Record<string, Json> = {
  'PATCH /api/v1/offline-mode/settings': { id: 'loki', enabled: false },
};

const operations: Operation[] = Object.entries(spec.paths).flatMap(([template, item]) =>
  Object.entries(item)
    .filter(([method]) => HTTP_METHODS.has(method))
    .map(([method, operation]) => ({
      method: method.toUpperCase(),
      template,
      admin: Array.isArray(operation.security) && operation.security.length > 0,
      hasBody: 'requestBody' in operation,
    })),
);

const keyOf = (operation: Operation): string => `${operation.method} ${operation.template}`;

/** `/api/v1/x` → `/api/x`, `/edda/api/v1/x` → `/edda/api/x`. */
const legacyOf = (url: string): string => url.replace('/api/v1/', '/api/');

describe('legacy unversioned paths (PLAN-37)', () => {
  let app: RunningApp;
  let cookie: string;
  const slugs: Record<string, string> = {};
  let downloadId: string;

  const fill = (operation: Operation): string => {
    const kind = /^\/(?:api\/v1\/)?([a-z-]+)/.exec(operation.template.replace('/api/v1/', '/'));
    const document = kind?.[1] && slugs[kind[1]];
    return operation.template
      .replace('{slug}', document || 'no-such-slug')
      .replace('{id}', operation.template.includes('/downloads/') ? downloadId : 'no-such-id')
      .replace('{name}', operation.method === 'GET' ? 'staged.txt' : 'no-such-file.txt');
  };

  const send = (operation: Operation, url: string, withCookie = true, payload?: Json) =>
    app.fastify.inject({
      method: operation.method as 'GET',
      url,
      headers: {
        'x-bifrost-device': 'legacy-test',
        ...(withCookie && cookie ? { cookie } : {}),
      },
      ...(payload ? { payload } : {}),
    });

  beforeAll(async () => {
    app = await createTestApp({ BROTLI_RATE_LIMIT_PER_MIN: '4' });
    const { storage } = app.config;
    fs.mkdirSync(storage.downloads, { recursive: true });
    fs.mkdirSync(storage.uploads, { recursive: true });
    fs.writeFileSync(path.join(storage.downloads, 'shared.txt'), 'downloaded');
    fs.writeFileSync(path.join(storage.uploads, 'staged.txt'), 'staged');
    await app.fastify.ready();

    const login = await app.fastify.inject({
      method: 'POST',
      url: '/api/v1/heimdall/login',
      payload: { pin: TEST_PIN },
    });
    cookie = String(login.headers['set-cookie']).split(';')[0] ?? '';

    const contents: Record<string, string> = {
      runestone: '{"v":1}',
      edda: '# Title\n\nBody.',
      groot: 'kind: Deployment\n',
      atlas: '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict/>\n</plist>\n',
    };
    for (const [kind, content] of Object.entries(contents)) {
      const saved = await app.fastify.inject({
        method: 'POST',
        url: `/api/v1/${kind}`,
        payload: { name: `Legacy ${kind}`, content },
      });
      expect(saved.statusCode, kind).toBe(201);
      slugs[kind] = (saved.json() as { slug: string }).slug;
    }
    await app.fastify.inject({
      method: 'POST',
      url: '/api/v1/clipboard',
      payload: { text: 'legacy' },
    });
    const listing = await app.fastify.inject({ method: 'GET', url: '/api/v1/downloads' });
    downloadId = (listing.json() as { id: string }[])[0]?.id ?? 'no-download';
  }, 20_000);

  afterAll(async () => {
    await app.shutdown();
    fs.rmSync(app.config.storage.root, { recursive: true, force: true });
  });

  it('covers every operation in the spec, each under a version or named unversioned', () => {
    expect(operations.length).toBeGreaterThan(60);
    for (const operation of operations) {
      const versioned = /^(?:\/api|\/[a-z]+\/api)\/v1\//.test(operation.template);
      expect(versioned || UNVERSIONED.has(operation.template), keyOf(operation)).toBe(true);
    }
  });

  it('answers every old path with the v1 status and byte-identical body', async () => {
    const mismatches: string[] = [];
    for (const operation of operations) {
      if (UNVERSIONED.has(operation.template) || STREAMS.has(keyOf(operation))) continue;
      const v1 = fill(operation);
      const legacy = legacyOf(v1);
      const withCookie = !SESSION_ENDING.has(keyOf(operation));
      const fresh = await send(operation, v1, withCookie);
      const old = await send(operation, legacy, withCookie);
      const mask = (body: string): string => {
        const volatile = VOLATILE[keyOf(operation)];
        if (!volatile) return body;
        const parsed = JSON.parse(body) as Json;
        for (const field of volatile.fields) parsed[field] = '<volatile>';
        return JSON.stringify(parsed);
      };
      if (old.statusCode !== fresh.statusCode || mask(old.body) !== mask(fresh.body)) {
        mismatches.push(
          `${keyOf(operation)}: ${legacy} ${old.statusCode} ${old.body.slice(0, 120)} ≠ ` +
            `${v1} ${fresh.statusCode} ${fresh.body.slice(0, 120)}`,
        );
      }
      if (old.headers.deprecation !== 'true') mismatches.push(`${legacy}: no Deprecation`);
      if (old.headers.link !== `<${v1}>; rel="successor-version"`) {
        mismatches.push(`${legacy}: link ${String(old.headers.link)}`);
      }
      if (fresh.headers.deprecation !== undefined || fresh.headers.link !== undefined) {
        mismatches.push(`${v1}: carries a deprecation header`);
      }
    }
    expect(mismatches).toEqual([]);
  }, 30_000);

  it('refuses every admin operation on the old path without a session', async () => {
    const admin = operations.filter((operation) => operation.admin);
    expect(admin.length).toBeGreaterThan(5);
    for (const operation of admin) {
      const legacy = legacyOf(fill(operation));
      // A body that passes validation, so the guard, not validation, answers.
      const body = operation.hasBody ? (GUARD_BODIES[keyOf(operation)] ?? {}) : undefined;
      const res = await send(operation, legacy, false, body);
      expect(res.statusCode, `${operation.method} ${legacy}`).toBe(401);
    }
  });

  it('shares one rate-limit bucket between the two paths', async () => {
    const compress = (url: string) =>
      app.fastify.inject({
        method: 'POST',
        url,
        headers: { 'content-type': 'application/octet-stream' },
        payload: Buffer.from('bucket'),
        // Its own client, so the sweep above has spent none of this bucket.
        remoteAddress: '10.0.0.37',
      });
    // BROTLI_RATE_LIMIT_PER_MIN is 4: alternating paths hit 429 on the fifth call.
    const statuses: number[] = [];
    for (const url of [
      '/api/brotli/compress',
      '/api/v1/brotli/compress',
      '/api/brotli/compress',
      '/api/v1/brotli/compress',
      '/api/brotli/compress',
    ]) {
      statuses.push((await compress(url)).statusCode);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 429]);
  });

  it('counts old-path calls per route in bifrost_legacy_api_requests_total', async () => {
    await app.fastify.inject({ method: 'GET', url: '/api/health' });
    await app.fastify.inject({ method: 'GET', url: '/api/v1/health' });
    const metrics = await app.fastify.inject({ method: 'GET', url: '/metrics' });
    expect(metrics.body).toMatch(
      /bifrost_legacy_api_requests_total\{route="\/api\/v1\/health"\} [1-9]/,
    );
    expect(metrics.headers.deprecation).toBeUndefined();
  });

  it('routes the rewrite edge cases', async () => {
    const get = (url: string) => app.fastify.inject({ method: 'GET', url });

    // The version prefix alone, and a version nothing registers: 404, no rewrite.
    for (const url of ['/api/v1', '/api/v1/', '/api/v2/health', '/api/v2/edda']) {
      const res = await get(url);
      expect(res.statusCode, url).toBe(404);
      expect(res.headers.deprecation, url).toBeUndefined();
    }

    // The query string travels with the rewrite.
    const listing = await get('/api/edda?q=Legacy');
    expect(listing.statusCode).toBe(200);
    expect(listing.body).toBe((await get('/api/v1/edda?q=Legacy')).body);
    expect(listing.headers.link).toBe('</api/v1/edda?q=Legacy>; rel="successor-version"');

    // A slug that starts like a version is still a slug, on both raw paths.
    const saved = await app.fastify.inject({
      method: 'POST',
      url: '/api/v1/edda',
      payload: { name: 'v1 notes', content: '# v1' },
    });
    const { id, slug } = saved.json() as { id: string; slug: string };
    expect(slug.startsWith('v1-')).toBe(true);
    for (const url of [`/edda/api/${slug}`, `/edda/api/v1/${slug}`, `/api/edda/${slug}`]) {
      const res = await get(url);
      expect(res.statusCode, url).toBe(200);
    }
    expect((await get(`/edda/api/${slug}`)).body).toBe('# v1');

    // A raw path whose one segment is `v1` names the document `v1`, not the version.
    const v1Doc = await get('/runestone/api/v1');
    expect(v1Doc.statusCode).toBe(404);
    expect(v1Doc.headers.link).toBe('</runestone/api/v1/v1>; rel="successor-version"');
    expect(v1Doc.body).toBe((await get('/runestone/api/v1/v1')).body);

    // A stale slug through the old path redirects to the v1 canonical path.
    const renamed = await app.fastify.inject({
      method: 'PUT',
      url: `/api/v1/edda/${id}`,
      payload: { name: 'renamed notes' },
    });
    const fresh = (renamed.json() as { slug: string }).slug;
    const stale = await get(`/api/edda/${slug}`);
    expect(stale.statusCode).toBe(301);
    expect(stale.headers.location).toBe(`/api/v1/edda/${fresh}`);
    const staleRaw = await get(`/edda/api/${slug}?download=1`);
    expect(staleRaw.statusCode).toBe(301);
    expect(staleRaw.headers.location).toBe(`/edda/api/v1/${fresh}?download=1`);
  });

  it('leaves /go and /metrics unversioned and unrewritten', async () => {
    const go = await app.fastify.inject({ method: 'GET', url: '/go/nothing-here' });
    expect(go.headers.deprecation).toBeUndefined();
    const v1Metrics = await app.fastify.inject({ method: 'GET', url: '/api/v1/metrics' });
    expect(v1Metrics.statusCode).toBe(404);
  });

  it('streams events on the old /api/events path', async () => {
    await app.fastify.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.fastify.server.address() as AddressInfo;
    const received = await new Promise<{ headers: http.IncomingHttpHeaders; text: string }>(
      (resolve, reject) => {
        const request = http.get({ host: '127.0.0.1', port, path: '/api/events' }, (res) => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            text += chunk;
            if (text.includes('clipboard.updated')) {
              resolve({ headers: res.headers, text });
              request.destroy();
            }
          });
        });
        request.on('error', reject);
        // The stream is open once headers arrive; then something happens.
        request.on('response', () => {
          void app.fastify.inject({
            method: 'POST',
            url: '/api/clipboard',
            payload: { text: 'over sse' },
          });
        });
      },
    );
    expect(received.headers['content-type']).toMatch(/text\/event-stream/);
    expect(received.headers.deprecation).toBe('true');
    expect(received.headers.link).toBe('</api/v1/events>; rel="successor-version"');
  }, 15_000);
});
