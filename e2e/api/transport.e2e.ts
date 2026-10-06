import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fromRepoRoot } from '../support/paths.js';
import { startServer } from '../support/server.js';
import { startTitleSink, type TitleSink } from '../support/sink.js';
import { readPath, seedAll, type Seeds } from './support/seed.js';
import { openEventStream } from './support/sse.js';
import { serverRss, streamUpload } from './support/stream-upload.js';
import { apiSuite, closingChecks } from './support/suite.js';
import { readZip } from './support/zip.js';

/**
 * Transport (PLAN-33): what `fastify.inject` structurally cannot see — real
 * sockets, the event stream, streamed bodies at size, ranges, archives,
 * shutdown with a body in flight, and the HTTP plumbing around the API.
 */

const suite = apiSuite('transport');
let sink: TitleSink;
let seeds: Seeds;

describe('transport', () => {
  it('seeds one of everything through the API', async () => {
    sink = await startTitleSink();
    seeds = await seedAll(suite.client(), sink.baseUrl);
  });

  describe('the event stream over a real socket', () => {
    it('says connected, delivers a save to every open stream, and drops a closed one from presence', async () => {
      const a = await openEventStream(suite.server.baseUrl, 'e2e-sse-a');
      const b = await openEventStream(suite.server.baseUrl, 'e2e-sse-b');
      try {
        await a.waitFor(/^: connected/m);
        await b.waitFor(/^: connected/m);

        const saved = await suite
          .client()
          .post('/api/runestone', { name: 'Streamed', content: '{}' });
        expect(saved.status).toBe(201);
        const frame = /event: runestone\.saved\ndata: .*"name":"Streamed"/;
        await a.waitFor(frame);
        await b.waitFor(frame);

        const online = async () =>
          (await suite.client().get('/api/presence'))
            .json<{ devices: { deviceId: string; online: boolean }[] }>()
            .devices.filter((device) => device.online)
            .map((device) => device.deviceId);
        expect(await online()).toEqual(expect.arrayContaining(['e2e-sse-a', 'e2e-sse-b']));

        a.close();
        await expect.poll(online, { timeout: 10_000 }).not.toContain('e2e-sse-a');
        expect(await online()).toContain('e2e-sse-b');
      } finally {
        a.close();
        b.close();
      }
    });
  });

  describe('streamed bodies', () => {
    it('a 300 MB upload completes while the server stays flat in memory', async () => {
      const total = 300 * 1024 * 1024;
      const baseline = await serverRss(suite.server.baseUrl);
      let peak = baseline;
      let sampling = true;
      const sampler = (async () => {
        while (sampling) {
          peak = Math.max(peak, await serverRss(suite.server.baseUrl));
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      })();
      const result = await streamUpload({
        baseUrl: suite.server.baseUrl,
        fileName: 'big-stream.bin',
        totalBytes: total,
      });
      sampling = false;
      await sampler;

      expect(result.status).toBe(201);
      expect(JSON.parse(result.body)).toMatchObject({
        accepted: [{ name: 'big-stream.bin', size: total }],
        rejected: [],
      });
      // The promise in architecture.md: uploads stream to disk, so memory does
      // not grow with the body. 128 MiB of headroom against a 300 MiB body.
      expect(peak - baseline).toBeLessThan(128 * 1024 * 1024);
      expect((await suite.client().delete('/api/files/big-stream.bin')).status).toBe(204);
    });

    it('a Range download answers 206 with Content-Range, and an unsatisfiable one 416', async () => {
      const url = `/api/downloads/${seeds.downloadFile}/content`;
      const partial = await suite.client().get(url, { headers: { range: 'bytes=2-5' } });
      expect(partial.status).toBe(206);
      expect(partial.headers.get('content-range')).toBe('bytes 2-5/21');
      expect(partial.bytes.toString()).toBe('2345');

      const beyond = await suite.client().get(url, { headers: { range: 'bytes=100-' } });
      expect(beyond.status).toBe(416);
      expect(beyond.headers.get('content-range')).toBe('bytes */21');
    });

    it('a folder archive streams a whole zip with no content-length', async () => {
      const archive = await suite.client().get(`/api/downloads/${seeds.downloadFolder}/archive`);
      expect(archive.status).toBe(200);
      expect(archive.headers.get('content-type')).toBe('application/zip');
      expect(archive.headers.get('content-length')).toBeNull();
      const entries = readZip(archive.bytes);
      expect(entries.map((entry) => [entry.name, entry.data.toString()])).toEqual([
        ['one.txt', 'one\n'],
        ['two.txt', 'two\n'],
      ]);
    });

    it('a Brotli round trip returns the input bytes', async () => {
      const input = Buffer.concat([
        Buffer.from('the bridge holds '.repeat(4096)),
        Buffer.from(Array.from({ length: 4096 }, (_, index) => (index * 131) % 256)),
      ]);
      const headers = { 'content-type': 'application/octet-stream' };
      const compressed = await suite
        .client()
        .post('/api/brotli/compress?quality=balanced', undefined, {
          body: input,
          headers,
        });
      expect(compressed.status).toBe(200);
      expect(compressed.bytes.length).toBeLessThan(input.length);
      const restored = await suite.client().post('/api/brotli/decompress', undefined, {
        body: compressed.bytes,
        headers,
      });
      expect(restored.status).toBe(200);
      expect(restored.bytes.equals(input)).toBe(true);
    });
  });

  describe('shutdown with an upload in flight', () => {
    it('SIGTERM still exits promptly, and the next boot sweeps tmp/', async () => {
      const server = await startServer({ keepStorage: true });
      const tmp = path.join(server.storageRoot, 'tmp');
      const leftovers = () => fs.readdirSync(tmp).filter((name) => name !== '.gitkeep');
      try {
        let release: () => void = () => {};
        const paused = new Promise<void>((resolve) => {
          release = resolve;
        });
        const upload = streamUpload({
          baseUrl: server.baseUrl,
          fileName: 'interrupted.bin',
          totalBytes: 512 * 1024 * 1024,
          // Send 16 MiB, then stall: the body is half-way through tmp/.
          onChunk: (sent) => (sent >= 16 * 1024 * 1024 ? paused : undefined),
        }).catch((error: unknown) => error);

        await expect.poll(leftovers, { timeout: 10_000 }).not.toEqual([]);
        const started = Date.now();
        await server.halt();
        expect(Date.now() - started).toBeLessThan(10_000);
        expect(server.exitStatus()).toEqual({ code: 0, signal: null });
        release();
        await upload;
        expect(leftovers()).not.toEqual([]);

        const again = await startServer({
          storageRoot: server.storageRoot,
          themesDir: server.themesDir,
        });
        try {
          expect(leftovers()).toEqual([]);
        } finally {
          await again.stop();
        }
      } finally {
        fs.rmSync(server.storageRoot, { recursive: true, force: true });
        fs.rmSync(server.themesDir, { recursive: true, force: true });
      }
    });
  });

  describe('HTTP plumbing', () => {
    it('an unknown /api path is a JSON 404, and a client route is the SPA', async () => {
      const api = await suite.client().get('/api/nope', { contract: false });
      expect(api.status).toBe(404);
      expect(api.json()).toEqual({ error: 'NOT_FOUND', message: 'route not found' });

      const page = await suite.client().get('/some/client/route');
      expect(page.status).toBe(200);
      expect(page.headers.get('content-type')).toMatch(/^text\/html/);
      expect(page.text).toBe(fs.readFileSync(fromRepoRoot('client/dist/index.html'), 'utf8'));
    });

    it('serves a built asset with its content type', async () => {
      const index = fs.readFileSync(fromRepoRoot('client/dist/index.html'), 'utf8');
      const script = /<script[^>]+src="(\/assets\/[^"]+\.js)"/.exec(index)?.[1];
      const style = /<link[^>]+href="(\/assets\/[^"]+\.css)"/.exec(index)?.[1];
      expect(script).toBeDefined();
      expect(style).toBeDefined();
      const js = await suite.client().get(script as string);
      expect(js.status).toBe(200);
      expect(js.headers.get('content-type')).toMatch(/^(application|text)\/javascript/);
      const css = await suite.client().get(style as string);
      expect(css.headers.get('content-type')).toMatch(/^text\/css/);
    });

    it('every GET operation answers HEAD with the same status and no body', async () => {
      const gets = suite.recorder.spec.operations.filter(
        (op) =>
          op.method === 'GET' &&
          // An endless stream: HEAD on it holds a connection open like GET does.
          op.operationId !== 'streamEvents',
      );
      expect(gets.length).toBeGreaterThan(40);
      const admin = await suite.client('e2e-api-head').login(suite.server.pin);
      for (const op of gets) {
        const url = readPath(op, seeds);
        const client = op.admin ? admin : suite.client('e2e-api-head');
        const get = await client.get(url);
        const head = await client.request('HEAD', url);
        expect(head.status, `HEAD ${url}`).toBe(get.status);
        expect(head.bytes.length, `HEAD ${url} has a body`).toBe(0);
      }
    });

    it('reuses one keep-alive connection across requests', async () => {
      const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
      const sockets = new Set<unknown>();
      try {
        for (let index = 0; index < 5; index += 1) {
          await new Promise<void>((resolve, reject) => {
            const request = http.get(
              `${suite.server.baseUrl}/api/health`,
              { agent },
              (response) => {
                response.resume();
                response.on('end', () => resolve());
              },
            );
            request.on('socket', (socket) => sockets.add(socket));
            request.on('error', reject);
          });
        }
        expect(sockets.size).toBe(1);
      } finally {
        agent.destroy();
      }
    });
  });

  it('closes the title sink', async () => {
    await sink.close();
  });
});

closingChecks(suite);
