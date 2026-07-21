import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { REPO_ROOT, SERVER_ROOT } from './paths.js';

/**
 * Build stamp for Heimdall's About section. Version/commit/build-date are
 * baked at build time into `server/build-info.json` (see
 * scripts/gen-build-info.mjs) because git is not available at runtime under
 * PM2/Docker. In dev (no baked file) we fall back to reading git directly and a
 * fresh timestamp, so the endpoint always answers.
 */
export interface BuildInfo {
  version: string;
  commit: string;
  buildDate: string;
}

let cached: BuildInfo | null = null;

export function getBuildInfo(): BuildInfo {
  if (!cached) cached = readBaked() ?? devFallback();
  return cached;
}

function readBaked(): BuildInfo | null {
  try {
    const raw = fs.readFileSync(path.join(SERVER_ROOT, 'build-info.json'), 'utf8');
    const parsed = JSON.parse(raw) as Partial<BuildInfo>;
    if (parsed.version && parsed.commit && parsed.buildDate) {
      return { version: parsed.version, commit: parsed.commit, buildDate: parsed.buildDate };
    }
  } catch {
    // no baked stamp — dev
  }
  return null;
}

function devFallback(): BuildInfo {
  let commit = 'dev';
  try {
    commit = execSync('git rev-parse --short HEAD', { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim() || 'dev';
  } catch {
    // git unavailable
  }
  return { version: readVersion(), commit, buildDate: new Date().toISOString() };
}

function readVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require(path.join(REPO_ROOT, 'package.json')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}
