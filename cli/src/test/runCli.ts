import { main } from '../index.js';
import { setJsonMode } from '../core/output.js';

/**
 * Drives the CLI the way a terminal does — through `index.ts`'s real commander
 * dispatch — and hands back exactly what a shell would see. In-process rather
 * than spawned, so a test can also count the requests the run made.
 *
 * `process.exitCode` is saved and restored around each run: a command that sets
 * it would otherwise decide the whole test process's exit status.
 */

export interface CliRun {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** stdout parsed as JSON. Only meaningful for a `--json` run. */
  json<T>(): T;
}

export async function runCli(args: readonly string[]): Promise<CliRun> {
  const previousExitCode = process.exitCode;
  const stdoutWrite = process.stdout.write.bind(process.stdout);
  const stderrWrite = process.stderr.write.bind(process.stderr);

  let stdout = '';
  let stderr = '';
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array): boolean => {
    stderr += String(chunk);
    return true;
  }) as typeof process.stderr.write;

  process.exitCode = 0;
  setJsonMode(false);
  try {
    await main(['node', 'bifrost', ...args]);
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }

  const exitCode = Number(process.exitCode ?? 0);
  process.exitCode = previousExitCode;
  setJsonMode(false);

  return {
    stdout,
    stderr,
    exitCode,
    json<T>(): T {
      return JSON.parse(stdout) as T;
    },
  };
}
