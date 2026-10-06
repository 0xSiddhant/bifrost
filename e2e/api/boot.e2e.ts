import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { startServer } from '../support/server.js';
import { Client } from './support/http.js';
import { apiSuite, closingChecks } from './support/suite.js';

/**
 * Boot (PLAN-33): the production entry — `node --import otel.js
 * bootstrap.js`, exactly what `npm start`, PM2 and launchd run — comes up,
 * answers, stops cleanly on SIGTERM and comes back on the same storage.
 * Nothing before this suite ever ran that entry: `test:resilience` spawns
 * `dist/app.js`, and every in-process test uses `createApp`.
 */

const suite = apiSuite('boot', {
  env: {
    // On, aimed at a port nothing listens on: the SDK starts and says so, and
    // its export failures stay rate-limited stderr, never a failed boot.
    OTEL_ENABLED: 'true',
    OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:9',
    OTEL_EXPORT_TIMEOUT_MS: '200',
  },
});

/** A shutdown that takes longer than this is a hang, not a drain. */
const SHUTDOWN_BUDGET_MS = 10_000;

describe('boot', () => {
  it('the production entry starts with OpenTelemetry loaded by --import', () => {
    // The line otel.ts prints only when the SDK really started before the app.
    expect(suite.server.output()).toMatch(/otel: sdk started, endpoint=http:\/\/127\.0\.0\.1:9/);
  });

  it('answers health and capabilities', async () => {
    const api = suite.client();
    const health = await api.get('/api/health');
    expect(health.status).toBe(200);
    expect(health.json()).toMatchObject({ ok: true, profile: 'local' });
    const capabilities = await api.get('/api/capabilities');
    expect(capabilities.json<{ modules: string[] }>().modules).toEqual(
      expect.arrayContaining(['health', 'file-transfer', 'runestone', 'heimdall']),
    );
  });

  it('exits 0 on SIGTERM within the shutdown budget, and comes back clean on the same storage', async () => {
    const first = await startServer({ keepStorage: true });
    try {
      const api = new Client(first.baseUrl, suite.recorder, 'e2e-api-boot-restart');
      const saved = await api.post('/api/runestone', {
        name: 'Survives a restart',
        content: '{"a":1}',
      });
      expect(saved.status).toBe(201);

      const started = Date.now();
      await first.halt();
      expect(Date.now() - started).toBeLessThan(SHUTDOWN_BUDGET_MS);
      expect(first.exitStatus()).toEqual({ code: 0, signal: null });

      const second = await startServer({
        storageRoot: first.storageRoot,
        themesDir: first.themesDir,
      });
      try {
        const again = new Client(second.baseUrl, suite.recorder, 'e2e-api-boot-restart');
        expect((await again.get('/api/health')).status).toBe(200);
        const list = await again.get('/api/runestone');
        expect(list.json<{ name: string }[]>().map((doc) => doc.name)).toContain(
          'Survives a restart',
        );
      } finally {
        await second.halt();
        expect(second.exitStatus()?.code).toBe(0);
      }
    } finally {
      fs.rmSync(first.storageRoot, { recursive: true, force: true });
      fs.rmSync(first.themesDir, { recursive: true, force: true });
    }
  });
});

closingChecks(suite);
