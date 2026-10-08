import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serverEnv } from './env.js';
import { freePort } from './free-port.js';
import { REPO_ROOT } from './paths.js';

/**
 * A real Bifrost hub for one worker, one file or one test.
 *
 * It is the **production entry**, the two processes PM2, launchd and
 * `npm start` run (PLAN-36): the API, `node --import server/dist/otel.js
 * server/dist/bootstrap.js` on a loopback `API_PORT`, and in front of it the
 * web host, `node web/dist/bootstrap.js` on `PORT`, serving the built
 * `client/dist` and forwarding the API's paths. `baseUrl` is the web host, so
 * every suite reaches the API the way a browser and the installed CLI do.
 * Never `tsx` over the source: the whole point of this workspace is to see
 * what a user sees. So `npm run build` must have run first, and a missing
 * `dist` is reported as exactly that rather than as a confusing boot failure.
 *
 * A build from before PLAN-36 (the API diff's and the load harness's older
 * side) has no `web/dist`; it is run as the one process it was then.
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
  /** Reuse a port (a restart must come back on the address the browser knows). */
  port?: number;
  /** Reuse the API's port too, for the same reason. */
  apiPort?: number;
  /**
   * The API alone, with no web host in front: `baseUrl` is the API itself.
   * For measuring the extra hop (`test:load --direct`), never for a journey.
   */
  direct?: boolean;
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
  /** The address people open: the web host (the API itself when `direct`). */
  baseUrl: string;
  port: number;
  /** The API on loopback, behind the web host. Same as `baseUrl` when there is no web host. */
  apiUrl: string;
  apiPort: number;
  /** False for `direct` and for a build from before PLAN-36. */
  hasWebHost: boolean;
  /** The web host's process id (the load harness samples its RSS), or null without one. */
  webPid: number | null;
  storageRoot: string;
  pin: string;
  profile: 'local' | 'cloud';
  /** The active pino file (`current.log` is pino-roll's symlink to it). */
  logFile: string;
  /** Present when started with `canary: true`. */
  canary: Canary | null;
  /** Everything both processes wrote to stdout/stderr — attached to failure reports. */
  output(): string;
  /** How the API process ended, or null while it runs. */
  exitStatus(): ExitStatus | null;
  /** How the web host ended, or null while it runs (or when there is none). */
  webExitStatus(): ExitStatus | null;
  /** SIGTERM both (web host first), wait for clean exits, then remove scratch storage unless kept. */
  stop(): Promise<void>;
  /** Stop both processes but keep storage, so `start` can bring them back. */
  halt(): Promise<void>;
  /** Stop only the API: the web host keeps serving the client and answers 502. */
  haltApi(): Promise<void>;
  /** Start a halted API again, on the same port and storage. */
  restartApi(): Promise<void>;
  /** Stop only the web host: the API keeps running, unreachable from the browser. */
  haltWeb(): Promise<void>;
}

function scratchDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export async function waitForHealth(
  baseUrl: string,
  isAlive: () => boolean,
  output: () => string,
  timeoutMs = 60_000,
  healthPath = '/api/v1/health',
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (!isAlive()) throw new Error(`server exited before it was healthy:\n${output()}`);
    try {
      const response = await fetch(`${baseUrl}${healthPath}`, {
        signal: AbortSignal.timeout(1_000),
      });
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

interface Proc {
  pid: number | null;
  alive(): boolean;
  exitStatus(): ExitStatus | null;
  /** SIGTERM, then SIGKILL after 15 s; resolves once it has exited. */
  halt(): Promise<void>;
}

function spawnProc(
  args: string[],
  cwd: string,
  env: Record<string, string>,
  append: (chunk: Buffer) => void,
): Proc {
  const child: ChildProcess = spawn(process.execPath, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let exit: ExitStatus | null = null;
  child.once('exit', (code, signal) => {
    exit = { code, signal };
  });
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  const alive = () => child.exitCode === null && child.signalCode === null;
  return {
    pid: child.pid ?? null,
    alive,
    exitStatus: () => exit,
    async halt() {
      if (!alive()) return;
      const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      child.kill('SIGTERM');
      const timer = new Promise<void>((resolve) => setTimeout(resolve, 15_000).unref());
      await Promise.race([exited, timer]);
      if (alive()) {
        child.kill('SIGKILL');
        await exited;
      }
    },
  };
}

export async function startServer(options: StartServerOptions = {}): Promise<E2EServer> {
  const buildRoot = options.buildRoot ?? REPO_ROOT;
  const entry = path.join(buildRoot, 'server', 'dist', 'bootstrap.js');
  const otel = path.join(buildRoot, 'server', 'dist', 'otel.js');
  const webEntry = path.join(buildRoot, 'web', 'dist', 'bootstrap.js');
  if (
    !fs.existsSync(entry) ||
    !fs.existsSync(path.join(buildRoot, 'client', 'dist', 'index.html'))
  ) {
    throw new Error(`no production build under ${buildRoot} — run \`npm run build\` first`);
  }
  // This checkout always has a web host: a missing one is a stale build, not
  // an older version, and must not quietly test the API alone.
  if (!options.buildRoot && !options.direct && !fs.existsSync(webEntry)) {
    throw new Error(`no web host build under ${buildRoot} — run \`npm run build\` first`);
  }
  const hasWebHost = !options.direct && fs.existsSync(webEntry);

  const profile = options.profile ?? 'local';
  const port = options.port ?? (await freePort());
  const apiPort = hasWebHost ? (options.apiPort ?? (await freePort())) : port;
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
  const env = serverEnv({
    NODE_ENV: 'production',
    DEPLOY_PROFILE: profile,
    STORAGE_ROOT: storageRoot,
    HEIMDALL_PIN: E2E_PIN,
    OTEL_ENABLED: 'false',
    // A unique Bonjour name: on the owner's Mac a second `bifrost.local` would
    // collide with the real household instance on the LAN.
    MDNS_NAME: `bifrost-e2e-${port}`,
    // Unknown to a server before PLAN-32b, and `loadConfig` ignores unknown
    // keys; from 32b on, every response the suite triggers is contract-checked.
    API_CONTRACT_CHECK: 'strict',
    // PLAN-36: the hub as `npm start` runs it, the web host on PORT and the
    // API on API_PORT. Loopback only, which also keeps the web host from
    // advertising a name on the LAN. `direct` runs the API alone on PORT.
    ...(hasWebHost
      ? {
          PORT: String(port),
          API_PORT: String(apiPort),
          BIFROST_RUN: 'full',
          WEB_HOST: '127.0.0.1',
        }
      : { PORT: String(port + 1), API_PORT: String(port), BIFROST_RUN: 'api' }),
    ...options.env,
  });

  let output = '';
  const appender = (label: string) => (chunk: Buffer) => {
    output += label + chunk.toString();
    // Bounded: a long soak must not grow this without limit.
    if (output.length > 200_000) output = output.slice(-100_000);
  };
  // A build from before PLAN-36 ignores API_PORT and listens on PORT.
  const apiEnv = fs.existsSync(webEntry) ? env : { ...env, PORT: String(port) };
  const startApi = () => spawnProc(['--import', otel, entry], buildRoot, apiEnv, appender(''));
  let api = startApi();
  const web = hasWebHost ? spawnProc([webEntry], buildRoot, env, appender('[web] ')) : null;

  const baseUrl = `http://127.0.0.1:${port}`;
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const bothAlive = () => api.alive() && (web?.alive() ?? true);
  const haltBoth = async () => {
    // The order `npm start` stops in: the web host stops accepting first.
    await web?.halt();
    await api.halt();
  };
  try {
    await waitForHealth(apiUrl, api.alive, () => output);
    if (web) await waitForHealth(baseUrl, bothAlive, () => output, 30_000, '/healthz');
  } catch (error) {
    await haltBoth();
    throw error;
  }

  return {
    baseUrl,
    port,
    apiUrl,
    apiPort,
    hasWebHost,
    webPid: web?.pid ?? null,
    storageRoot,
    pin: E2E_PIN,
    profile,
    canary,
    logFile: path.join(storageRoot, 'logs', 'current.log'),
    output: () => output,
    exitStatus: () => api.exitStatus(),
    webExitStatus: () => web?.exitStatus() ?? null,
    halt: haltBoth,
    haltApi: () => api.halt(),
    async restartApi() {
      if (api.alive()) return;
      api = startApi();
      await waitForHealth(apiUrl, api.alive, () => output);
    },
    haltWeb: async () => {
      await web?.halt();
    },
    async stop() {
      await haltBoth();
      if (!options.keepStorage) {
        if (!options.storageRoot) fs.rmSync(jail ?? storageRoot, { recursive: true, force: true });
      }
    },
  };
}
