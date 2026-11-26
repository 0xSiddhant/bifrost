import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fileTail, startServer } from './server.js';

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

describe('startServer', () => {
  it('reports the exit and the log tail of an API that dies while starting', async () => {
    const fatal = JSON.stringify({ level: 60, msg: 'fatal: listen EADDRINUSE 127.0.0.1:4242' });
    const storageRoot = tempDir('bifrost-e2e-dying-storage-');
    const failure = startServer({ buildRoot: dyingBuild(fatal), storageRoot, keepStorage: true });
    await expect(failure).rejects.toThrow(/server exited before it was healthy/);
    await expect(failure).rejects.toThrow(/api: exited \(code 1, signal null\)/);
    await expect(failure).rejects.toThrow(fatal);
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
