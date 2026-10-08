import fs from 'node:fs';
import { fromRepoRoot } from './paths.js';

/**
 * Every key the server's `.env` can carry, read from `.env.example` (and from a
 * developer's own `.env`, when one exists) as **text**.
 *
 * The server calls `dotenv.config()` on the repo-root `.env` at boot, and dotenv
 * never overrides a key that is already set. So an e2e server spawned on a
 * developer's machine would otherwise inherit that machine's real `.env`: its
 * rate limits, its session secret, its log level, its editor caps. Setting every
 * known key to the empty string pins it, and `loadConfig` reads an empty value
 * as unset, so the server falls back to the built-in production default — the
 * same values CI sees, wherever the suite runs.
 */
export function envKeysFrom(text: string): string[] {
  const keys = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/.exec(line);
    if (match?.[1]) keys.add(match[1]);
  }
  return [...keys];
}

function readIfPresent(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    // No `.env` is the normal state in CI and in a fresh clone: there is
    // nothing of the developer's to blank out, so an empty list is correct.
    return '';
  }
}

export function knownEnvKeys(): string[] {
  return [
    ...new Set([
      ...envKeysFrom(readIfPresent(fromRepoRoot('.env.example'))),
      ...envKeysFrom(readIfPresent(fromRepoRoot('.env'))),
    ]),
  ];
}

/**
 * The environment an e2e server runs with: the parent's process env (PATH,
 * HOME, …), every Bifrost key blanked back to its default, then `overrides`.
 */
export function serverEnv(
  overrides: Record<string, string>,
  base: NodeJS.ProcessEnv = process.env,
  keys: string[] = knownEnvKeys(),
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined) env[key] = value;
  }
  for (const key of keys) env[key] = '';
  return { ...env, ...overrides };
}
