import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startLiveServer, type LiveServer } from './test/liveServer.js';
import { runCli } from './test/runCli.js';
import type { DownloadEntry, UploadResult } from './core/files.js';

/**
 * `push` and `pull` against a real listening server, because a multipart upload
 * from a real file on disk is exactly what `fastify.inject` does not cover.
 */

let server: LiveServer;
let workspace: string;
let host: string[];

beforeAll(async () => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-cli-files-'));
  process.env.XDG_CONFIG_HOME = path.join(workspace, 'config');
  // A 1 MB cap makes the mixed accepted/rejected batch reachable without
  // writing gigabytes; MAX_FILES_PER_UPLOAD stays at its default.
  server = await startLiveServer({ MAX_UPLOAD_SIZE_MB: '1' });
  host = ['--host', server.baseUrl];
}, 90_000);

afterAll(async () => {
  await server.stop();
  delete process.env.XDG_CONFIG_HOME;
  fs.rmSync(workspace, { recursive: true, force: true });
});

function write(name: string, contents: string | Buffer): string {
  const file = path.join(workspace, name);
  fs.writeFileSync(file, contents);
  return file;
}

describe('push', () => {
  it('lands the file in uploads/ exactly as a browser upload does', async () => {
    const source = write('notes.txt', 'hello from the cli');
    const run = await runCli([...host, '--json', 'push', source]);

    expect(run.exitCode).toBe(0);
    const result = run.json<UploadResult>();
    expect(result.rejected).toEqual([]);
    expect(result.accepted).toEqual([
      { name: 'notes.txt', storedName: 'notes.txt', size: 18 },
    ]);

    // The server-side result, not just the 201: same bytes, same 0644 mode the
    // browser path produces.
    const landed = path.join(server.storageRoot, 'uploads', 'notes.txt');
    expect(fs.readFileSync(landed, 'utf8')).toBe('hello from the cli');
    expect(fs.statSync(landed).mode & 0o777).toBe(0o644);
    expect(fs.readdirSync(path.join(server.storageRoot, 'tmp'))).toEqual([]);
  });

  it('sends several files in ONE request, not one round trip each', async () => {
    const a = write('one.txt', 'first');
    const b = write('two.txt', 'second');
    // `push` is the one path that uses node:http rather than fetch (the
    // streaming spike), so the count is taken there.
    const request = vi.spyOn(http, 'request');

    const run = await runCli([...host, '--json', 'push', a, b]);

    expect(request).toHaveBeenCalledTimes(1);
    request.mockRestore();
    expect(run.json<UploadResult>().accepted).toHaveLength(2);
  });

  it('reports a mixed batch per file rather than as one opaque failure', async () => {
    const fine = write('small.txt', 'tiny');
    const huge = write('huge.bin', Buffer.alloc(2 * 1024 * 1024, 0x61));

    const run = await runCli([...host, '--json', 'push', fine, huge]);

    const result = run.json<UploadResult>();
    expect(result.accepted.map((file) => file.storedName)).toEqual(['small.txt']);
    expect(result.rejected).toEqual([{ name: 'huge.bin', reason: 'too-large' }]);
    // The accepted half really landed; the rejected half left nothing behind.
    expect(fs.existsSync(path.join(server.storageRoot, 'uploads', 'small.txt'))).toBe(true);
    expect(fs.existsSync(path.join(server.storageRoot, 'uploads', 'huge.bin'))).toBe(false);
    expect(fs.readdirSync(path.join(server.storageRoot, 'tmp'))).toEqual([]);
    // A partly-rejected batch is a partial failure, and says so.
    expect(run.exitCode).toBe(1);
  });

  it('refuses a missing path before opening a connection', async () => {
    const request = vi.spyOn(http, 'request');
    const run = await runCli([...host, 'push', path.join(workspace, 'nothing-here.txt')]);

    expect(request).not.toHaveBeenCalled();
    request.mockRestore();
    expect(run.exitCode).toBe(4);
    expect(run.stderr).toContain('no such file');
  });
});

describe('pull', () => {
  const seeded = 'the host dropped this in\n';

  beforeAll(async () => {
    const downloads = path.join(server.storageRoot, 'downloads');
    fs.mkdirSync(path.join(downloads, 'Trip'), { recursive: true });
    fs.mkdirSync(path.join(downloads, 'Work'), { recursive: true });
    fs.writeFileSync(path.join(downloads, 'shared.txt'), seeded);
    fs.writeFileSync(path.join(downloads, 'Trip', 'shared.txt'), 'in a folder');
    fs.writeFileSync(path.join(downloads, 'Trip', 'notes.txt'), 'trip notes');
    fs.writeFileSync(path.join(downloads, 'Work', 'notes.txt'), 'work notes');
    // chokidar's awaitWriteFinish debounce, then the listing settles.
    await vi.waitFor(
      async () => {
        const response = await fetch(`${server.baseUrl}/api/downloads`);
        const entries = (await response.json()) as DownloadEntry[];
        expect(entries).toHaveLength(6);
      },
      { timeout: 20_000, interval: 250 },
    );
  }, 30_000);

  it('lists today’s flat shape, folder rows included', async () => {
    const run = await runCli([...host, '--json', 'pull']);
    const entries = run.json<DownloadEntry[]>();

    expect(entries.map((entry) => `${entry.type}:${entry.parent ?? ''}/${entry.name}`).sort()).toEqual([
      'file:/shared.txt',
      'file:Trip/notes.txt',
      'file:Trip/shared.txt',
      'file:Work/notes.txt',
      'folder:/Trip',
      'folder:/Work',
    ]);
  });

  it('downloads a file byte-identical to the source', async () => {
    const destination = path.join(workspace, 'pulled.txt');
    const run = await runCli([...host, 'pull', 'Trip/shared.txt', '--out', destination]);

    expect(run.exitCode).toBe(0);
    expect(fs.readFileSync(destination, 'utf8')).toBe('in a folder');
    // Nothing half-written left over.
    expect(fs.existsSync(`${destination}.part`)).toBe(false);
  });

  it('lets the exact path win, so a root file keeps its own bare name', async () => {
    const destination = path.join(workspace, 'root-shared.txt');
    const run = await runCli([...host, 'pull', 'shared.txt', '--out', destination]);

    expect(run.exitCode).toBe(0);
    expect(fs.readFileSync(destination, 'utf8')).toBe(seeded);
  });

  it('asks which folder when a bare name matches two folders and nothing at the root', async () => {
    const run = await runCli([...host, 'pull', 'notes.txt', '--out', path.join(workspace, 'x.txt')]);

    expect(run.exitCode).toBe(4);
    expect(run.stderr).toContain('matches more than one file');
    expect(run.stderr).toContain('Trip/notes.txt');
    expect(run.stderr).toContain('Work/notes.txt');
  });

  it('refuses to overwrite a local file it did not create', async () => {
    const destination = write('already-here.txt', 'do not lose me');
    const run = await runCli([...host, 'pull', 'Trip/shared.txt', '--out', destination]);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('already exists');
    expect(fs.readFileSync(destination, 'utf8')).toBe('do not lose me');
  });

  it('reports an unknown name cleanly, not as a raw 404', async () => {
    const run = await runCli([...host, 'pull', 'nowhere.txt']);

    expect(run.exitCode).toBe(4);
    expect(run.stderr).toBe('error: no download named "nowhere.txt" — run `bifrost pull` to list them\n');
  });
});
