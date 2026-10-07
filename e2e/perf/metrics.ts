/**
 * What the server says about itself while it is under load (PLAN-34): its own
 * `/metrics`, the Prometheus text prom-client serves with the `bifrost_`
 * prefix. The harness never measures the process from outside (no `ps`, no
 * `/proc`), so the numbers are the ones Grafana would show the owner.
 */

/** One sample line: a metric name, its labels, its value. */
export interface PromSample {
  name: string;
  labels: Record<string, string>;
  value: number;
}

/** The handful of figures a load report is about, read from one scrape. */
export interface MetricsSnapshot {
  /** Milliseconds since the run started. */
  atMs: number;
  rssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  eventLoopLagP99Seconds: number;
  eventLoopLagMeanSeconds: number;
  activeHandles: number;
  /** Linux only: prom-client omits it elsewhere. */
  openFds: number | null;
  /** Total seconds spent in GC since boot, all kinds. */
  gcSecondsTotal: number;
  sseClients: number | null;
}

const LINE = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{(.*)\})?\s+(\S+)(?:\s+\d+)?$/;
const LABEL = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g;

function parseValue(raw: string): number {
  if (raw === '+Inf') return Infinity;
  if (raw === '-Inf') return -Infinity;
  return Number(raw);
}

/** Every sample in a text exposition; comments and blank lines are skipped. */
export function parseExposition(text: string): PromSample[] {
  const samples: PromSample[] = [];
  for (const line of text.split('\n')) {
    if (line === '' || line.startsWith('#')) continue;
    const match = LINE.exec(line.trim());
    if (!match) continue;
    const labels: Record<string, string> = {};
    for (const [, key = '', raw = ''] of (match[2] ?? '').matchAll(LABEL)) {
      labels[key] = raw.replace(/\\(.)/g, (_, char: string) => (char === 'n' ? '\n' : char));
    }
    const [, name = '', , value = 'NaN'] = match;
    samples.push({ name, labels, value: parseValue(value) });
  }
  return samples;
}

function single(samples: PromSample[], name: string): number | null {
  const sample = samples.find((candidate) => candidate.name === name);
  return sample ? sample.value : null;
}

function required(samples: PromSample[], name: string): number {
  const value = single(samples, name);
  if (value === null) throw new Error(`/metrics has no ${name}`);
  return value;
}

export function snapshotOf(samples: PromSample[], atMs: number): MetricsSnapshot {
  const gc = samples
    .filter((sample) => sample.name === 'bifrost_nodejs_gc_duration_seconds_sum')
    .reduce((total, sample) => total + sample.value, 0);
  return {
    atMs,
    rssBytes: required(samples, 'bifrost_process_resident_memory_bytes'),
    heapUsedBytes: required(samples, 'bifrost_nodejs_heap_size_used_bytes'),
    heapTotalBytes: required(samples, 'bifrost_nodejs_heap_size_total_bytes'),
    eventLoopLagP99Seconds: required(samples, 'bifrost_nodejs_eventloop_lag_p99_seconds'),
    eventLoopLagMeanSeconds: required(samples, 'bifrost_nodejs_eventloop_lag_mean_seconds'),
    activeHandles: required(samples, 'bifrost_nodejs_active_handles_total'),
    openFds: single(samples, 'bifrost_process_open_fds'),
    gcSecondsTotal: gc,
    sseClients: single(samples, 'bifrost_sse_clients'),
  };
}

/** One route's request-duration histogram, cumulative as Prometheus serves it. */
export interface RouteHistogram {
  route: string;
  method: string;
  status: string;
  /** `[upper bound in seconds, cumulative count]`, ascending, ending at +Inf. */
  buckets: [number, number][];
  count: number;
  sumSeconds: number;
}

export function requestHistograms(samples: PromSample[]): RouteHistogram[] {
  const byKey = new Map<string, RouteHistogram>();
  const entry = (labels: Record<string, string>): RouteHistogram => {
    const key = `${labels.method} ${labels.route} ${labels.status}`;
    let histogram = byKey.get(key);
    if (!histogram) {
      histogram = {
        route: labels.route ?? '',
        method: labels.method ?? '',
        status: labels.status ?? '',
        buckets: [],
        count: 0,
        sumSeconds: 0,
      };
      byKey.set(key, histogram);
    }
    return histogram;
  };
  const base = 'bifrost_http_request_duration_seconds';
  for (const sample of samples) {
    if (sample.name === `${base}_bucket`) {
      entry(sample.labels).buckets.push([parseValue(sample.labels.le ?? '+Inf'), sample.value]);
    } else if (sample.name === `${base}_count`) {
      entry(sample.labels).count = sample.value;
    } else if (sample.name === `${base}_sum`) {
      entry(sample.labels).sumSeconds = sample.value;
    }
  }
  for (const histogram of byKey.values()) histogram.buckets.sort((a, b) => a[0] - b[0]);
  return [...byKey.values()];
}

/**
 * The bucket bound a quantile falls in (an upper estimate, as Prometheus's
 * `histogram_quantile` would interpolate within it). Null for an empty histogram.
 */
export function bucketQuantile(histogram: RouteHistogram, quantile: number): number | null {
  if (histogram.count === 0) return null;
  const rank = quantile * histogram.count;
  for (const [bound, cumulative] of histogram.buckets) {
    if (cumulative >= rank) return bound;
  }
  return Infinity;
}

export async function scrape(baseUrl: string, startedAt: number): Promise<MetricsSnapshot> {
  const response = await fetch(`${baseUrl}/metrics`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`/metrics → ${response.status}`);
  return snapshotOf(parseExposition(await response.text()), Date.now() - startedAt);
}

/**
 * Scrapes `/metrics` every `intervalMs` until stopped. A failed scrape is
 * counted, not thrown: a server too busy to answer its own metrics is a
 * finding for the report, and the run's own requests carry the verdict.
 */
export class MetricsSampler {
  readonly samples: MetricsSnapshot[] = [];
  failures = 0;
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly startedAt: number,
    private readonly intervalMs: number,
  ) {}

  start(): this {
    const tick = () => {
      if (this.inFlight) return;
      this.inFlight = scrape(this.baseUrl, this.startedAt)
        .then((snapshot) => {
          this.samples.push(snapshot);
        })
        .catch(() => {
          this.failures += 1;
        })
        .finally(() => {
          this.inFlight = null;
        });
    };
    tick();
    this.timer = setInterval(tick, this.intervalMs);
    return this;
  }

  async stop(): Promise<MetricsSnapshot[]> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.inFlight;
    return this.samples;
  }
}
