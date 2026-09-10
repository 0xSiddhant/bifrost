import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { warn } from './output.js';

/**
 * The CLI's one piece of local state: `~/.config/bifrost/config.json`.
 *
 * The path is computed by hand rather than pulled from a dependency — it is a
 * handful of lines against `os.homedir()`, unlike argument parsing, which is
 * genuinely fiddly and does earn `commander`.
 *
 * Everything here degrades to defaults instead of throwing: a missing file is
 * the normal first run, and an unreadable or corrupt one must not stop `bifrost
 * push` from working.
 */

export interface UpdateCache {
  /** Epoch ms of the last real call to the GitHub API. */
  lastCheckedAt: number;
  /** `tag_name` with its leading `v` stripped. */
  latestVersion: string;
  /** Download URL of that release's `bifrost-cli-*.tgz`, or null if it had none. */
  assetUrl: string | null;
}

export interface CliConfig {
  /** Persisted `--host` default, already normalized. */
  host?: string;
  /** Stable id sent as `x-bifrost-device`, so clips and links are attributed. */
  deviceId?: string;
  update?: UpdateCache;
}

/**
 * XDG-style on macOS/Linux, `%APPDATA%`-rooted on Windows. `XDG_CONFIG_HOME` is
 * honoured where it is set — that is what "XDG-style" means, and it is also
 * what lets the tests point the whole thing at a temp directory.
 */
export function configDir(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string {
  if (process.platform === 'win32') {
    const appData = env.APPDATA;
    return path.join(
      appData && appData.length > 0 ? appData : path.join(home, 'AppData', 'Roaming'),
      'bifrost',
    );
  }
  const xdg = env.XDG_CONFIG_HOME;
  return path.join(xdg && xdg.length > 0 ? xdg : path.join(home, '.config'), 'bifrost');
}

export function configPath(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string {
  return path.join(configDir(env, home), 'config.json');
}

export function readConfig(): CliConfig {
  const file = configPath();
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    // No file yet is the normal first run — deliberately silent, and the only
    // other realistic cause (an unreadable $HOME) shows up on the next write.
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      warn(`ignoring ${file}: it is not a JSON object`);
      return {};
    }
    return parsed as CliConfig;
  } catch {
    warn(`ignoring ${file}: it is not valid JSON — delete it to start fresh`);
    return {};
  }
}

/** Merges `patch` into the stored config. A failed write warns and carries on. */
export function updateConfig(patch: Partial<CliConfig>): CliConfig {
  const merged: CliConfig = { ...readConfig(), ...patch };
  const file = configPath();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o600 });
  } catch (error) {
    // Not fatal: every command still works without a config file, so a
    // read-only home directory costs attribution and a persisted host, nothing
    // more. Saying so once is better than failing the command the user asked for.
    warn(`couldn't save ${file}: ${(error as Error).message}`);
  }
  return merged;
}

/**
 * This machine's id, minted once and persisted. Attribution only — the server
 * treats a missing header as null and refuses nothing over it — so a config
 * file that cannot be written falls back to a per-process id rather than
 * failing the command.
 */
export function deviceId(): string {
  const stored = readConfig().deviceId;
  if (typeof stored === 'string' && stored.length > 0 && stored.length <= 64) return stored;
  const minted = `cli-${crypto.randomUUID()}`;
  updateConfig({ deviceId: minted });
  return minted;
}
