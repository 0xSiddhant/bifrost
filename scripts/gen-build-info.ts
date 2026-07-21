// Bakes the build stamp Heimdall's About section reads at runtime. Run in the
// server's prebuild step — git is not available at runtime under PM2/Docker, so
// the commit + build date must be captured now. Writes server/build-info.json.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(cmd: string, fallback: string): string {
  try {
    return execSync(cmd, { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || fallback;
  } catch {
    return fallback;
  }
}

const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as { version?: string };
const info = {
  version: pkg.version ?? '0.0.0',
  commit: read('git rev-parse --short HEAD', 'unknown'),
  buildDate: new Date().toISOString(),
};

fs.writeFileSync(path.join(repoRoot, 'server', 'build-info.json'), `${JSON.stringify(info, null, 2)}\n`);
process.stdout.write(`build-info: ${info.version} ${info.commit} ${info.buildDate}\n`);
