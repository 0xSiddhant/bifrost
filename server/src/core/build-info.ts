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
    // Deliberately silent (PLAN-16a audit): no baked stamp is the NORMAL state
    // in dev — the file is written by the prebuild step and gitignored — so a
    // line here would fire on every dev boot and mean nothing. devFallback()
    // below covers it, and About still answers.
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
    // Deliberately silent (PLAN-16a audit): git is legitimately absent under
    // PM2/Docker, which is exactly why the stamp is baked at build time. The
    // 'dev' placeholder is the designed answer, not a degraded one.
  }
  return { version: readVersion(), commit, buildDate: new Date().toISOString() };
}

function readVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require(path.join(REPO_ROOT, 'package.json')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    // Deliberately silent (PLAN-16a audit): a cosmetic version string on one
    // admin panel is not worth a log line, and this path only runs when the
    // baked stamp is already missing — which the caller above has covered.
    return '0.0.0';
  }
}
