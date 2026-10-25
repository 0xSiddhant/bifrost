import { afterAll, beforeAll, inject } from 'vitest';
import {
  cliHome,
  runCli,
  type CliHome,
  type CliRun,
  type RunOptions,
} from '../support/cli-install.js';
import { startServer, type E2EServer, type StartServerOptions } from '../support/server.js';

/**
 * Per-file wiring for the installed-CLI suites: one production server and one
 * throwaway home per file (files run in parallel; tests in a file run in order
 * against that server). `bifrost(...)` runs the installed binary pointed at it.
 */
export interface CliSuite {
  server(): E2EServer;
  home(): CliHome;
  /** `bifrost --host <server> …args`, piped (not a TTY). */
  bifrost(args: string[], options?: Partial<RunOptions>): Promise<CliRun>;
  /** Same, with `--json`, parsed. */
  json<T>(args: string[], options?: Partial<RunOptions>): Promise<{ run: CliRun; body: T }>;
}

export function useCliSuite(serverOptions: StartServerOptions = {}): CliSuite {
  let server: E2EServer | undefined;
  let home: CliHome | undefined;
  const binary = inject('bifrostBinary');

  beforeAll(async () => {
    server = await startServer(serverOptions);
    home = cliHome(inject('bifrostVersion'));
  });
  afterAll(async () => {
    await server?.stop();
    home?.remove();
  });

  const must = <T>(value: T | undefined, what: string): T => {
    if (value === undefined) throw new Error(`${what} is not ready (beforeAll failed?)`);
    return value;
  };

  const bifrost = (args: string[], options: Partial<RunOptions> = {}) =>
    runCli(binary, ['--host', must(server, 'server').baseUrl, ...args], {
      env: must(home, 'home').env,
      ...options,
    });

  return {
    server: () => must(server, 'server'),
    home: () => must(home, 'home'),
    bifrost,
    async json<T>(args: string[], options: Partial<RunOptions> = {}) {
      const run = await bifrost(['--json', ...args], options);
      let body: T;
      try {
        body = run.json<T>();
      } catch {
        throw new Error(
          `not JSON (exit ${run.code}):\nstdout: ${run.stdout}\nstderr: ${run.stderr}`,
        );
      }
      return { run, body };
    },
  };
}

/** Any ANSI escape sequence — colour, cursor movement, line clearing. */
// The escape byte is exactly what this matches, so the control character is the point.
// eslint-disable-next-line no-control-regex
export const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/;
