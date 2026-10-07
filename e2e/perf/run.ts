import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Api } from '../support/api.js';
import { REPO_ROOT } from '../support/paths.js';
import { startServer } from '../support/server.js';
import { MetricsSampler } from './metrics.js';
import {
  buildRootOf,
  parseArgs,
  serverOverrides,
  type Profile,
  type RunOptions,
} from './options.js';
import { fanout } from './profiles/fanout.js';
import { load } from './profiles/load.js';
import { soak } from './profiles/soak.js';
import { spike } from './profiles/spike.js';
import { stress } from './profiles/stress.js';
import type { ProfileDefinition } from './profiles/types.js';
import {
  compareToBaseline,
  formatComparison,
  formatMetrics,
  formatScenarios,
  readResult,
  writeResult,
  type Machine,
  type RunResult,
} from './report.js';
import { seed } from './seed.js';

/**
 * `npm run test:load` (PLAN-34): an on-demand measurement of the **built**
 * server, never a CI gate. It starts the production entry on scratch storage
 * and an OS-assigned port, seeds it through the API, runs one profile, reads
 * the server's own `/metrics` while it does, then prints a table and writes
 * `load-results/<profile>-<timestamp>.json`.
 *
 * It exits non-zero only for correctness: any 5xx, connection error, timeout
 * or unexpected status, or a soak leak. A regression against `--baseline` is
 * flagged in the report and fails the run only with `--strict`.
 */

const PROFILES: Record<Profile, ProfileDefinition> = { load, stress, spike, soak, fanout };
export const RESULTS_DIR = path.join(REPO_ROOT, 'load-results');

function git(cwd: string, ...args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

function machine(): Machine {
  const dirty = git(REPO_ROOT, 'status', '--porcelain') ? ' (with uncommitted changes)' : '';
  return {
    commit: `${git(REPO_ROOT, 'rev-parse', '--short', 'HEAD')}${dirty}`,
    node: process.version,
    os: `${os.platform()} ${os.release()} ${os.arch()}`,
    cpuModel: os.cpus()[0]?.model.trim() ?? 'unknown',
    cores: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
  };
}

const log = (line: string) => process.stdout.write(`${line}\n`);

export async function run(options: RunOptions): Promise<number> {
  const buildRoot = options.serverDist ? buildRootOf(options.serverDist) : REPO_ROOT;
  const env = serverOverrides(options);
  log(`▸ load harness: profile ${options.profile}`);
  log(`  build ${buildRoot} (${git(buildRoot, 'rev-parse', '--short', 'HEAD')})`);
  log(
    `  contract ${options.contract}, log level ${options.logLevel ?? 'trace (production default)'}`,
  );

  // startServer refuses a missing dist with "run `npm run build` first".
  const server = await startServer({ buildRoot, env, keepStorage: options.keep });
  const startedAt = Date.now();
  const definition = PROFILES[options.profile];
  const sampler = new MetricsSampler(server.baseUrl, startedAt, definition.sampleIntervalMs);
  const result: RunResult = {
    schema: 1,
    profile: options.profile,
    startedAt: new Date(startedAt).toISOString(),
    machine: machine(),
    settings: {
      connections: options.connections,
      durationSeconds: options.durationSeconds,
      minutes: options.profile === 'soak' ? options.minutes : null,
      warmupMinutes: options.profile === 'soak' ? options.warmupMinutes : null,
      contract: options.contract,
      logLevel: options.logLevel ?? 'trace (default)',
      serverBuild: buildRoot,
      serverCommit: git(buildRoot, 'rev-parse', '--short', 'HEAD'),
      sseListeners: options.profile === 'fanout' ? options.sseListeners : null,
      uploads:
        options.profile === 'fanout' ? `${options.uploadCount} × ${options.uploadMb} MB` : null,
    },
    serverEnv: env,
    seeding: null,
    scenarios: [],
    metrics: [],
    summary: {},
    failures: [],
  };

  try {
    const api = new Api(server.baseUrl, 'load-harness');
    log('▸ seeding through the API');
    const seeds = await seed(api);
    result.seeding = {
      seconds: seeds.seconds,
      requests: seeds.requests,
      requestsPerSecond: seeds.requests / seeds.seconds,
    };
    log(
      `  ${seeds.requests} requests in ${seeds.seconds.toFixed(1)} s (${result.seeding.requestsPerSecond.toFixed(0)}/s)`,
    );

    log(`▸ ${options.profile}`);
    sampler.start();
    const outcome = await definition.run({
      baseUrl: server.baseUrl,
      api,
      seeds,
      options,
      startedAt,
      sampler,
      storageRoot: server.storageRoot,
      log,
    });
    result.metrics = await sampler.stop();
    result.scenarios = outcome.scenarios;
    result.summary = { ...outcome.summary, metricsScrapeFailures: sampler.failures };
    result.failures = outcome.failures;
    if (server.exitStatus())
      result.failures.push(
        `the server exited during the run: ${JSON.stringify(server.exitStatus())}`,
      );
  } catch (error) {
    result.failures.push(`the run itself failed: ${(error as Error).message}`);
    await sampler.stop();
  } finally {
    await server.stop();
    if (options.keep) log(`  kept storage: ${server.storageRoot}`);
  }

  log('');
  log(formatScenarios(result.scenarios));
  log('');
  log(formatMetrics(result.metrics));
  const shown = Object.fromEntries(
    Object.entries(result.summary).filter(([key]) => key !== 'overTime'),
  );
  log(`summary: ${JSON.stringify(shown, null, 2)}`);

  let flagged = 0;
  if (options.baseline) {
    const rows = compareToBaseline(result, readResult(options.baseline));
    flagged = rows.filter((row) => row.flagged).length;
    log('');
    log(`against ${options.baseline}:`);
    log(formatComparison(rows));
    result.summary.baselineFlagged = flagged;
  }

  const file = writeResult(result, RESULTS_DIR);
  log('');
  log(`result: ${path.relative(REPO_ROOT, file)}`);
  if (result.failures.length > 0) {
    log(`✗ ${result.failures.length} correctness failure(s):`);
    for (const failure of result.failures) log(`  - ${failure}`);
    return 1;
  }
  if (flagged > 0 && options.strict) {
    log(`✗ ${flagged} regression(s) past 10% against the baseline (--strict)`);
    return 1;
  }
  log(
    flagged > 0
      ? `✓ correct; ${flagged} regression(s) flagged (pass --strict to fail on them)`
      : '✓ correct',
  );
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let options: RunOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exit(2);
  }
  run(options).then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(`${(error as Error).stack ?? String(error)}\n`);
      process.exit(1);
    },
  );
}
