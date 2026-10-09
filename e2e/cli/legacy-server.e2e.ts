import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest';
import { runCli, type CliRun } from '../support/cli-install.js';
import { freePort } from '../support/free-port.js';
import { useCliSuite } from './harness.js';

/**
 * PLAN-37 criterion 6, the new CLI against a hub from before API versioning.
 * A stand-in for that hub sits in front of the real one: every versioned path
 * (`/api/v1/…`, `/<kind>/api/v1/…`) is a 404, as it was on such a server, and
 * the unversioned paths are passed through. The CLI's probe must see the 404,
 * use the old paths for the rest of the run, and say so once on stderr (never
 * under --json), and the core commands must still work.
 */

const cli = useCliSuite();
const HINT = 'the server predates API versioning';
const VERSIONED = /^\/(?:api|runestone\/api|edda\/api|groot\/api|atlas\/api)\/v\d+(?:\/|$)/;

let oldHub: http.Server;
let oldHubUrl = '';
const asked: string[] = [];

beforeAll(async () => {
  const upstream = new URL(cli.server().baseUrl);
  oldHub = http.createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://x').pathname;
    asked.push(pathname);
    if (VERSIONED.test(pathname)) {
      response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'NOT_FOUND', message: `Route ${pathname} not found` }));
      return;
    }
    const forward = http.request(
      {
        hostname: upstream.hostname,
        port: upstream.port,
        path: request.url,
        method: request.method,
        headers: request.headers,
      },
      (answer) => {
        response.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(response);
      },
    );
    forward.on('error', () => response.destroy());
    request.pipe(forward);
  });
  const port = await freePort();
  await new Promise<void>((resolve) => oldHub.listen(port, '127.0.0.1', resolve));
  oldHubUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => oldHub.close(() => resolve()));
});

/** `bifrost --host <old hub> …args`, and which paths that one run asked for. */
async function againstOldHub(
  args: string[],
  cwd?: string,
): Promise<{ run: CliRun; paths: string[] }> {
  const from = asked.length;
  const run = await runCli(inject('bifrostBinary'), ['--host', oldHubUrl, ...args], {
    env: cli.home().env,
    ...(cwd ? { cwd } : {}),
  });
  return { run, paths: asked.slice(from) };
}

/** One probe, then nothing versioned: the run spoke the old paths. */
function spokeOldPaths(paths: string[]): void {
  expect(paths[0]).toBe('/api/v1/health');
  expect(paths.slice(1).filter((pathname) => VERSIONED.test(pathname))).toEqual([]);
  expect(paths.length).toBeGreaterThan(1);
}

describe('a hub from before API versioning (PLAN-37)', () => {
  it('status: works, with one hint on stderr, and none under --json', async () => {
    const human = await againstOldHub(['status']);
    expect(human.run.code).toBe(0);
    expect(human.run.stdout).toContain('local');
    expect(human.run.stderr.split(HINT)).toHaveLength(2);
    spokeOldPaths(human.paths);

    const json = await againstOldHub(['--json', 'status']);
    expect(json.run.code).toBe(0);
    expect(json.run.stderr).toBe('');
    expect(json.run.json<{ profile: string }>().profile).toBe('local');
    spokeOldPaths(json.paths);
  });

  it('push, pull, clip and portkey list work on the old paths', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-e2e-legacy-'));
    try {
      fs.writeFileSync(path.join(dir, 'old-hub.txt'), 'through the old paths');
      const push = await againstOldHub(['--json', 'push', 'old-hub.txt', '-d', 'Legacy'], dir);
      expect(push.run.code, push.run.stderr).toBe(0);
      spokeOldPaths(push.paths);

      // The watcher lists a push a moment later (awaitWriteFinish).
      await expect
        .poll(
          async () => {
            const listed = await againstOldHub(['--json', 'pull', '--list']);
            return listed.run
              .json<{ name: string; parent?: string | null }[]>()
              .map((entry) => `${entry.parent ?? ''}/${entry.name}`);
          },
          { timeout: 10_000 },
        )
        .toContain('Legacy/old-hub.txt');

      const out = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-e2e-legacy-out-'));
      try {
        const pull = await againstOldHub(['pull', 'Legacy/old-hub.txt'], out);
        expect(pull.run.code, pull.run.stderr).toBe(0);
        expect(fs.readFileSync(path.join(out, 'old-hub.txt'), 'utf8')).toBe(
          'through the old paths',
        );
        spokeOldPaths(pull.paths);
      } finally {
        fs.rmSync(out, { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }

    const clip = await againstOldHub(['clip', 'from an old hub']);
    expect(clip.run.code).toBe(0);
    spokeOldPaths(clip.paths);
    const newest = await againstOldHub(['clip']);
    expect(newest.run.stdout.trim()).toBe('from an old hub');

    const links = await againstOldHub(['--json', 'portkey', 'list']);
    expect(links.run.code).toBe(0);
    expect(Array.isArray(links.run.json())).toBe(true);
    spokeOldPaths(links.paths);
  });

  it('speaks v1, with no hint, to the current hub', async () => {
    const run = await cli.bifrost(['status']);
    expect(run.code).toBe(0);
    expect(run.stderr).not.toContain(HINT);
  });
});
