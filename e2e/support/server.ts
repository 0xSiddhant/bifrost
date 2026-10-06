import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serverEnv } from './env.js';
import { freePort } from './free-port.js';
import { REPO_ROOT } from './paths.js';

/**
 * A real Bifrost server for one worker, one file or one test.
 *
 * It is the **production entry** — `node --import server/dist/otel.js
 * server/dist/bootstrap.js`, the command PM2 and launchd run — serving the
 * built `client/dist`, never `tsx` over the source: the whole point of this
 * workspace is to see what a user's browser and a user's installed CLI see.
 * So `npm run build` must have run first, and a missing `dist` is reported as
 * exactly that rather than as a confusing boot failure.
 *
 * Plain TypeScript with no test-runner dependency: Playwright wraps it in a
 * worker- or test-scoped fixture, Vitest in `beforeAll`/`afterAll`, and the API
 * diff starts two of them from two different builds.
 */

export const E2E_PIN = 'e2e-heimdall-pin';

export interface StartServerOptions {
  /** Repo root whose `server/dist` and `client/dist` are run. Default: this checkout. */
  buildRoot?: string;
  profile?: 'local' | 'cloud';
  /** Reuse an existing storage root (a restart, or the API diff's prepared copy). */
  storageRoot?: string;
  /** Reuse an existing themes folder (paired with `storageRoot` on a restart). */
  themesDir?: string;
  /** Reuse a port (a restart must come back on the address the browser knows). */
  port?: number;
  /** Extra env on top of production defaults. */
  env?: Record<string, string>;
  /** Leave storage on disk after `stop()` (the caller owns its cleanup). */
  keepStorage?: boolean;
  /**
   * PLAN-33's traversal canary: put `STORAGE_ROOT` inside a scratch "jail"
   * whose other entry is a file of random contents. A path that escapes the
   * storage root by one level reaches the canary, so its bytes appearing in a
   * response proves the escape. Ignored when `storageRoot` is given.
   */
  canary?: boolean;
}

export interface Canary {
  path: string;
  contents: string;
}

export interface ExitStatus {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface E2EServer {
  baseUrl: string;
  port: number;
  storageRoot: string;
  themesDir: string;
  pin: string;
  profile: 'local' | 'cloud';
  /** The active pino file (`current.log` is pino-roll's symlink to it). */
  logFile: string;
  /** Present when started with `canary: true`. */
  canary: Canary | null;
  /** Everything the process wrote to stdout/stderr — attached to failure reports. */
  output(): string;
  /** How the process ended, or null while it runs. */
  exitStatus(): ExitStatus | null;
  /** SIGTERM, wait for a clean exit, then remove scratch storage unless kept. */
  stop(): Promise<void>;
  /** Stop the process but keep its storage, so `start` can bring it back. */
  halt(): Promise<void>;
}

function scratchDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export async function waitForHealth(
  baseUrl: string,
  isAlive: () => boolean,
  output: () => string,
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (!isAlive()) throw new Error(`server exited before it was healthy:\n${output()}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1_000) });
      await response.arrayBuffer();
      if (response.ok) return;
    } catch {
      // Not listening yet: boot runs migrations first, so a refused connection
      // is the expected state for the first second or two, not a failure.
    }
    if (Date.now() > deadline) throw new Error(`server never became healthy:\n${output()}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export async function startServer(options: StartServerOptions = {}): Promise<E2EServer> {
  const buildRoot = options.buildRoot ?? REPO_ROOT;
  const entry = path.join(buildRoot, 'server', 'dist', 'bootstrap.js');
  const otel = path.join(buildRoot, 'server', 'dist', 'otel.js');
  if (
    !fs.existsSync(entry) ||
    !fs.existsSync(path.join(buildRoot, 'client', 'dist', 'index.html'))
  ) {
    throw new Error(`no production build under ${buildRoot} — run \`npm run build\` first`);
  }

  const profile = options.profile ?? 'local';
  const port = options.port ?? (await freePort());
  let jail: string | null = null;
  let canary: Canary | null = null;
  let storageRoot: string;
  if (options.storageRoot) {
    storageRoot = options.storageRoot;
  } else if (options.canary) {
    jail = scratchDir('bifrost-e2e-jail-');
    storageRoot = path.join(jail, 'storage');
    fs.mkdirSync(storageRoot);
    canary = {
      path: path.join(jail, 'canary.txt'),
      contents: `canary-${crypto.randomBytes(24).toString('hex')}`,
    };
    fs.writeFileSync(canary.path, canary.contents);
  } else {
    storageRoot = scratchDir('bifrost-e2e-storage-');
  }
  // Themes are state too (Heimdall uploads and deletes them), and THEMES_DIR's
  // default is the repo's own themes/ — a theme journey would edit the checkout.
  let themesDir = options.themesDir;
  if (!themesDir) {
    themesDir = scratchDir('bifrost-e2e-themes-');
    fs.cpSync(path.join(buildRoot, 'themes'), themesDir, { recursive: true });
  }

  const env = serverEnv({
    NODE_ENV: 'production',
    DEPLOY_PROFILE: profile,
    PORT: String(port),
    STORAGE_ROOT: storageRoot,
    THEMES_DIR: themesDir,
    HEIMDALL_PIN: E2E_PIN,
    OTEL_ENABLED: 'false',
    // A unique Bonjour name: on the owner's Mac a second `bifrost.local` would
    // collide with the real household instance on the LAN.
    MDNS_NAME: `bifrost-e2e-${port}`,
    // Unknown to a server before PLAN-32b, and `loadConfig` ignores unknown
    // keys; from 32b on, every response the suite triggers is contract-checked.
    API_CONTRACT_CHECK: 'strict',
    ...options.env,
  });

  let output = '';
  const child: ChildProcess = spawn(process.execPath, ['--import', otel, entry], {
    cwd: buildRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let exit: ExitStatus | null = null;
  child.once('exit', (code, signal) => {
    exit = { code, signal };
  });
  const append = (chunk: Buffer) => {
    output += chunk.toString();
    // Bounded: a long soak must not grow this without limit.
    if (output.length > 200_000) output = output.slice(-100_000);
  };
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);

  const baseUrl = `http://127.0.0.1:${port}`;
  const alive = () => child.exitCode === null && child.signalCode === null;
  try {
    await waitForHealth(baseUrl, alive, () => output);
  } catch (error) {
    child.kill('SIGKILL');
    throw error;
  }

  const halt = async (): Promise<void> => {
    if (!alive()) return;
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill('SIGTERM');
    const timer = new Promise<void>((resolve) => setTimeout(resolve, 15_000).unref());
    await Promise.race([exited, timer]);
    if (alive()) {
      child.kill('SIGKILL');
      await exited;
    }
  };

  return {
    baseUrl,
    port,
    storageRoot,
    themesDir,
    pin: E2E_PIN,
    profile,
    canary,
    logFile: path.join(storageRoot, 'logs', 'current.log'),
    output: () => output,
    exitStatus: () => exit,
    halt,
    async stop() {
      await halt();
      if (!options.keepStorage) {
        if (!options.storageRoot) fs.rmSync(jail ?? storageRoot, { recursive: true, force: true });
        if (!options.themesDir) fs.rmSync(themesDir, { recursive: true, force: true });
      }
    },
  };
}
