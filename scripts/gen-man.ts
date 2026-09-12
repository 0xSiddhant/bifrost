// Compiles the hand-written cli/man/bifrost.1.md into real roff at
// cli/man/bifrost.1. Run from the CLI's prebuild step, the same shape
// gen-build-info.ts already uses: a generated file nobody hand-writes, kept out
// of git, produced before the workspace's own build.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(repoRoot, 'cli', 'man', 'bifrost.1.md');
const target = path.join(repoRoot, 'cli', 'man', 'bifrost.1');

const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'cli', 'package.json'), 'utf8')) as {
  version?: string;
};

// Resolved rather than assumed on PATH: npm hoists workspace bins to the repo
// root, and this script is also run directly (tsx scripts/gen-man.ts). The bin
// is reached via package.json because marked-man's `exports` map publishes only
// `.` and `./package.json` — resolving the bin path itself is not exported.
const require = createRequire(import.meta.url);
const markedMan = path.join(path.dirname(require.resolve('marked-man/package.json')), 'bin', 'marked-man.js');

const roff = execFileSync(
  process.execPath,
  [markedMan, '--version', pkg.version ?? '0.0.0', '--manual', 'Bifrost Manual', '--section', '1', source],
  { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
);

fs.writeFileSync(target, roff);
process.stdout.write(`man page: ${path.relative(repoRoot, target)} (${roff.length} bytes)\n`);
