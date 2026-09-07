import type { Command } from 'commander';
import { performUpdate } from '../core/selfUpdate.js';
import { print } from '../core/output.js';

/**
 * The one command that changes this CLI's own install. `doctor` only ever
 * reports a mismatch; installing happens because someone typed this.
 */
export function registerUpdate(program: Command): void {
  program
    .command('update')
    .description('install the latest published CLI tarball from GitHub Releases')
    .action(async () => {
      const outcome = await performUpdate();
      print(outcome, (value) => value.message);
    });
}
