#!/usr/bin/env node
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Command } from 'commander';
import { registerClip } from './commands/clip.js';
import { registerConfig } from './commands/config.js';
import { registerDevices } from './commands/devices.js';
import { registerDoctor } from './commands/doctor.js';
import { registerOpen } from './commands/open.js';
import { registerPortkey } from './commands/portkey.js';
import { registerPreview } from './commands/preview.js';
import { registerPull } from './commands/pull.js';
import { registerPush } from './commands/push.js';
import { registerSpeed } from './commands/speed.js';
import { registerStatus } from './commands/status.js';
import { registerUpdate } from './commands/update.js';
import { DEFAULT_BASE_URL } from './core/discover.js';
import { CliError, EXIT, printError, setJsonMode } from './core/output.js';
import { cliVersion } from './core/selfUpdate.js';

/**
 * The composition root: wire the flags, register the commands, and turn any
 * failure into one line on stderr with an exit code — never a stack trace.
 *
 * Nothing here reaches the network before a command asks it to. In particular
 * there is no version check ahead of dispatch: `push`/`pull`/`clip`/… never
 * touch the GitHub API at all, and only `update` and `doctor` do.
 */
export function buildProgram(): Command {
  const program = new Command();

  program
    .name('bifrost')
    .description('Talk to a Bifrost LAN hub from the terminal.')
    .version(cliVersion(), '-v, --version')
    .option('--host <address>', `the bridge to talk to (default: your saved host, else ${DEFAULT_BASE_URL})`)
    .option('--json', 'machine-readable output on stdout, nothing else mixed in')
    .hook('preAction', (_program, action) => {
      setJsonMode(action.optsWithGlobals().json === true);
    });

  registerPush(program);
  registerPull(program);
  registerClip(program);
  registerOpen(program);
  registerPreview(program);
  registerPortkey(program);
  registerStatus(program);
  registerDevices(program);
  registerSpeed(program);
  registerConfig(program);
  registerUpdate(program);
  registerDoctor(program);

  return program;
}

export async function main(argv: readonly string[] = process.argv): Promise<void> {
  try {
    await buildProgram().parseAsync(argv as string[]);
  } catch (error) {
    if (error instanceof CliError) {
      printError(error.message);
      process.exitCode = error.exitCode;
      return;
    }
    printError(error instanceof Error ? error.message : String(error));
    process.exitCode = EXIT.failure;
  }
}

/**
 * Self-start only when this file *is* the entry, so the test suite can import
 * `main`/`buildProgram` and drive the real dispatch without the module running
 * a command on import.
 *
 * `realpathSync` is the load-bearing part: `npm install -g` puts a **symlink**
 * on PATH, so `process.argv[1]` is `/usr/local/bin/bifrost` rather than the
 * `dist/index.js` this module's own URL names — comparing them raw would leave
 * the installed CLI doing nothing at all. (Same family of trap as PM2's fork
 * wrapper, which is why `server/src/app.ts` has a bootstrap beside it.)
 */
function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return pathToFileURL(fs.realpathSync(entry)).href === import.meta.url;
  } catch {
    // An entry path we cannot resolve is not this file — treating it as "not
    // the entry" is the safe half, and every real invocation resolves.
    return false;
  }
}

if (invokedDirectly()) await main();
