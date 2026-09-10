// Keeps the globally-installed `bifrost` pointed at whatever is checked out.
//
// Deliberately the same mechanism a real install uses — `npm pack` then
// `npm install -g <tarball>` — rather than `npm link`. A symlink would never
// exercise cli/package.json's `files` list or its `man` wiring, so a packaging
// bug would only surface the day someone installs a GitHub Release asset.
//
// Wired into the root `build` and `start` scripts (PLAN-27). PM2 execs
// server/dist/bootstrap.js directly, so restarting the always-on service never
// runs this. Under CI the pack step still runs (so cli/dist is built and
// release.yml can pack it) but the global install is skipped: a disposable
// runner has no reason to carry a `bifrost` on PATH.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(args: string[], options: { cwd?: string } = {}): string {
  return execFileSync(npm, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

run(['run', 'build', '-w', 'cli']);

if (process.env.CI) {
  process.stdout.write('cli-sync: CI detected — built cli/, skipping the global install\n');
  process.exit(0);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-cli-pack-'));
try {
  // --pack-destination keeps the tarball out of the working tree entirely, so a
  // dev iteration never leaves an untracked .tgz behind.
  const packed = run(['pack', '-w', 'cli', '--pack-destination', tmpDir, '--json']);
  const entries = JSON.parse(packed) as { filename: string }[];
  const filename = entries[0]?.filename;
  if (!filename) throw new Error('npm pack produced no tarball');
  const tarball = path.join(tmpDir, filename);

  run(['install', '-g', tarball]);
  process.stdout.write(`cli-sync: installed ${filename} globally — \`bifrost\` is up to date\n`);
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
