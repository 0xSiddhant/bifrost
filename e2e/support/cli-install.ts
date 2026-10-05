import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fromRepoRoot } from './paths.js';
import { ptyCommand } from './pty.js';

const exec = promisify(execFile);

/**
 * The CLI as a user installs it: `npm pack` the built workspace, then `npm
 * install -g` that tarball into a **temporary prefix** — never the global one,
 * so the developer's own `bifrost` is untouched. Shared by the CLI suite and
 * the cross-surface journeys, each through its runner's global setup.
 */

export interface InstalledCli {
  /** The installed `bifrost` executable. */
  binary: string;
  /** The temporary prefix holding it; removed by `removeCli`. */
  prefix: string;
  version: string;
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

export async function installCli(): Promise<InstalledCli> {
  const cliRoot = fromRepoRoot('cli');
  if (!fs.existsSync(path.join(cliRoot, 'dist', 'index.js'))) {
    throw new Error('cli/dist is missing — run `npm run build` first');
  }
  const prefix = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-e2e-cli-'));
  const packDir = path.join(prefix, 'pack');
  fs.mkdirSync(packDir);
  const { stdout } = await exec(npm, ['pack', '--pack-destination', packDir, '--silent'], {
    cwd: cliRoot,
  });
  const tarball = path.join(packDir, stdout.trim().split('\n').pop() ?? '');
  await exec(
    npm,
    [
      'install',
      '--global',
      '--prefix',
      prefix,
      '--no-audit',
      '--no-fund',
      '--loglevel=error',
      tarball,
    ],
    {
      cwd: prefix,
    },
  );
  const binary =
    process.platform === 'win32'
      ? path.join(prefix, 'bifrost.cmd')
      : path.join(prefix, 'bin', 'bifrost');
  const version = (
    JSON.parse(fs.readFileSync(path.join(cliRoot, 'package.json'), 'utf8')) as { version: string }
  ).version;
  return { binary, prefix, version };
}

export function removeCli(cli: Pick<InstalledCli, 'prefix'>): void {
  fs.rmSync(cli.prefix, { recursive: true, force: true });
}

export interface CliHome {
  /** A throwaway HOME + XDG_CONFIG_HOME, so the owner's real config is never read or written. */
  dir: string;
  env: Record<string, string>;
  configFile: string;
  remove(): void;
}

/**
 * A fresh, empty home for one suite. The update-check cache is pre-seeded as
 * just-checked against the installed version, so `doctor` never reaches
 * GitHub from a test (its six-hour throttle is the CLI's own mechanism).
 */
export function cliHome(version: string): CliHome {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-e2e-home-'));
  const configHome = path.join(dir, '.config');
  const configFile = path.join(configHome, 'bifrost', 'config.json');
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.writeFileSync(
    configFile,
    JSON.stringify(
      { update: { lastCheckedAt: Date.now(), latestVersion: version, assetUrl: null } },
      null,
      2,
    ),
  );
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'NO_COLOR' && key !== 'FORCE_COLOR') env[key] = value;
  }
  Object.assign(env, {
    HOME: dir,
    USERPROFILE: dir,
    XDG_CONFIG_HOME: configHome,
    APPDATA: configHome,
  });
  return { dir, env, configFile, remove: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

export interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
  json<T = unknown>(): T;
}

export interface RunOptions {
  env: Record<string, string>;
  cwd?: string;
  /** Run under a real pty (stdout and stderr merge into `stdout`). */
  tty?: boolean;
  input?: string;
  timeoutMs?: number;
}

export function runCli(binary: string, args: string[], options: RunOptions): Promise<CliRun> {
  const argv = [binary, ...args];
  const { file, args: spawnArgs } = options.tty
    ? ptyCommand(argv)
    : { file: argv[0] ?? binary, args: argv.slice(1) };
  return new Promise((resolve, reject) => {
    const child = spawn(file, spawnArgs, {
      cwd: options.cwd ?? options.env.HOME,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(
        new Error(`bifrost ${args.join(' ')} timed out\nstdout: ${stdout}\nstderr: ${stderr}`),
      );
    }, options.timeoutMs ?? 60_000);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr, json: <T>() => JSON.parse(stdout) as T });
    });
    child.stdin.end(options.input ?? '');
  });
}
