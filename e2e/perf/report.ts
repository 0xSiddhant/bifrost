import fs from 'node:fs';
import path from 'node:path';
import type { MetricsSnapshot, RssSample } from './metrics.js';

/**
 * A load run's result (PLAN-34): what was measured, on what, with what
 * settings. Written to `load-results/` (gitignored) and readable back as a
 * `--baseline`. Results are never committed: they describe one machine on
 * one day.
 */

export interface LatencyMs {
  mean: number;
  p50: number;
  p90: number;
  p99: number;
  max: number;
}

export interface ScenarioResult {
  /** Unique within a run, and the key a baseline is matched on. */
  name: string;
  connections: number;
  durationSeconds: number;
  requests: number;
  requestsPerSecond: number;
  latencyMs: LatencyMs;
  bytesPerSecond: number;
  /** Count per HTTP status, as strings (`"200"`, `"302"`). */
  statusCounts: Record<string, number>;
  /** Connection errors (refused, reset) — never acceptable. */
  errors: number;
  timeouts: number;
  /** Responses whose status the scenario does not expect (a 404 means the scenario is broken). */
  unexpected: number;
  /** Profile-specific figures (a stress step, a fan-out measurement). */
  extra?: Record<string, number | string | boolean | null>;
}

export interface Machine {
  commit: string;
  node: string;
  os: string;
  cpuModel: string;
  cores: number;
  totalMemoryBytes: number;
}

export interface RunResult {
  schema: 1;
  profile: string;
  startedAt: string;
  machine: Machine;
  settings: Record<string, string | number | boolean | null>;
  /** Every env value the harness set on top of production defaults. */
  serverEnv: Record<string, string>;
  seeding: { seconds: number; requests: number; requestsPerSecond: number } | null;
  scenarios: ScenarioResult[];
  metrics: MetricsSnapshot[];
  /**
   * PLAN-36: the web host's RSS over the run, sampled with `ps`. Absent in
   * results from before PLAN-36 and in `--direct` runs, which have no web host.
   */
  webHostRss?: RssSample[];
  /** Profile-level verdicts and figures (the stress knee, spike recovery, soak slopes). */
  summary: Record<string, unknown>;
  /** Correctness failures: any of these makes the run exit non-zero. */
  failures: string[];
}

export function serverErrors(scenario: ScenarioResult): number {
  return Object.entries(scenario.statusCounts)
    .filter(([status]) => status.startsWith('5'))
    .reduce((total, [, count]) => total + count, 0);
}

/**
 * Requests that did not get a good, expected answer, each counted once. No
 * step expects a 5xx, so 5xx responses are already among the unexpected;
 * `max` keeps them counted even if a step ever did.
 */
export function badCount(scenario: ScenarioResult): number {
  return (
    scenario.errors + scenario.timeouts + Math.max(scenario.unexpected, serverErrors(scenario))
  );
}

/** Why a scenario failed on correctness, one line per reason; empty when it did not. */
export function correctnessFailures(scenario: ScenarioResult): string[] {
  const failures: string[] = [];
  const fives = serverErrors(scenario);
  if (fives > 0) failures.push(`${scenario.name}: ${fives} 5xx responses`);
  if (scenario.errors > 0) failures.push(`${scenario.name}: ${scenario.errors} connection errors`);
  if (scenario.timeouts > 0) failures.push(`${scenario.name}: ${scenario.timeouts} timeouts`);
  if (scenario.unexpected > 0) {
    const statuses = Object.entries(scenario.statusCounts)
      .map(([status, count]) => `${status}×${count}`)
      .join(' ');
    failures.push(`${scenario.name}: ${scenario.unexpected} unexpected statuses (${statuses})`);
  }
  return failures;
}

// ── soak: the leak slope ────────────────────────────────────────────────────

export interface Slope {
  /** Least-squares growth, in MB per minute (MB = 2^20 bytes). */
  mbPerMinute: number;
  /** Samples the line was fitted to (those after the warm-up). */
  samples: number;
}

/** Least squares of `y` on `x`; null with fewer than three points or no spread in `x`. */
export function linearSlope(points: [number, number][]): number | null {
  if (points.length < 3) return null;
  const n = points.length;
  const meanX = points.reduce((sum, [x]) => sum + x, 0) / n;
  const meanY = points.reduce((sum, [, y]) => sum + y, 0) / n;
  let covariance = 0;
  let variance = 0;
  for (const [x, y] of points) {
    covariance += (x - meanX) * (y - meanY);
    variance += (x - meanX) ** 2;
  }
  return variance === 0 ? null : covariance / variance;
}

/**
 * How fast a memory figure grows after the warm-up. The warm-up is skipped
 * because a fresh process fills caches, JIT-compiles and grows its heap to a
 * working size: that rise is not a leak, and fitting through it would flag one.
 */
export function leakSlope(
  samples: MetricsSnapshot[],
  field: 'rssBytes' | 'heapUsedBytes',
  warmupMinutes: number,
): Slope | null {
  const points = samples
    .map((sample): [number, number] => [sample.atMs / 60_000, sample[field] / 2 ** 20])
    .filter(([minutes]) => minutes >= warmupMinutes);
  const slope = linearSlope(points);
  return slope === null ? null : { mbPerMinute: slope, samples: points.length };
}

// ── baseline comparison ─────────────────────────────────────────────────────

export interface ComparisonRow {
  scenario: string;
  metric: 'req/s' | 'p50' | 'p99';
  baseline: number;
  current: number;
  /** Signed change in percent; positive means the number went up. */
  deltaPct: number;
  /** Worse than the baseline by more than the threshold. */
  flagged: boolean;
}

/**
 * Throughput is better higher, latency better lower; a row is flagged when it
 * moved the wrong way by more than `thresholdPct`. Scenarios missing from
 * either side are skipped rather than guessed at.
 */
export function compareToBaseline(
  current: RunResult,
  baseline: RunResult,
  thresholdPct = 10,
): ComparisonRow[] {
  const rows: ComparisonRow[] = [];
  const before = new Map(baseline.scenarios.map((scenario) => [scenario.name, scenario]));
  for (const scenario of current.scenarios) {
    const old = before.get(scenario.name);
    if (!old) continue;
    const metrics: [ComparisonRow['metric'], number, number, 'higher' | 'lower'][] = [
      ['req/s', old.requestsPerSecond, scenario.requestsPerSecond, 'higher'],
      ['p50', old.latencyMs.p50, scenario.latencyMs.p50, 'lower'],
      ['p99', old.latencyMs.p99, scenario.latencyMs.p99, 'lower'],
    ];
    for (const [metric, was, now, better] of metrics) {
      if (was === 0) continue;
      const deltaPct = ((now - was) / was) * 100;
      const worse = better === 'higher' ? -deltaPct : deltaPct;
      rows.push({
        scenario: scenario.name,
        metric,
        baseline: was,
        current: now,
        deltaPct,
        flagged: worse > thresholdPct,
      });
    }
  }
  return rows;
}

// ── output ──────────────────────────────────────────────────────────────────

function pad(text: string, width: number, right = false): string {
  return right ? text.padStart(width) : text.padEnd(width);
}

function table(header: string[], rows: string[][]): string {
  const widths = header.map((cell, column) =>
    Math.max(cell.length, ...rows.map((row) => (row[column] ?? '').length)),
  );
  const line = (cells: string[]) =>
    cells.map((cell, column) => pad(cell, widths[column] ?? 0, column > 0)).join('  ');
  return [
    line(header),
    widths.map((width) => '─'.repeat(width)).join('  '),
    ...rows.map(line),
  ].join('\n');
}

const fixed = (value: number, digits = 1) => value.toFixed(digits);
const mb = (bytes: number) => `${(bytes / 2 ** 20).toFixed(1)} MB`;

export function formatScenarios(scenarios: ScenarioResult[]): string {
  return table(
    ['scenario', 'conns', 'req/s', 'p50 ms', 'p90 ms', 'p99 ms', 'max ms', 'MB/s', 'bad'],
    scenarios.map((scenario) => [
      scenario.name,
      String(scenario.connections),
      fixed(scenario.requestsPerSecond, 0),
      fixed(scenario.latencyMs.p50),
      fixed(scenario.latencyMs.p90),
      fixed(scenario.latencyMs.p99),
      fixed(scenario.latencyMs.max),
      fixed(scenario.bytesPerSecond / 2 ** 20, 2),
      String(badCount(scenario)),
    ]),
  );
}

export function formatComparison(rows: ComparisonRow[]): string {
  if (rows.length === 0) return 'baseline: no scenario in common';
  return table(
    ['scenario', 'metric', 'baseline', 'now', '±%', ''],
    rows.map((row) => [
      row.scenario,
      row.metric,
      fixed(row.baseline),
      fixed(row.current),
      `${row.deltaPct >= 0 ? '+' : ''}${fixed(row.deltaPct)}`,
      row.flagged ? '⚠ worse' : '',
    ]),
  );
}

export function formatMetrics(samples: MetricsSnapshot[]): string {
  const first = samples[0];
  const last = samples.at(-1);
  if (!first || !last) return 'server metrics: none sampled';
  const peak = (field: 'rssBytes' | 'heapUsedBytes') =>
    samples.reduce((max, sample) => Math.max(max, sample[field]), 0);
  const lag = samples.reduce((max, sample) => Math.max(max, sample.eventLoopLagP99Seconds), 0);
  return [
    `server metrics (${samples.length} samples):`,
    `  rss ${mb(first.rssBytes)} → ${mb(last.rssBytes)} (peak ${mb(peak('rssBytes'))})`,
    `  heap used ${mb(first.heapUsedBytes)} → ${mb(last.heapUsedBytes)} (peak ${mb(peak('heapUsedBytes'))})`,
    `  event-loop lag p99 peak ${fixed(lag * 1000)} ms; handles ${first.activeHandles} → ${last.activeHandles}`,
  ].join('\n');
}

export function formatWebHostRss(samples: RssSample[] | undefined): string {
  const first = samples?.[0];
  const last = samples?.at(-1);
  if (!samples || !first || !last)
    return 'web host: none in front (direct, or a build before PLAN-36)';
  const peak = samples.reduce((max, sample) => Math.max(max, sample.rssBytes), 0);
  return `web host rss (${samples.length} samples): ${mb(first.rssBytes)} → ${mb(last.rssBytes)} (peak ${mb(peak)})`;
}

/** `load-results/<profile>-<ISO timestamp>.json`, colons made filename-safe. */
export function resultFileName(result: RunResult): string {
  return `${result.profile}-${result.startedAt.replace(/:/g, '-')}.json`;
}

export function writeResult(result: RunResult, directory: string): string {
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, resultFileName(result));
  fs.writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
  return file;
}

export function readResult(file: string): RunResult {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as RunResult;
  if (parsed.schema !== 1 || !Array.isArray(parsed.scenarios)) {
    throw new Error(`${file} is not a load result`);
  }
  return parsed;
}
