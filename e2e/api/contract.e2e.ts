import { describe, expect, it } from 'vitest';
import { startTitleSink, type TitleSink } from '../support/sink.js';
import type { Client } from './support/http.js';
import { DOCUMENT_CONTENT, DOCUMENT_KINDS, readPath, seedAll, type Seeds } from './support/seed.js';
import { openEventStream } from './support/sse.js';
import { apiSuite, closingChecks } from './support/suite.js';

/**
 * The consumer-side contract (PLAN-33): a happy-path journey per tag calls
 * every operation, and every response is checked against the committed
 * `server/openapi.json` — the file a client would read — not the schemas in
 * the running code (PLAN-32's guard checks those; this is the second witness).
 *
 * The file ends by requiring that every operation produced a success here.
 * The run-wide report (coverage-report.ts) then joins this with the fuzzer.
 */

const suite = apiSuite('contract');
let sink: TitleSink;
let seeds: Seeds;
let api: Client;
let admin: Client;

const status = async (response: Promise<{ status: number; text: string }>, expected: number) => {
  const { status: got, text } = await response;
  expect(got, text.slice(0, 300)).toBe(expected);
};

describe('contract journeys', () => {
  it('seeds one of everything and opens an admin session', async () => {
    sink = await startTitleSink();
    api = suite.client('e2e-contract');
    seeds = await seedAll(api, sink.baseUrl);
    admin = await suite.client('e2e-contract-admin').login(suite.server.pin);
  });

  it('every read operation succeeds on seeded data', async () => {
    for (const op of suite.recorder.spec.operations) {
      if (op.method !== 'GET' || op.operationId === 'streamEvents') continue;
      const response = await (op.admin ? admin : api).get(readPath(op, seeds));
      expect(
        suite.recorder.spec.isSuccess(op, response.status),
        `${op.operationId} → ${response.status}`,
      ).toBe(true);
    }
  });

  it('core: the event stream opens', async () => {
    const stream = await openEventStream(suite.server.baseUrl, 'e2e-contract-stream');
    try {
      await stream.waitFor(/^: connected/m);
      // A stream never ends, so the client cannot record it; this records
      // what the socket said — a 200 with the declared media type.
      suite.recorder.record({
        method: 'GET',
        path: '/api/v1/events',
        status: 200,
        operationId: null,
        text: '',
        headers: new Headers({ 'content-type': 'text/event-stream' }),
      });
      // Presence now knows this device, so a name can be claimed for it.
      await status(
        api.patch('/api/v1/presence/name', { deviceId: 'e2e-contract-stream', name: 'Contract' }),
        200,
      );
      await status(api.post('/api/v1/presence/prune'), 200);
    } finally {
      stream.close();
    }
  });

  it('documents: create, update, delete each kind', async () => {
    for (const kind of DOCUMENT_KINDS) {
      const created = await api.post(`/api/v1/${kind}`, { content: DOCUMENT_CONTENT[kind] });
      expect(created.status).toBe(201);
      const { id } = created.json<{ id: string }>();
      await status(api.put(`/api/v1/${kind}/${id}`, { name: `Contract ${kind}` }), 200);
      await status(api.delete(`/api/v1/${kind}/${id}`), 204);
    }
  });

  it('file-transfer: upload, rename, publish, delete', async () => {
    await status(api.upload([{ name: 'contract-a.txt', content: 'a\n' }]), 201);
    await status(api.patch('/api/v1/files/contract-a.txt', { name: 'contract-b.txt' }), 200);
    await status(api.post('/api/v1/files/contract-b.txt/publish'), 200);
    await status(api.upload([{ name: 'contract-c.txt', content: 'c\n' }]), 201);
    await status(api.delete('/api/v1/files/contract-c.txt'), 204);
  });

  it('clipboard, accio and portkey: add, change, delete', async () => {
    const clip = await api.post('/api/v1/clipboard', {
      text: 'contract clip',
      kind: 'code',
      lang: 'ts',
    });
    expect(clip.status).toBe(201);
    await status(api.delete(`/api/v1/clipboard/${clip.json<{ id: string }>().id}`), 204);

    const link = await api.post('/api/v1/accio', {
      url: `${sink.baseUrl}/page/contract`,
      title: 'Contract',
    });
    expect(link.status).toBe(201);
    const linkId = link.json<{ id: string }>().id;
    await status(api.patch(`/api/v1/accio/${linkId}`, { tags: ['contract'] }), 200);
    await status(api.delete(`/api/v1/accio/${linkId}`), 204);

    await status(
      api.post('/api/v1/portkey', { slug: 'contract', url: 'http://127.0.0.1:9/x' }),
      201,
    );
    await status(api.patch('/api/v1/portkey/contract', { note: 'from the contract suite' }), 200);
    await status(api.delete('/api/v1/portkey/contract'), 204);
  });

  it('brotli and nimbus: every tool call', async () => {
    const headers = { 'content-type': 'application/octet-stream' };
    const packed = await api.post('/api/v1/brotli/compress', undefined, {
      body: Buffer.from('contract '.repeat(100)),
      headers,
    });
    expect(packed.status).toBe(200);
    await status(
      api.post('/api/v1/brotli/decompress', undefined, { body: packed.bytes, headers }),
      200,
    );

    await status(api.get('/api/v1/nimbus/down?mb=0.05'), 200);
    await status(
      api.post('/api/v1/nimbus/up', undefined, { body: Buffer.alloc(64 * 1024, 1), headers }),
      200,
    );
    await status(api.post('/api/v1/nimbus/release'), 204);
    await status(
      api.post('/api/v1/nimbus/results', {
        downMbps: 940.5,
        upMbps: 870.25,
        latencyMs: 1.5,
        testMb: 10,
      }),
      201,
    );
  });

  it('client-logs: a batch is accepted', async () => {
    await status(
      api.post('/api/v1/client-logs', {
        entries: [
          { level: 'warn', msg: 'contract journey', module: 'e2e', route: '/', ts: Date.now() },
        ],
      }),
      202,
    );
  });

  it('admin: settings and the module policies', async () => {
    const settings = (await admin.get('/api/v1/heimdall/settings')).json<{ tapCount: number }>();
    await status(admin.patch('/api/v1/heimdall/settings', { tapCount: settings.tapCount }), 200);
    await status(admin.patch('/api/v1/loki/settings', { runTimeoutMs: 5000 }), 200);
    await status(admin.patch('/api/v1/screensaver/settings', { idleSeconds: 300 }), 200);
    await status(
      admin.patch('/api/v1/offline-mode/settings', { id: 'toolbox', enabled: false }),
      200,
    );
    await status(
      admin.patch('/api/v1/offline-mode/settings', { id: 'toolbox', enabled: true }),
      200,
    );
  });

  it('heimdall: logout ends one session, revoke ends all — last, because it ends this one too', async () => {
    const other = await suite.client('e2e-contract-other').login(suite.server.pin);
    await status(other.post('/api/v1/heimdall/logout'), 204);
    await status(admin.post('/api/v1/heimdall/revoke'), 204);
    await status(admin.get('/api/v1/heimdall/session'), 401);
  });

  it('every operation in openapi.json produced a success in this file', () => {
    const never = suite.recorder.spec.operations
      .filter((op) => !suite.recorder.covered.has(op.operationId))
      .map((op) => op.operationId);
    expect(never).toEqual([]);
  });

  it('closes the title sink', async () => {
    await sink.close();
  });
});

closingChecks(suite);
