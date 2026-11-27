import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fileTail, newestWebLog, startServer } from './server.js';

/**
 * A server that dies while starting must say why. The API logs a fatal error
 * to its log file, not to stdout, so before the log's tail joined the error a
 * failed restart reported "server exited before it was healthy" and nothing
 * else (CI run 45458232399, chromium-mobile). These tests run a stand-in
 * "build" whose API writes such a line and exits: no real server is built or
 * started, so they belong in `npm test`.
 */

const scratch: string[] = [];

afterEach(() => {
  for (const dir of scratch.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

/** A build root whose API writes `line` to its log file and exits with code 1. */
function dyingBuild(line: string): string {
  const root = tempDir('bifrost-e2e-dying-build-');
  fs.mkdirSync(path.join(root, 'server', 'dist'), { recursive: true });
  fs.mkdirSync(path.join(root, 'client', 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'client', 'dist', 'index.html'), '<!doctype html>');
  fs.writeFileSync(path.join(root, 'server', 'dist', 'otel.js'), '');
  fs.writeFileSync(
    path.join(root, 'server', 'dist', 'bootstrap.js'),
    `const fs = require('node:fs');
const path = require('node:path');
const logs = path.join(process.env.STORAGE_ROOT, 'logs');
fs.mkdirSync(logs, { recursive: true });
fs.writeFileSync(path.join(logs, 'current.log'), ${JSON.stringify(`${line}\n`)});
process.exit(1);
`,
  );
  return root;
}

/**
 * A build root whose API counts its starts in the storage root, then dies with
 * `fatal` on the first `failures` starts and otherwise answers the health check
 * (no web host here, so the API runs alone on the harness's port).
 */
function flakyBuild(fatal: string, failures: number): string {
  const root = dyingBuild(fatal);
  fs.writeFileSync(
    path.join(root, 'server', 'dist', 'bootstrap.js'),
    `const fs = require('node:fs');
const path = require('node:path');
const counter = path.join(process.env.STORAGE_ROOT, 'starts');
const starts = (fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) : 0) + 1;
fs.writeFileSync(counter, String(starts));
if (starts <= ${failures}) {
  const logs = path.join(process.env.STORAGE_ROOT, 'logs');
  fs.mkdirSync(logs, { recursive: true });
  fs.writeFileSync(path.join(logs, 'current.log'), ${JSON.stringify(`${fatal}
`)});
  process.exit(1);
}
require('node:http')
  .createServer((request, response) => response.end('{}'))
  .listen(Number(process.env.API_PORT), '127.0.0.1');
`,
  );
  return root;
}

const starts = (storageRoot: string, file = 'starts'): number =>
  Number(fs.readFileSync(path.join(storageRoot, file), 'utf8'));

/**
 * A build root with a healthy stand-in API and a stand-in web host that writes
 * `fatal` to its own log series (`app-web.1.log`) and exits with code 1 on its
 * first `failures` starts, then answers `/healthz`.
 */
function flakyWebBuild(fatal: string, failures: number): string {
  const root = flakyBuild('unused', 0);
  fs.mkdirSync(path.join(root, 'web', 'dist'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'web', 'dist', 'bootstrap.js'),
    `const fs = require('node:fs');
const path = require('node:path');
const counter = path.join(process.env.STORAGE_ROOT, 'web-starts');
const starts = (fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) : 0) + 1;
fs.writeFileSync(counter, String(starts));
if (starts <= ${failures}) {
  const logs = path.join(process.env.STORAGE_ROOT, 'logs');
  fs.mkdirSync(logs, { recursive: true });
  fs.writeFileSync(path.join(logs, 'app-web.1.log'), ${JSON.stringify(`${fatal}
`)});
  process.exit(1);
}
require('node:http')
  .createServer((request, response) => response.end('{}'))
  .listen(Number(process.env.PORT), '127.0.0.1');
`,
  );
  return root;
}

describe('startServer', () => {
  it('starts afresh on new ports when a port it picked was taken first', async () => {
    const fatal = JSON.stringify({ level: 60, msg: 'listen EADDRINUSE: address already in use' });
    const storageRoot = tempDir('bifrost-e2e-flaky-storage-');
    const server = await startServer({
      buildRoot: flakyBuild(fatal, 1),
      storageRoot,
      keepStorage: true,
    });
    try {
      expect(starts(storageRoot)).toBe(2);
    } finally {
      await server.stop();
    }
  });

  it('does not retry any other failure, nor ports it was given', async () => {
    const migration = JSON.stringify({ level: 60, msg: 'fatal: migration failed' });
    const storageRoot = tempDir('bifrost-e2e-flaky-storage-');
    await expect(
      startServer({ buildRoot: flakyBuild(migration, 1), storageRoot, keepStorage: true }),
    ).rejects.toThrow(/migration failed/);
    expect(starts(storageRoot)).toBe(1);

    const inUse = JSON.stringify({ level: 60, msg: 'listen EADDRINUSE: address already in use' });
    const pinned = tempDir('bifrost-e2e-flaky-storage-');
    await expect(
      startServer({
        buildRoot: flakyBuild(inUse, 1),
        storageRoot: pinned,
        keepStorage: true,
        port: 1,
      }),
    ).rejects.toThrow(/EADDRINUSE/);
    expect(starts(pinned)).toBe(1);
  });

  it('starts afresh when the web host found its port taken (it logs that to its own file)', async () => {
    const fatal = JSON.stringify({
      level: 60,
      msg: 'fatal: unhandledRejection — exiting',
      err: { message: 'listen EADDRINUSE: address already in use 127.0.0.1:44901' },
    });
    const storageRoot = tempDir('bifrost-e2e-flaky-storage-');
    const server = await startServer({
      buildRoot: flakyWebBuild(fatal, 1),
      storageRoot,
      keepStorage: true,
    });
    try {
      expect(starts(storageRoot, 'web-starts')).toBe(2);
    } finally {
      await server.stop();
    }
  });

  it("reports the web host's log tail when it dies while starting", async () => {
    const fatal = JSON.stringify({ level: 60, msg: 'web host refusing to start: no client build' });
    const storageRoot = tempDir('bifrost-e2e-flaky-storage-');
    const failure = startServer({
      buildRoot: flakyWebBuild(fatal, 9),
      storageRoot,
      keepStorage: true,
    });
    await expect(failure).rejects.toThrow(/web: exited \(code 1, signal null\)/);
    await expect(failure).rejects.toThrow(/web host log \(.*app-web\.1\.log\)/);
    await expect(failure).rejects.toThrow('refusing to start: no client build');
    expect(starts(storageRoot, 'web-starts')).toBe(1);
  });

  it('reports the exit and the log tail of an API that dies while starting', async () => {
    const fatal = JSON.stringify({ level: 60, msg: 'fatal: listen EADDRINUSE 127.0.0.1:4242' });
    const storageRoot = tempDir('bifrost-e2e-dying-storage-');
    const failure = startServer({ buildRoot: dyingBuild(fatal), storageRoot, keepStorage: true });
    await expect(failure).rejects.toThrow(/server exited before it was healthy/);
    await expect(failure).rejects.toThrow(/api: exited \(code 1, signal null\)/);
    await expect(failure).rejects.toThrow(fatal);
  });
});

describe('newestWebLog', () => {
  it("picks the web host's highest-numbered file, and nothing else", () => {
    const logs = tempDir('bifrost-e2e-logs-');
    for (const name of ['app.3.log', 'app-web.2.log', 'app-web.10.log', 'current.log']) {
      fs.writeFileSync(path.join(logs, name), '');
    }
    expect(newestWebLog(logs)).toBe(path.join(logs, 'app-web.10.log'));
    expect(newestWebLog(path.join(logs, 'missing'))).toBeNull();
  });
});

describe('fileTail', () => {
  it('keeps the last lines of a file', () => {
    const file = path.join(tempDir('bifrost-e2e-tail-'), 'current.log');
    fs.writeFileSync(file, 'one\ntwo\nthree\n');
    expect(fileTail(file, 2)).toBe('two\nthree');
  });

  it('says why there is no log rather than throwing', () => {
    expect(fileTail(path.join(os.tmpdir(), 'bifrost-e2e-no-such.log'), 5)).toBe('(no log: ENOENT)');
  });
});
