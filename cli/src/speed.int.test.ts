import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startLiveServer, type LiveServer } from './test/liveServer.js';
import { runCli } from './test/runCli.js';
import { deviceId } from './core/config.js';
import type { NimbusResult } from './core/nimbus.js';

/** The Nimbus cycle — ping, download, upload, save — and the single-flight 409. */

const OTHER_DEVICE = 'another-broom';

let server: LiveServer;
let workspace: string;
let host: string[];

beforeAll(async () => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-cli-speed-'));
  process.env.XDG_CONFIG_HOME = path.join(workspace, 'config');
  server = await startLiveServer({ NIMBUS_MAX_TEST_MB: '4' });
  host = ['--host', server.baseUrl];
}, 90_000);

afterAll(async () => {
  await server.stop();
  delete process.env.XDG_CONFIG_HOME;
  fs.rmSync(workspace, { recursive: true, force: true });
});

/** Takes the guard as a different device, the way a browser mid-test holds it. */
async function holdGuard(): Promise<void> {
  const response = await fetch(`${server.baseUrl}/api/nimbus/down?mb=1`, {
    headers: { 'x-bifrost-device': OTHER_DEVICE },
  });
  await response.arrayBuffer();
  // The lease survives a grace period after the last request ends — which is
  // exactly the window a second device would collide with.
}

async function freeGuard(): Promise<void> {
  await fetch(`${server.baseUrl}/api/nimbus/release`, {
    method: 'POST',
    headers: { 'x-bifrost-device': OTHER_DEVICE },
  });
}

describe('speed', () => {
  it('runs a full cycle and saves it to the same history a browser run joins', async () => {
    const run = await runCli([...host, '--json', 'speed', '--mb', '1']);

    expect(run.exitCode).toBe(0);
    const saved = run.json<NimbusResult>();
    expect(saved.downMbps).toBeGreaterThan(0);
    expect(saved.upMbps).toBeGreaterThan(0);
    expect(saved.latencyMs).toBeGreaterThanOrEqual(0);
    expect(saved.testMb).toBe(1);

    const history = (await (
      await fetch(`${server.baseUrl}/api/nimbus/results`)
    ).json()) as NimbusResult[];
    expect(history).toHaveLength(1);
    expect(history[0]?.id).toBe(saved.id);
    // Attributed to this machine, not left anonymous.
    expect(history[0]?.deviceId).toBe(deviceId());
  }, 60_000);

  it('reports the single-flight guard as a specific error, not a stack trace', async () => {
    await holdGuard();
    try {
      const run = await runCli([...host, 'speed', '--mb', '1']);

      expect(run.exitCode).toBe(5);
      expect(run.stderr).toContain('another broom is flying');
      expect(run.stderr).not.toContain('at ');
    } finally {
      await freeGuard();
    }
  }, 60_000);

  it('refuses a payload over the server’s own cap, before running anything', async () => {
    const run = await runCli([...host, 'speed', '--mb', '999']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('capped at 4');
  });

  it('refuses a --mb that is not a positive number', async () => {
    const run = await runCli([...host, 'speed', '--mb', 'lots']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('positive number of megabytes');
  });
});
