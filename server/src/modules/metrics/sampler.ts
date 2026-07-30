/**
 * The metrics sampler (PLAN-16b) — everything that goes into one snapshot line,
 * with every source of truth injected so the whole thing is testable without a
 * real timer, a real process, or a real disk.
 *
 * Two shapes matter here and both are deliberate:
 *
 * 1. **Deltas, never cumulative counters.** `uploadsDelta: 3` (since the last
 *    snapshot), never `uploadsTotal: 4711`. Deltas sum trivially over any window
 *    in LogQL and are immune to the counter-reset problem — a cumulative counter
 *    drops to zero on every Bifrost restart and corrupts every rate calculation
 *    spanning that point. This sidesteps the bug class rather than working
 *    around it.
 * 2. **`diskMb` is not sampled here.** The disk walk is synchronous and
 *    recursive; running it every snapshot would block the event loop every
 *    snapshot, and the sampler would then faithfully record the lag spike it had
 *    just caused. It arrives from a slow cycle instead, and the last value is
 *    carried on intervening snapshots (`null` until the first one has run).
 */

export interface Snapshot {
  /** Process CPU % over the interval, from a `process.cpuUsage()` delta. */
  cpuPct: number;
  rssMb: number;
  heapUsedMb: number;
  /** `monitorEventLoopDelay()` percentiles, reset each interval. */
  loopLagP50Ms: number;
  loopLagP99Ms: number;
  /** Uploads since the previous snapshot. Always 0 under the cloud profile. */
  uploadsDelta: number;
  sseClients: number;
  /** Total bytes across the watched folders, from the slow cycle. */
  diskMb: number | null;
  uptimeSec: number;
}

/** Nanosecond percentiles from `perf_hooks.monitorEventLoopDelay()`. */
export interface LoopLagSource {
  percentile(p: number): number;
  reset(): void;
}

export interface SamplerDeps {
  /** `process.cpuUsage()` — microseconds of user + system CPU. */
  cpuUsage: () => { user: number; system: number };
  memoryUsage: () => { rss: number; heapUsed: number };
  loopLag: LoopLagSource;
  sseClients: () => number;
  uptimeSec: () => number;
  /** Monotonic-ish wall clock in ms; injected so tests own the interval. */
  now: () => number;
}

const MB = 1024 * 1024;

const round = (value: number, places = 2): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

export class MetricsSampler {
  private lastCpu: { user: number; system: number };
  private lastAt: number;
  private uploads = 0;
  private diskBytes: number | null = null;

  constructor(private readonly deps: SamplerDeps) {
    this.lastCpu = deps.cpuUsage();
    this.lastAt = deps.now();
  }

  /** Count one upload. Reset to zero by every snapshot — never cumulative. */
  recordUpload(): void {
    this.uploads += 1;
  }

  /** Hand in a fresh disk total from the slow cycle. */
  setDiskBytes(bytes: number): void {
    this.diskBytes = bytes;
  }

  sample(): Snapshot {
    const cpu = this.deps.cpuUsage();
    const at = this.deps.now();
    const elapsedMs = at - this.lastAt;
    // CPU time is microseconds; wall time is milliseconds. A process pinning one
    // core for the whole interval reads 100%, and one pinning two reads 200% —
    // the same convention `top` uses, so the number means what a reader expects.
    const cpuMicros = cpu.user - this.lastCpu.user + (cpu.system - this.lastCpu.system);
    const cpuPct = elapsedMs > 0 ? (cpuMicros / 1000 / elapsedMs) * 100 : 0;
    this.lastCpu = cpu;
    this.lastAt = at;

    const memory = this.deps.memoryUsage();
    const p50 = this.deps.loopLag.percentile(50);
    const p99 = this.deps.loopLag.percentile(99);
    // Reset per interval so each snapshot describes ITS window. Without this the
    // histogram accumulates for the process's whole life and one bad morning
    // hides behind a week of calm.
    this.deps.loopLag.reset();

    const uploadsDelta = this.uploads;
    this.uploads = 0;

    return {
      cpuPct: round(Math.max(0, cpuPct)),
      rssMb: round(memory.rss / MB),
      heapUsedMb: round(memory.heapUsed / MB),
      loopLagP50Ms: round(p50 / 1e6),
      loopLagP99Ms: round(p99 / 1e6),
      uploadsDelta,
      sseClients: this.deps.sseClients(),
      diskMb: this.diskBytes === null ? null : round(this.diskBytes / MB),
      uptimeSec: Math.floor(this.deps.uptimeSec()),
    };
  }
}
