import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { readConfig, updateConfig } from './config.js';
import { CliError } from './output.js';

/**
 * "Is there a newer build to sync to?" — asked of **GitHub Releases**, not npm,
 * because that is where this CLI is actually distributed (a `.tgz` asset, no
 * registry publish). `update-notifier` and friends are registry-specific and do
 * not apply; what is left is a JSON GET and a string comparison, which is not
 * fiddly enough to justify a dependency.
 *
 * Two rules that matter:
 *
 * - **Only `update` and `doctor` ever call this.** `push`/`pull`/`clip`/… never
 *   touch the GitHub API, so no command grows an unexpected internet dependency
 *   and there is no passive notice to suppress under `--json`.
 * - **Throttled to six hours, shared between both callers.** GitHub's
 *   unauthenticated limit is 60 requests/hour; one cache means neither command
 *   can be scripted into hammering it. The cost is stated rather than hidden: a
 *   release published minutes ago may be invisible for up to six hours.
 */

export const REPO = '0xSiddhant/bifrost';
export const LATEST_RELEASE_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
export const THROTTLE_MS = 6 * 60 * 60 * 1000;

/**
 * The running CLI's own version. `package.json` ships beside `dist/` inside the
 * tarball, and `src/core/` sits at the same depth as `dist/core/`, so one
 * relative path serves both a real install and a run from source.
 */
export function cliVersion(): string {
  const parsed = JSON.parse(
    fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as { version?: unknown };
  return typeof parsed.version === 'string' ? parsed.version : '0.0.0';
}

export interface LatestRelease {
  /** `tag_name` with its leading `v` stripped. */
  version: string;
  /** Download URL of that release's `bifrost-cli-*.tgz`, or null if it carried none. */
  assetUrl: string | null;
  /** True when the throttle window answered without a network call. */
  cached: boolean;
  checkedAt: number;
}

interface ReleasePayload {
  tag_name?: unknown;
  assets?: unknown;
}

export interface CheckOptions {
  now?: number;
  fetchImpl?: typeof fetch;
}

export async function checkLatest(options: CheckOptions = {}): Promise<LatestRelease> {
  const now = options.now ?? Date.now();
  const cached = readConfig().update;
  if (cached !== undefined && now - cached.lastCheckedAt < THROTTLE_MS) {
    return {
      version: cached.latestVersion,
      assetUrl: cached.assetUrl,
      cached: true,
      checkedAt: cached.lastCheckedAt,
    };
  }

  const call = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await call(LATEST_RELEASE_URL, {
      headers: {
        accept: 'application/vnd.github+json',
        // GitHub refuses an API request with no user agent.
        'user-agent': 'bifrost-cli',
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new CliError(`couldn't reach GitHub: ${(error as Error).message}`);
  }
  if (!response.ok) {
    throw new CliError(`couldn't read the latest release from GitHub (HTTP ${response.status})`);
  }

  const payload = (await response.json()) as ReleasePayload;
  const tag = typeof payload.tag_name === 'string' ? payload.tag_name : '';
  if (tag.length === 0) {
    throw new CliError("GitHub's latest release has no tag name");
  }
  const version = tag.replace(/^v/, '');
  const assetUrl = findCliAsset(payload.assets);

  updateConfig({ update: { lastCheckedAt: now, latestVersion: version, assetUrl } });
  return { version, assetUrl, cached: false, checkedAt: now };
}

/** The release asset the install command points at, or null when none was published. */
export function findCliAsset(assets: unknown): string | null {
  if (!Array.isArray(assets)) return null;
  for (const asset of assets) {
    if (asset === null || typeof asset !== 'object') continue;
    const { name, browser_download_url: url } = asset as {
      name?: unknown;
      browser_download_url?: unknown;
    };
    if (typeof name === 'string' && /^bifrost-cli-.+\.tgz$/.test(name) && typeof url === 'string') {
      return url;
    }
  }
  return null;
}

export interface VersionComparison {
  installed: string;
  latest: string;
  /**
   * Plain string inequality, not a semver ordering: `performUpdate` only needs
   * "is there anything to do" and `doctor` only needs "do these agree". It is
   * reported as a mismatch rather than "a newer version is available", because
   * a mismatch alone does not say which way it runs — the owner's own dev Mac
   * re-syncs its global `bifrost` from `develop` on every build, so a local
   * install is routinely *ahead* of the last published tag.
   */
  mismatch: boolean;
}

export function compareVersions(installed: string, latest: string): VersionComparison {
  return { installed, latest, mismatch: installed !== latest };
}

export interface UpdateOutcome {
  installed: string;
  latest: string;
  updated: boolean;
  message: string;
}

export async function performUpdate(options: CheckOptions = {}): Promise<UpdateOutcome> {
  const installed = cliVersion();
  const latest = await checkLatest(options);
  if (!compareVersions(installed, latest.version).mismatch) {
    return {
      installed,
      latest: latest.version,
      updated: false,
      message: `already on the latest published version (v${installed})`,
    };
  }
  if (latest.assetUrl === null) {
    throw new CliError(
      `release v${latest.version} carries no bifrost-cli-*.tgz asset — nothing to install`,
    );
  }

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, ['install', '-g', latest.assetUrl], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // npm's own words, on stderr so `--json` stdout stays parseable. An install
  // can fail for reasons (permissions, proxy, network) that are npm's to
  // explain, and reinterpreting them here would only lose detail.
  if (result.stdout) process.stderr.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error !== undefined) {
    throw new CliError(`couldn't run npm: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new CliError(`npm install -g failed (exit ${result.status ?? 'unknown'})`);
  }

  return {
    installed,
    latest: latest.version,
    updated: true,
    message: `installed v${latest.version} (was v${installed})`,
  };
}
