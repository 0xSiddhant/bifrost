import dns from 'node:dns/promises';
import type { Command } from 'commander';
import { ApiClient, describeTransportFailure } from '../core/client.js';
import { configPath, deviceId, readConfig } from '../core/config.js';
import { resolveBaseUrl, unreachableMessage } from '../core/discover.js';
import { checkLatest, cliVersion, compareVersions } from '../core/selfUpdate.js';
import { attention, bad, dim, EXIT, heading, ok, print } from '../core/output.js';
import type { Capabilities } from './status.js';

/**
 * `status` assumes the connection already works and reports what the server says
 * about itself. `doctor` exists for the moment that assumption is false: it walks
 * the same chain every other command runs through implicitly, one layer at a
 * time, out loud — so the first broken link is named before the user trips over
 * it. Every failing line reuses the wording the failing command would itself
 * print; `doctor` invents no second vocabulary of errors.
 */

export type CheckStatus = 'pass' | 'fail' | 'warn';

export interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
}

const MARK: Record<CheckStatus, (text: string) => string> = { pass: ok, fail: bad, warn: attention };
const PROFILES = ['local', 'cloud'];

export function registerDoctor(program: Command): void {
  program
    .command('doctor')
    .description('check config, host resolution, the bridge, GitHub and this Node build')
    .action(async (_options: unknown, command: Command) => {
      const checks = await runDoctor(command.optsWithGlobals());
      print(checks, (rows) =>
        [
          heading('Doctor'),
          ...rows.map((row) => `${MARK[row.status](row.name)}\n  ${dim(row.detail)}`),
        ].join('\n'),
      );
      // The GitHub check is informational: a household Mac with no WAN should
      // not fail `doctor` over an update it does not need.
      if (checks.some((check) => check.status === 'fail')) process.exitCode = EXIT.failure;
    });
}

export async function runDoctor(options: { host?: string }): Promise<Check[]> {
  const checks: Check[] = [];

  // 1 — config.
  const stored = readConfig();
  checks.push({
    name: 'config file',
    status: 'pass',
    detail:
      stored.host === undefined
        ? `${configPath()} — no saved host, using the default`
        : `${configPath()} — saved host ${stored.host}`,
  });

  // 2 — does the host resolve at all? The layer that fails first on a machine
  // whose resolver is not mDNS-aware.
  const { baseUrl, source } = resolveBaseUrl(options.host, stored.host);
  const hostname = new URL(baseUrl).hostname;
  let resolved = false;
  try {
    const { address } = await dns.lookup(hostname);
    resolved = true;
    checks.push({ name: 'host resolves', status: 'pass', detail: `${hostname} → ${address} (${source})` });
  } catch (error) {
    checks.push({
      name: 'host resolves',
      status: 'fail',
      detail: unreachableMessage(baseUrl, describeTransportFailure(error)),
    });
  }

  // 3/4 — the bridge itself.
  const client = new ApiClient(baseUrl, deviceId());
  if (!resolved) {
    const skipped = 'skipped — the host did not resolve';
    checks.push({ name: 'server reachable', status: 'fail', detail: skipped });
    checks.push({ name: 'server profile', status: 'fail', detail: skipped });
  } else {
    try {
      const response = await client.probe('/api/health', { signal: AbortSignal.timeout(5_000) });
      await response.arrayBuffer();
      checks.push(
        response.ok
          ? { name: 'server reachable', status: 'pass', detail: `${baseUrl}/api/health answered 200` }
          : {
              name: 'server reachable',
              status: 'fail',
              detail: `${baseUrl}/api/health answered HTTP ${response.status}`,
            },
      );
    } catch (error) {
      // Already worded by `client.ts` (it raises `discover.ts`'s own
      // remediation text) — re-wrapping it would print the sentence twice.
      checks.push({ name: 'server reachable', status: 'fail', detail: (error as Error).message });
    }

    try {
      const capabilities = await client.json<Capabilities>(
        'reading server capabilities',
        'GET',
        '/api/capabilities',
      );
      checks.push(
        PROFILES.includes(capabilities.profile)
          ? {
              name: 'server profile',
              status: 'pass',
              detail: `${capabilities.profile} · ${capabilities.modules.length} modules loaded`,
            }
          : {
              name: 'server profile',
              status: 'fail',
              detail: `unknown profile "${capabilities.profile}"`,
            },
      );
    } catch (error) {
      checks.push({
        name: 'server profile',
        status: 'fail',
        detail: (error as Error).message,
      });
    }
  }

  // 5 — informational only, and throttled: it shares `update`'s 6-hour cache.
  const installed = cliVersion();
  try {
    const latest = await checkLatest();
    const comparison = compareVersions(installed, latest.version);
    checks.push({
      name: 'cli version',
      status: comparison.mismatch ? 'warn' : 'pass',
      detail: comparison.mismatch
        ? `installed v${installed}, latest published v${latest.version}` +
          `${latest.cached ? ' (cached)' : ''} — \`bifrost update\` installs the published one`
        : `v${installed} matches the latest published release${latest.cached ? ' (cached)' : ''}`,
    });
  } catch (error) {
    checks.push({
      name: 'cli version',
      status: 'warn',
      detail: `${(error as Error).message} — this never blocks LAN use`,
    });
  }

  // 6 — the runtime this CLI needs.
  const major = Number(process.versions.node.split('.')[0]);
  checks.push(
    Number.isFinite(major) && major >= 20 && typeof fetch === 'function'
      ? { name: 'node runtime', status: 'pass', detail: `node ${process.versions.node}, fetch present` }
      : {
          name: 'node runtime',
          status: 'fail',
          detail: `node ${process.versions.node} — the CLI needs Node 20+ with a built-in fetch`,
        },
  );

  return checks;
}
