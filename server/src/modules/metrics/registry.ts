import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';
import type { Snapshot } from './sampler.js';

/**
 * The Prometheus exposition side of `metrics` (PLAN-16b Step 3).
 *
 * Prometheus is an **accelerator, not the record**. It scrapes, so anything it
 * missed while a container was down never existed as far as it is concerned —
 * which is why the snapshot log line remains the system of record and this
 * registry is fed from the very same sampler. One source of truth, two
 * exposition formats: if the two ever disagree, that is a bug, not a trade-off.
 *
 * `node_exporter` is deliberately absent from the stack: in Docker on macOS it
 * measures the Linux VM, not the Mac, producing numbers that look real and mean
 * nothing. Every process metric here comes from inside Node.
 */

/** Buckets in seconds: LAN request latency, from "instant" to "something is wrong". */
const LATENCY_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export interface MetricsRegistry {
  /** Text exposition for `GET /metrics`. */
  scrape(): Promise<string>;
  contentType: string;
  /** Record one finished request. */
  observeRequest(labels: { route: string; method: string; status: number }, seconds: number): void;
  /** Count one upload (a counter here; the log line carries deltas). */
  recordUpload(): void;
  /** Mirror a snapshot into the gauges. */
  publish(snapshot: Snapshot): void;
}

export function createMetricsRegistry(): MetricsRegistry {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry, prefix: 'bifrost_' });

  const requestDuration = new Histogram({
    name: 'bifrost_http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    // `route` is the Fastify route TEMPLATE (/api/downloads/:id/content), never
    // the concrete URL — one series per endpoint instead of one per file id,
    // which is how a label set quietly becomes a cardinality problem.
    labelNames: ['route', 'method', 'status'],
    buckets: LATENCY_BUCKETS,
    registers: [registry],
  });

  const gauge = (name: string, help: string): Gauge<string> =>
    new Gauge({ name, help, registers: [registry] });

  // Only what collectDefaultMetrics does NOT already provide, and named in base
  // units per the Prometheus convention (promtool lints for this). Duplicating
  // `process_resident_memory_bytes` or `nodejs_heap_size_used_bytes` from the
  // sampler would give two series for one number, and the first time they
  // disagreed nobody would know which to believe.
  const cpuPct = gauge(
    'bifrost_process_cpu_percent',
    'Process CPU percent over the last snapshot interval (the default metrics expose a counter, not a rate)',
  );
  const loopLagP50 = gauge(
    'bifrost_event_loop_lag_p50_seconds',
    'Event-loop delay p50, measured over one snapshot interval and then reset',
  );
  const loopLagP99 = gauge(
    'bifrost_event_loop_lag_p99_seconds',
    'Event-loop delay p99, measured over one snapshot interval and then reset',
  );
  const sseClients = gauge('bifrost_sse_clients', 'Currently connected SSE clients');
  const diskBytes = gauge(
    'bifrost_storage_disk_bytes',
    'Total bytes across the watched storage folders (sampled on the slow cycle)',
  );
  // A counter here, deltas in the log line: Prometheus handles counter resets
  // itself via rate(), while LogQL has no equivalent and would be corrupted by
  // the reset on every Bifrost restart.
  const uploads = new Counter({
    name: 'bifrost_uploads_total',
    help: 'Files accepted by the upload endpoint since this process started',
    registers: [registry],
  });

  return {
    contentType: registry.contentType,
    scrape: () => registry.metrics(),
    observeRequest: ({ route, method, status }, seconds) => {
      requestDuration.observe({ route, method, status: String(status) }, seconds);
    },
    recordUpload: () => uploads.inc(),
    publish: (snapshot) => {
      cpuPct.set(snapshot.cpuPct);
      // Milliseconds in the log line (what a human reads), seconds here (what
      // Prometheus expects) — same measurement, each in its audience's units.
      loopLagP50.set(snapshot.loopLagP50Ms / 1000);
      loopLagP99.set(snapshot.loopLagP99Ms / 1000);
      sseClients.set(snapshot.sseClients);
      // Left untouched before the first slow-cycle walk: a gauge reporting 0 for
      // "not measured yet" would read as an empty disk.
      if (snapshot.diskMb !== null) diskBytes.set(snapshot.diskMb * 1024 * 1024);
    },
  };
}
