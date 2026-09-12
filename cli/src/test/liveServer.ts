import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/**
 * Starts a **real** Bifrost server for the integration suites.
 *
 * Not a stub: the whole value of this workspace is the contract with the actual
 * routes, so `push`, `pull`, `clip`, `go`, `speed` and the document fan-out are
 * driven against the server's own code, on a real socket, with a throwaway
 * storage root and its own SQLite file. A stub would only ever re-assert this
 * file's model of the API.
 *
 * Run from source through `tsx` (a repo-root devDependency) so the suite does
 * not depend on `server/dist` existing — CI runs `npm test` before `npm run
 * build`.
 */

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export interface LiveServer {
  baseUrl: string;
  /** Throwaway `storage/` for this run — assertions read `uploads/` and `downloads/` from it. */
  storageRoot: string;
  stop(): Promise<void>;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => (port > 0 ? resolve(port) : reject(new Error('no free port'))));
    });
  });
}

export async function startLiveServer(env: Record<string, string> = {}): Promise<LiveServer> {
  const port = await freePort();
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-cli-int-'));
  for (const folder of ['uploads', 'downloads', 'tmp', 'data', 'logs']) {
    fs.mkdirSync(path.join(storageRoot, folder), { recursive: true });
  }

  const child: ChildProcess = spawn(
    process.execPath,
    [require.resolve('tsx/cli'), path.join(repoRoot, 'server', 'src', 'app.ts')],
    {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PORT: String(port),
        STORAGE_ROOT: storageRoot,
        HEIMDALL_PIN: 'cli-int-test-pin',
        DEPLOY_PROFILE: 'local',
        LOG_LEVEL: 'fatal',
        METRICS_ENABLED: 'false',
        OTEL_ENABLED: 'false',
        ...env,
      },
    },
  );

  let output = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(`server exited early (${child.exitCode}):\n${output}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) {
        await response.arrayBuffer();
        break;
      }
    } catch {
      // Not up yet. Boot takes a couple of seconds through tsx plus migrations,
      // so a refused connection here is the expected state, not a failure.
    }
    if (Date.now() > deadline) throw new Error(`server never came up:\n${output}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  return {
    baseUrl,
    storageRoot,
    async stop(): Promise<void> {
      if (child.exitCode === null) {
        const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
        child.kill('SIGTERM');
        await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 10_000))]);
        if (child.exitCode === null) child.kill('SIGKILL');
      }
      fs.rmSync(storageRoot, { recursive: true, force: true });
    },
  };
}
