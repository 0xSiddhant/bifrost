import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { serverEnv } from '../support/env.js';
import { freePort } from '../support/free-port.js';
import { fromRepoRoot, REPO_ROOT } from '../support/paths.js';
import { E2E_PIN } from '../support/server.js';

/**
 * PLAN-36's mode smoke test (criteria 13–17): `npm start`'s own entry,
 * `scripts/start.ts`, booted on the build in each run mode. It checks which
 * ports listen and on which address, which client `PORT` serves, and that
 * `web` mode forwards nothing. The mDNS decision itself is a unit test in
 * `web/` (CI cannot multicast); here only its "off" line is read back.
 */

interface Hub {
  port: number;
  apiPort: number;
  storageRoot: string;
  output(): string;
  /** SIGTERM, as a terminal's Ctrl-C or PM2 would; resolves with the exit code. */
  stop(): Promise<number | null>;
}

const running: Hub[] = [];

afterEach(async () => {
  for (const hub of running.splice(0)) {
    await hub.stop();
    fs.rmSync(hub.storageRoot, { recursive: true, force: true });
  }
});

/** A first non-internal IPv4 address, when this machine has one. */
function lanAddress(): string | null {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  return null;
}

function listening(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(1_000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function startHub(env: Record<string, string>): Promise<Hub> {
  const port = await freePort();
  const apiPort = await freePort();
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-e2e-modes-'));
  const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/start.ts'], {
    cwd: REPO_ROOT,
    env: serverEnv({
      NODE_ENV: 'production',
      DEPLOY_PROFILE: 'local',
      PORT: String(port),
      API_PORT: String(apiPort),
      STORAGE_ROOT: storageRoot,
      HEIMDALL_PIN: E2E_PIN,
      OTEL_ENABLED: 'false',
      MDNS_NAME: `bifrost-e2e-${port}`,
      ...env,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
  const exited = new Promise<number | null>((resolve) => child.once('exit', resolve));
  const hub: Hub = {
    port,
    apiPort,
    storageRoot,
    output: () => output,
    async stop() {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      return exited;
    },
  };
  running.push(hub);
  return hub;
}

/** Poll until `url` answers 200, or fail with the hub's output. */
async function answers(hub: Hub, url: string): Promise<Response> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return response;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) throw new Error(`${url} never answered:\n${hub.output()}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const hubIndex = () => fs.readFileSync(fromRepoRoot('client', 'dist', 'index.html'), 'utf8');
const standaloneIndex = () =>
  fs.readFileSync(fromRepoRoot('client', 'dist-standalone', 'index.html'), 'utf8');

describe('run modes through npm start (PLAN-36)', () => {
  it('full, the default: the hub client on PORT for the LAN, the API on loopback only', async () => {
    const hub = await startHub({});
    const health = await answers(hub, `http://127.0.0.1:${hub.port}/api/health`);
    expect(health.headers.get('content-type')).toContain('application/json');
    expect(await (await answers(hub, `http://127.0.0.1:${hub.port}/`)).text()).toBe(hubIndex());
    expect(await (await answers(hub, `http://127.0.0.1:${hub.port}/healthz`)).json()).toEqual({
      ok: true,
      mode: 'hub',
    });
    expect(await listening('127.0.0.1', hub.apiPort)).toBe(true);
    const lan = lanAddress();
    if (lan) {
      expect(await listening(lan, hub.port), 'the web host is on the LAN').toBe(true);
      expect(await listening(lan, hub.apiPort), 'the API is not').toBe(false);
    }
    expect(hub.output()).toContain('[start] BIFROST_RUN=full: api + web');

    expect(await hub.stop()).toBe(0);
    expect(await listening('127.0.0.1', hub.port)).toBe(false);
    expect(await listening('127.0.0.1', hub.apiPort)).toBe(false);
  });

  it('api: only the API, on loopback; nothing on PORT', async () => {
    const hub = await startHub({ BIFROST_RUN: 'api' });
    await answers(hub, `http://127.0.0.1:${hub.apiPort}/api/health`);
    expect(await listening('127.0.0.1', hub.port)).toBe(false);
    expect(hub.output()).toContain('[start] BIFROST_RUN=api: api');
    expect(await hub.stop()).toBe(0);
  });

  it('web: the standalone client on PORT, forwarding nothing, and no API', async () => {
    const hub = await startHub({ BIFROST_RUN: 'web' });
    expect(await (await answers(hub, `http://127.0.0.1:${hub.port}/`)).text()).toBe(
      standaloneIndex(),
    );
    expect(await (await answers(hub, `http://127.0.0.1:${hub.port}/healthz`)).json()).toEqual({
      ok: true,
      mode: 'standalone',
    });
    // A hub path lands on the app (which shows the sheet), not on an API.
    const api = await answers(hub, `http://127.0.0.1:${hub.port}/api/health`);
    expect(await api.text()).toBe(standaloneIndex());
    expect(await listening('127.0.0.1', hub.apiPort)).toBe(false);
    expect(hub.output()).toContain('[start] BIFROST_RUN=web: web');
    expect(await hub.stop()).toBe(0);
  });

  it('WEB_HOST=127.0.0.1: the page only on this machine, and mDNS off with the reason', async () => {
    const hub = await startHub({ WEB_HOST: '127.0.0.1' });
    await answers(hub, `http://127.0.0.1:${hub.port}/api/health`);
    const lan = lanAddress();
    if (lan) expect(await listening(lan, hub.port)).toBe(false);
    const logs = path.join(hub.storageRoot, 'logs');
    await expect
      .poll(
        () =>
          fs
            .readdirSync(logs)
            .filter((name) => name.startsWith('app-web.'))
            .map((name) => fs.readFileSync(path.join(logs, name), 'utf8'))
            .join(''),
        { timeout: 10_000 },
      )
      .toMatch(/mdns off: WEB_HOST=127\.0\.0\.1 serves this machine only/);
    expect(await hub.stop()).toBe(0);
  });
});
