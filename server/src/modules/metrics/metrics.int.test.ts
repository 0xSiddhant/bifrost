import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import pino from 'pino';
import { loadConfig } from '../../core/config/index.js';
import { LEVEL_FORMATTER } from '../../core/logger/index.js';
import { createApp, type RunningApp } from '../../app.js';

interface Line {
  logLevel: string;
  msg: string;
  module?: string;
  [key: string]: unknown;
}

function capture(level: pino.Level = 'trace') {
  const lines: Line[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      for (const raw of chunk.toString().split('\n')) {
        if (raw.trim()) lines.push(JSON.parse(raw) as Line);
      }
      callback();
    },
  });
  return { lines, logger: pino({ level, formatters: LEVEL_FORMATTER }, destination) };
}

const snapshots = (lines: Line[]): Line[] =>
  lines.filter((line) => line.module === 'metrics' && line.msg === 'snapshot');

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('metrics snapshots', () => {
  let app: RunningApp | null = null;
  let storageRoot: string | null = null;

  async function boot(env: Record<string, string>, level: pino.Level = 'trace') {
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-metrics-'));
    const captured = capture(level);
    app = await createApp(
      loadConfig({ HEIMDALL_PIN: '4321', STORAGE_ROOT: storageRoot, ...env }),
      { logger: captured.logger },
    );
    return captured;
  }

  afterEach(async () => {
    await app?.shutdown('test over');
    app = null;
    if (storageRoot) fs.rmSync(storageRoot, { recursive: true, force: true });
    storageRoot = null;
  });

  it('writes one snapshot per interval with every contracted field', async () => {
    const { lines } = await boot({ METRICS_SNAPSHOT_INTERVAL_SEC: '1' });
    await wait(2300);

    const found = snapshots(lines);
    expect(found.length).toBeGreaterThanOrEqual(2);
    const [first] = found;
    expect(first).toMatchObject({ logLevel: 'trace', source: 'server', module: 'metrics' });
    for (const field of [
      'cpuPct',
      'rssMb',
      'heapUsedMb',
      'loopLagP50Ms',
      'loopLagP99Ms',
      'uploadsDelta',
      'sseClients',
      'uptimeSec',
    ]) {
      expect(typeof first?.[field], field).toBe('number');
    }
    // Plausible, not just present — a zeroed snapshot would satisfy "populated".
    expect(first?.rssMb as number).toBeGreaterThan(10);
    expect(first?.uptimeSec as number).toBeGreaterThanOrEqual(0);
  });

  it('samples diskMb on the slow cycle, so it is a number from the first snapshot', async () => {
    const { lines } = await boot({ METRICS_SNAPSHOT_INTERVAL_SEC: '1', METRICS_DISK_INTERVAL_SEC: '3600' });
    await wait(1300);
    // The first walk runs at boot, not on the first snapshot — that is what
    // keeps the sync walk off the snapshot interval.
    expect(typeof snapshots(lines)[0]?.diskMb).toBe('number');
  });

  // Criterion 1a. The whole "survives with zero Docker dependency" premise dies
  // if the escape hatch for log noise silently switches the record off.
  it('keeps writing snapshots when LOG_LEVEL is raised to error', async () => {
    const { lines } = await boot({ METRICS_SNAPSHOT_INTERVAL_SEC: '1', LOG_LEVEL: 'error' }, 'error');
    await wait(2300);

    expect(snapshots(lines).length).toBeGreaterThanOrEqual(2);
    // …while ordinary info lines from the same boot really are suppressed,
    // proving the level was raised rather than ignored.
    expect(lines.some((line) => line.msg === 'module loaded')).toBe(false);
  });

  it('writes nothing when METRICS_ENABLED=false, and registers no timer', async () => {
    const { lines } = await boot({ METRICS_ENABLED: 'false', METRICS_SNAPSHOT_INTERVAL_SEC: '1' });
    await wait(2300);

    expect(snapshots(lines)).toHaveLength(0);
    expect(lines.some((line) => String(line.msg).includes('metrics snapshots disabled'))).toBe(true);
  });

  // Counted off the event bus, so a real upload is the only honest test of the
  // wiring — and the delta must fall back to 0 next interval rather than stick.
  it('counts a real upload once, in the interval it happened', async () => {
    const { lines } = await boot({ METRICS_SNAPSHOT_INTERVAL_SEC: '1' });
    const boundary = 'BifrostMetricsBoundary';
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="counted.txt"\r\n` +
          `Content-Type: application/octet-stream\r\n\r\n`,
      ),
      Buffer.from('measured'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const upload = await app!.fastify.inject({
      method: 'POST',
      url: '/api/files',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(upload.statusCode).toBe(201);

    await wait(2300);
    const counts = snapshots(lines).map((line) => line.uploadsDelta as number);
    expect(counts.reduce((sum, n) => sum + n, 0)).toBe(1);
    expect(counts.at(-1)).toBe(0);
  });

  it('stops sampling once the app is closed', async () => {
    const { lines } = await boot({ METRICS_SNAPSHOT_INTERVAL_SEC: '1' });
    await wait(1300);
    await app?.shutdown('closing for the test');
    app = null;
    const afterShutdown = snapshots(lines).length;

    await wait(1500);
    expect(snapshots(lines)).toHaveLength(afterShutdown);
  });
});

describe('prometheus exposition', () => {
  let app: RunningApp;
  let storageRoot: string;

  beforeAll(async () => {
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-prom-'));
    app = await createApp(
      loadConfig({ HEIMDALL_PIN: '4321', STORAGE_ROOT: storageRoot, METRICS_SNAPSHOT_INTERVAL_SEC: '1' }),
      { logger: capture().logger },
    );
  });

  afterAll(async () => {
    await app.shutdown('test over');
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });

  // Unauthenticated by necessity: Prometheus carries no session, so a guard
  // here would not secure anything, it would just stop the scrape.
  it('serves parseable text exposition without a session', async () => {
    const res = await app.fastify.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');

    const body = res.body;
    // Every line is either a comment or `name{labels} value` — the shape a
    // scraper requires. A stray JSON body would 200 just as happily.
    for (const line of body.split('\n').filter(Boolean)) {
      expect(line.startsWith('#') || /^[a-zA-Z_:][a-zA-Z0-9_:]*(\{.*\})? \S+/.test(line), line).toBe(true);
    }
    expect(body).toContain('bifrost_process_cpu_percent');
    // Base units, per the Prometheus convention promtool lints for — the log
    // line keeps milliseconds, which is what a human reads.
    expect(body).toContain('bifrost_event_loop_lag_p99_seconds');
    // collectDefaultMetrics, prefixed so nothing collides with a co-scraped app.
    expect(body).toContain('bifrost_process_resident_memory_bytes');
    // …and NOT duplicated from the sampler: two series for one number is how
    // two sources of truth start disagreeing.
    expect(body).not.toContain('bifrost_process_rss_mb');
  });

  it('records the request histogram against the route template, not the url', async () => {
    await app.fastify.inject({ method: 'GET', url: '/api/health' });
    const body = (await app.fastify.inject({ method: 'GET', url: '/metrics' })).body;
    expect(body).toMatch(/bifrost_http_request_duration_seconds_bucket\{[^}]*route="\/api\/health"/);
    expect(body).toMatch(/bifrost_http_request_duration_seconds_count\{[^}]*method="GET"[^}]*\} [1-9]/);
  });

  // A hook registered inside the module's own plugin scope would only ever see
  // the module's own routes, which is the whole reason it goes through
  // fastify-plugin. This is what proves that actually worked.
  it('observes requests to OTHER modules’ routes too', async () => {
    await app.fastify.inject({ method: 'GET', url: '/api/capabilities' });
    await app.fastify.inject({ method: 'GET', url: '/api/themes' });
    const body = (await app.fastify.inject({ method: 'GET', url: '/metrics' })).body;
    expect(body).toContain('route="/api/themes"');
  });

  it('buckets unmatched requests under one label instead of minting series', async () => {
    await app.fastify.inject({ method: 'GET', url: '/api/definitely-not-a-route' });
    const body = (await app.fastify.inject({ method: 'GET', url: '/metrics' })).body;
    expect(body).toContain('route="unmatched"');
    expect(body).not.toContain('definitely-not-a-route');
  });

  it('publishes the sampler’s numbers into the gauges', async () => {
    await wait(1300);
    const body = (await app.fastify.inject({ method: 'GET', url: '/metrics' })).body;
    const lag = /^bifrost_event_loop_lag_p99_seconds (\d+(\.\d+)?(e-?\d+)?)$/m.exec(body);
    expect(lag).not.toBeNull();
    expect(Number(lag?.[1])).toBeGreaterThanOrEqual(0);

    const cpu = /^bifrost_process_cpu_percent (\d+(\.\d+)?)$/m.exec(body);
    expect(cpu).not.toBeNull();
  });
});
