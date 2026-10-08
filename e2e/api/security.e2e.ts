import fs from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import { fromRepoRoot } from '../support/paths.js';
import { startServer, type E2EServer } from '../support/server.js';
import { startTitleSink, type TitleSink } from '../support/sink.js';
import { valid } from './fuzz/arbitraries.js';
import { Client, type RecordedResponse } from './support/http.js';
import { readPath, seedAll, waitForDownload, type Seeds } from './support/seed.js';
import type { Operation } from './support/spec.js';
import { apiSuite, closingChecks } from './support/suite.js';

/**
 * The security sweep (PLAN-33), generated from openapi.json wherever it can
 * be, so a new route joins it without anyone remembering to add it: admin
 * guarding, path traversal (against a canary outside the storage root),
 * size-limit honesty, rate limits and login lockout, CORS, and served-type
 * safety. Error hygiene — no path, stack frame or canary in any body — is
 * every API file's closing check, this one included.
 */

const suite = apiSuite('security', { canary: true });
const extra: E2EServer[] = [];
let sink: TitleSink;
let seeds: Seeds;

afterAll(async () => {
  for (const server of extra) await server.stop();
});

/** One valid request for any operation, generated from its schemas: enough to pass validation. */
function validRequest(op: Operation, seed: number): { url: string; json?: unknown } {
  const one = <T>(arbitrary: fc.Arbitrary<T>): T =>
    fc.sample(arbitrary, { numRuns: 1, seed })[0] as T;
  const url = op.template.replace(/\{(\w+)\}/g, (_m, name: string) => {
    const parameter = op.parameters.find((candidate) => candidate.name === name);
    return encodeURIComponent(
      String(one(valid(parameter?.schema ?? { type: 'string', minLength: 1 }, 'url'))),
    );
  });
  const query = new URLSearchParams();
  for (const parameter of op.parameters) {
    if (parameter.in === 'query' && parameter.required) {
      query.set(parameter.name, String(one(valid(parameter.schema, 'url'))));
    }
  }
  const search = query.toString();
  return {
    url: `${url}${search ? `?${search}` : ''}`,
    ...(op.body ? { json: one(valid(op.body.schema)) } : {}),
  };
}

function send(
  client: Client,
  op: Operation,
  request: { url: string; json?: unknown },
  cookie?: string,
) {
  return client.request(op.method, request.url, {
    ...(request.json === undefined ? {} : { json: request.json }),
    ...(cookie === undefined ? {} : { headers: { cookie } }),
  });
}

describe('security', () => {
  it('seeds one of everything', async () => {
    sink = await startTitleSink();
    seeds = await seedAll(suite.client('e2e-sec-seed'), sink.baseUrl);
  });

  describe('admin operations', () => {
    const adminOps = () => suite.recorder.spec.operations.filter((op) => op.admin);

    it('the spec marks them, and the sweep sees every one', () => {
      const raw = JSON.parse(fs.readFileSync(fromRepoRoot('server/openapi.json'), 'utf8')) as {
        paths: Record<string, Record<string, { security?: unknown[] }>>;
      };
      const marked = Object.values(raw.paths)
        .flatMap((item) => Object.values(item))
        .filter((op) => (op.security ?? []).length > 0).length;
      expect(marked).toBeGreaterThan(0);
      expect(adminOps()).toHaveLength(marked);
      expect(adminOps().map((op) => op.operationId)).toContain('revokeSessions');
    });

    it('refuse a request with no session, a tampered cookie, or a cookie from before a revoke', async () => {
      const anonymous = suite.client('e2e-sec-anon');
      const before = await suite.client('e2e-sec-before').login(suite.server.pin);
      const stale = before.cookie as string;
      const tampered = stale.replace(
        /=(.)/,
        (_m, first: string) => `=${first === 'A' ? 'B' : 'A'}`,
      );
      expect(tampered).not.toBe(stale);
      // Revoked from another session: `stale` was valid a moment ago.
      const revoker = await suite.client('e2e-sec-revoker').login(suite.server.pin);
      expect((await revoker.post('/api/heimdall/revoke')).status).toBe(204);

      for (const [index, op] of adminOps().entries()) {
        const request = validRequest(op, index + 1);
        for (const [what, cookie] of [
          ['no cookie', undefined],
          ['a tampered cookie', tampered],
          ['a cookie from before /revoke', stale],
        ] as const) {
          const response = await send(anonymous, op, request, cookie);
          expect(
            response.status,
            `${op.operationId} with ${what}: ${response.text.slice(0, 200)}`,
          ).toBe(401);
          expect(response.json<{ error: string }>().error).toBe('UNAUTHORIZED');
        }
      }
    });

    it('accept a live session — revoke last, because it ends that session too', async () => {
      const admin = await suite.client('e2e-sec-admin').login(suite.server.pin);
      const ordered = [
        ...adminOps().filter((op) => op.operationId !== 'revokeSessions'),
        suite.recorder.spec.byId('revokeSessions'),
      ];
      for (const [index, op] of ordered.entries()) {
        const response = await send(admin, op, validRequest(op, 100 + index));
        expect(response.status, `${op.operationId}: ${response.text.slice(0, 200)}`).not.toBe(401);
        expect(response.status).toBeLessThan(500);
      }
      expect((await admin.get('/api/heimdall/session')).status).toBe(401);
    });
  });

  describe('path traversal', () => {
    const PAYLOADS = [
      '..%2f..%2fcanary.txt',
      '%2e%2e%2f%2e%2e%2fcanary.txt',
      '%252e%252e%252f%252e%252e%252fcanary.txt', // double-encoded
      '..%5c..%5ccanary.txt', // backslash
      '%2e%2e%5c%2e%2e%5ccanary.txt',
      '..', // the parent itself
      '%2e%2e',
      'canary.txt%00.txt', // NUL
      '%c0%ae%c0%ae%c0%af%c0%ae%c0%ae%c0%afcanary.txt', // overlong UTF-8
      '%ef%bc%8e%ef%bc%8e%2f%ef%bc%8e%ef%bc%8e%2fcanary.txt', // fullwidth dots
      '%e2%80%a5%2f%e2%80%a5%2fcanary.txt', // two-dot leader
    ];
    const targets = () =>
      suite.recorder.spec.operations.filter((op) =>
        /^\/api\/(files\/\{name\}|downloads\/\{id\})/.test(op.template),
      );

    it('every file, folder and download parameter refuses every payload with a 4xx', async () => {
      const admin = await suite.client('e2e-sec-traversal').login(suite.server.pin);
      const absolute = encodeURIComponent(suite.server.canary?.path ?? '/');
      expect(targets().length).toBeGreaterThan(0);
      for (const op of targets()) {
        for (const payload of [...PAYLOADS, absolute]) {
          const url = op.template.replace(/\{\w+\}/, payload);
          const body = op.operationId === 'renameUpload' ? { name: 'renamed.txt' } : undefined;
          const response = await admin.request(op.method, url, body ? { json: body } : {});
          expect(
            response.status,
            `${op.method} ${url} → ${response.status}`,
          ).toBeGreaterThanOrEqual(400);
          expect(response.status, `${op.method} ${url} → ${response.status}`).toBeLessThan(500);
        }
      }
    });

    it('a rename and an upload folder that point outside are refused, and nothing lands outside', async () => {
      const api = suite.client('e2e-sec-traversal');
      for (const name of ['../../canary.txt', '..\\..\\canary.txt', '/etc/passwd']) {
        const renamed = await api.patch(`/api/files/${encodeURIComponent(seeds.upload)}`, { name });
        expect(renamed.status, `rename to ${name}`).toBe(422);
      }
      for (const folder of ['..', '../..', '..\\..', '/tmp', '.hidden', 'a/b']) {
        const response = await api.upload(
          [{ name: 'escape.txt', content: 'escape' }],
          `?folder=${encodeURIComponent(folder)}`,
        );
        expect(response.status, `folder ${folder}`).toBeGreaterThanOrEqual(400);
        expect(response.status).toBeLessThan(500);
      }
      const jail = path.dirname(suite.server.storageRoot);
      expect(fs.readdirSync(jail).sort()).toEqual(['canary.txt', 'storage']);
      expect(fs.readFileSync(suite.server.canary?.path ?? '', 'utf8')).toBe(
        suite.server.canary?.contents,
      );
    });
  });

  describe('size limits mean what they say', () => {
    const KB = 1024;
    const expectRefused = (response: RecordedResponse, status: number, code: string) => {
      expect(response.status, response.text.slice(0, 200)).toBe(status);
      expect(response.json<{ error: string }>().error).toBe(code);
    };

    it('documents: the cap saves, one byte over is PAYLOAD_TOO_LARGE (all four kinds, default caps)', async () => {
      const api = suite.client('e2e-sec-size');
      const cap = 2048 * KB;
      for (const kind of ['runestone', 'edda', 'groot', 'atlas']) {
        const doc = (bytes: number) =>
          kind === 'runestone' ? `"${'a'.repeat(bytes - 2)}"` : 'a'.repeat(bytes);
        expect((await api.post(`/api/${kind}`, { content: doc(cap) })).status).toBe(201);
        expectRefused(
          await api.post(`/api/${kind}`, { content: doc(cap + 1) }),
          413,
          'PAYLOAD_TOO_LARGE',
        );
      }
    });

    it('clipboard: 64 KB saves, one byte more is PAYLOAD_TOO_LARGE', async () => {
      const api = suite.client('e2e-sec-size');
      expect((await api.post('/api/clipboard', { text: 'a'.repeat(64 * KB) })).status).toBe(201);
      expectRefused(
        await api.post('/api/clipboard', { text: 'a'.repeat(64 * KB + 1) }),
        413,
        'PAYLOAD_TOO_LARGE',
      );
    });

    it('client logs: a 64 KB body and a full batch are accepted; one byte or one entry more is not', async () => {
      const api = suite.client('e2e-sec-size');
      const limit = 64 * KB;
      // JSON allows whitespace before the closing brace, so padding there
      // makes a valid body of exactly `bytes` bytes.
      const sized = (bytes: number) => {
        const head = '{"entries":[{"level":"warn","msg":"size probe"}]';
        return `${head}${' '.repeat(bytes - head.length - 1)}}`;
      };
      const raw = (body: string) =>
        api.post('/api/client-logs', undefined, {
          body,
          headers: { 'content-type': 'application/json' },
        });
      expect((await raw(sized(limit))).status).toBe(202);
      expect((await raw(sized(limit + 1))).status).toBe(413);

      const batch = (count: number) => ({
        entries: Array.from({ length: count }, () => ({ level: 'warn', msg: 'b' })),
      });
      expect((await api.post('/api/client-logs', batch(50))).status).toBe(202);
      expectRefused(await api.post('/api/client-logs', batch(51)), 400, 'BAD_REQUEST');
    });

    it('brotli input and nimbus test size: the cap passes, one byte over is PAYLOAD_TOO_LARGE', async () => {
      const server = await startServer({
        env: { BROTLI_MAX_INPUT_MB: '1', NIMBUS_MAX_TEST_MB: '1' },
      });
      extra.push(server);
      const api = new Client(server.baseUrl, suite.recorder, 'e2e-sec-caps');
      const headers = { 'content-type': 'application/octet-stream' };
      const MiB = 1024 * 1024;
      expect(
        (await api.post('/api/brotli/compress', undefined, { body: Buffer.alloc(MiB, 7), headers }))
          .status,
      ).toBe(200);
      expectRefused(
        await api.post('/api/brotli/compress', undefined, {
          body: Buffer.alloc(MiB + 1, 7),
          headers,
        }),
        413,
        'PAYLOAD_TOO_LARGE',
      );
      expect(
        (await api.post('/api/nimbus/up', undefined, { body: Buffer.alloc(MiB, 7), headers }))
          .status,
      ).toBe(200);
      expectRefused(
        await api.post('/api/nimbus/up', undefined, { body: Buffer.alloc(MiB + 1, 7), headers }),
        413,
        'PAYLOAD_TOO_LARGE',
      );
    });
  });

  describe('rate limits and login lockout', () => {
    it('the fourth request in the window is a 429, for each per-IP limit set to 3', async () => {
      const server = await startServer({
        env: {
          UPLOAD_RATE_LIMIT_PER_MIN: '3',
          BROTLI_RATE_LIMIT_PER_MIN: '3',
          CLIENT_LOG_RATE_LIMIT_PER_MIN: '3',
        },
      });
      extra.push(server);
      const api = new Client(server.baseUrl, suite.recorder, 'e2e-sec-rate');
      const headers = { 'content-type': 'application/octet-stream' };
      const calls: [string, () => Promise<RecordedResponse>][] = [
        ['upload', () => api.upload([{ name: 'rate.txt', content: 'r' }])],
        [
          'compress',
          () => api.post('/api/brotli/compress', undefined, { body: Buffer.from('rate'), headers }),
        ],
        [
          'client logs',
          () => api.post('/api/client-logs', { entries: [{ level: 'warn', msg: 'rate' }] }),
        ],
      ];
      for (const [name, call] of calls) {
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          expect((await call()).status, `${name} #${attempt}`).toBeLessThan(400);
        }
        expect((await call()).status, `${name} #4`).toBe(429);
      }
    });

    it('repeated bad PINs lock the login out with Retry-After, and the right PIN is refused while locked', async () => {
      const server = await startServer();
      extra.push(server);
      const api = new Client(server.baseUrl, suite.recorder, 'e2e-sec-lockout');
      let locked: RecordedResponse | null = null;
      for (let attempt = 0; attempt < 12 && !locked; attempt += 1) {
        const response = await api.post('/api/heimdall/login', { pin: `wrong-${attempt}` });
        if (response.status === 429) locked = response;
        else expect(response.status).toBe(401);
      }
      expect(locked, 'never locked out').not.toBeNull();
      expect(locked?.json<{ error: string }>().error).toBe('RATE_LIMITED');
      expect(Number(locked?.headers.get('retry-after'))).toBeGreaterThan(0);
      expect((await api.post('/api/heimdall/login', { pin: server.pin })).status).toBe(429);
    }, 120_000);

    /** Bad PINs until the throttle answers 429; returns how many it took. */
    async function lockOut(api: Client, headers: Record<string, string>): Promise<number> {
      for (let attempt = 1; attempt <= 12; attempt += 1) {
        const response = await api.post(
          '/api/heimdall/login',
          { pin: `wrong-${attempt}` },
          { headers },
        );
        if (response.status === 429) return attempt;
        expect(response.status).toBe(401);
      }
      throw new Error('never locked out');
    }

    it('PLAN-36: behind the web host, the throttle counts each device by its own forwarded address', async () => {
      const server = await startServer();
      extra.push(server);
      // Straight to the API from loopback, which is the web host's position:
      // the only peer whose X-Forwarded-For the API trusts.
      const api = new Client(server.apiUrl, suite.recorder, 'e2e-sec-xff');
      await lockOut(api, { 'x-forwarded-for': '192.168.1.10' });
      const other = await api.post(
        '/api/heimdall/login',
        { pin: 'wrong-other' },
        { headers: { 'x-forwarded-for': '192.168.1.11' } },
      );
      expect(other.status, 'a second device is not locked out by the first').toBe(401);
      const back = await api.post(
        '/api/heimdall/login',
        { pin: server.pin },
        { headers: { 'x-forwarded-for': '192.168.1.10' } },
      );
      expect(back.status, 'the first device is still locked').toBe(429);
    }, 120_000);

    it('PLAN-36: a forged X-Forwarded-For through the web host changes nothing', async () => {
      const server = await startServer();
      extra.push(server);
      expect(server.hasWebHost).toBe(true);
      const api = new Client(server.baseUrl, suite.recorder, 'e2e-sec-forged');
      // A new forged address on every attempt: if the API believed any of
      // them, each would be a fresh device and the lockout would never come.
      let attempt = 0;
      for (; attempt < 12; attempt += 1) {
        const response = await api.post(
          '/api/heimdall/login',
          { pin: `wrong-${attempt}` },
          { headers: { 'x-forwarded-for': `10.9.8.${attempt}` } },
        );
        if (response.status === 429) break;
        expect(response.status).toBe(401);
      }
      expect(attempt, 'never locked out: a forged address was believed').toBeLessThan(12);
    }, 120_000);
  });

  describe('what a browser may do with a response', () => {
    it('CORS: only the four raw document endpoints allow any origin', async () => {
      const admin = await suite.client('e2e-sec-cors').login(suite.server.pin);
      for (const op of suite.recorder.spec.operations) {
        if (op.method !== 'GET' || op.operationId === 'streamEvents') continue;
        await (op.admin ? admin : suite.client('e2e-sec-cors')).get(readPath(op, seeds));
      }
      const wrong = suite.recorder.responses
        .filter((entry) => entry.operationId)
        .filter((entry) => {
          const raw = /Raw$/.test(entry.operationId as string);
          const open = entry.headers.get('access-control-allow-origin') === '*';
          return raw !== open && !(raw && entry.status >= 400);
        })
        .map((entry) => `${entry.method} ${entry.path} → ${entry.status}`);
      expect(wrong).toEqual([]);
    });

    it('an uploaded .html or .svg is served as text/plain, staged and published', async () => {
      const api = suite.client('e2e-sec-types');
      for (const name of ['payload.html', 'payload.svg']) {
        await api.upload([
          { name, content: '<svg onload="alert(1)"><script>alert(1)</script></svg>' },
        ]);
        const staged = await api.get(`/api/files/${name}/content?inline=1`);
        expect(staged.headers.get('content-type'), `staged ${name}`).toMatch(/^text\/plain/);
        expect((await api.post(`/api/files/${name}/publish`)).status).toBe(200);
        const download = await waitForDownload(api, (entry) => entry.name === name);
        const published = await api.get(`/api/downloads/${download.id}/content?inline=1`);
        expect(published.headers.get('content-type'), `published ${name}`).toMatch(/^text\/plain/);
      }
    });
  });

  it('closes the title sink', async () => {
    await sink.close();
  });
});

closingChecks(suite, () => extra);
