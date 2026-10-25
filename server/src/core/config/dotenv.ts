import fs from 'node:fs';
import dotenv from 'dotenv';
import { fromRepoRoot } from '../paths.js';

/**
 * Keys that say how a run is shaped, not what it runs with: which processes
 * (BIFROST_RUN), who answers for bifrost.local (MDNS_ADVERTISER), and whether
 * traces are sent (OTEL_ENABLED). The launcher decides them — `./bifrost start`
 * and `service`, `npm start`, PM2, launchd, or a compose file's `environment:`
 * — and they are never read from .env, where a value left behind silently
 * reshaped every later launch (owner's call, 2026-10-09). `.env` keeps
 * secrets, paths, limits and addresses.
 */
export const LAUNCHER_KEYS = ['BIFROST_RUN', 'MDNS_ADVERTISER', 'OTEL_ENABLED'] as const;

/**
 * Load the repo-root .env regardless of cwd — workspace scripts run with
 * cwd=server/, so a bare `import 'dotenv/config'` would miss it. As with
 * dotenv, a variable already in the environment wins. Returns the launcher
 * keys .env still sets, which were ignored, so the caller can say so.
 */
export function loadDotenv(file = fromRepoRoot('.env')): string[] {
  let parsed: Record<string, string>;
  try {
    parsed = dotenv.parse(fs.readFileSync(file));
  } catch {
    // No .env is a valid state (a container passes its settings as real
    // environment variables); config validation names any required key that
    // is then missing, so there is nothing to add here.
    return [];
  }
  const ignored: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if ((LAUNCHER_KEYS as readonly string[]).includes(key)) {
      ignored.push(key);
    } else if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
  return ignored;
}

/** The warning for keys loadDotenv ignored, or undefined when there were none. */
export function ignoredKeysWarning(ignored: string[]): string | undefined {
  if (ignored.length === 0) return undefined;
  return (
    `${ignored.join(', ')} in .env ${ignored.length === 1 ? 'is' : 'are'} ignored: the launcher decides how a run ` +
    'is shaped (./bifrost start|service --web …, --standalone, --otel). Delete the line from .env'
  );
}
