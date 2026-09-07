import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startLiveServer, type LiveServer } from './test/liveServer.js';
import { runCli } from './test/runCli.js';
import type { DownloadEntry, PullResult, UploadResult } from './core/files.js';

/**
 * `push` and `pull` against a real listening server, because a multipart upload
 * from a real file on disk is exactly what `fastify.inject` does not cover.
 */

let server: LiveServer;
let workspace: string;
let host: string[];

/** Where the CLI writes when it is not told otherwise. */
async function inCwd<T>(directory: string, run: () => Promise<T>): Promise<T> {
  const previous = process.cwd();
  process.chdir(directory);
  try {
    // Awaited inside the window, not returned from it: restoring the directory
    // while the command is still running is how the first draft of this helper
    // made every relative path resolve against the wrong place.
    return await run();
  } finally {
    process.chdir(previous);
  }
}

beforeAll(async () => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-cli-files-'));
  process.env.XDG_CONFIG_HOME = path.join(workspace, 'config');
  // A 1 MB cap makes the mixed accepted/rejected batch reachable without
  // writing gigabytes; a 2-file cap makes the batching path reachable at all.
  server = await startLiveServer({ MAX_UPLOAD_SIZE_MB: '1', MAX_FILES_PER_UPLOAD: '2' });
  host = ['--host', server.baseUrl];
}, 90_000);

afterAll(async () => {
  await server.stop();
  delete process.env.XDG_CONFIG_HOME;
  fs.rmSync(workspace, { recursive: true, force: true });
});

function write(name: string, contents: string | Buffer): string {
  const file = path.join(workspace, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  return file;
}

const uploads = (): string[] => fs.readdirSync(path.join(server.storageRoot, 'uploads')).sort();

describe('push', () => {
  it('lands the file in uploads/ exactly as a browser upload does', async () => {
    const source = write('notes.txt', 'hello from the cli');
    const run = await runCli([...host, '--json', 'push', source]);

    expect(run.exitCode).toBe(0);
    const result = run.json<UploadResult>();
    expect(result.rejected).toEqual([]);
    expect(result.accepted).toEqual([{ name: 'notes.txt', storedName: 'notes.txt', size: 18 }]);

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

  it('splits past MAX_FILES_PER_UPLOAD instead of failing the whole batch', async () => {
    // The server aborts the *entire* request past its cap, so a 5-file push
    // with a cap of 2 has to become three requests — otherwise nothing lands.
    const files = ['b1.txt', 'b2.txt', 'b3.txt', 'b4.txt', 'b5.txt'].map((name) =>
      write(`batch/${name}`, name),
    );
    const request = vi.spyOn(http, 'request');

    const run = await runCli([...host, '--json', 'push', ...files]);

    expect(request).toHaveBeenCalledTimes(3);
    request.mockRestore();
    const result = run.json<UploadResult>();
    expect(result.rejected).toEqual([]);
    expect(result.accepted.map((file) => file.storedName).sort()).toEqual([
      'b1.txt',
      'b2.txt',
      'b3.txt',
      'b4.txt',
      'b5.txt',
    ]);
    expect(uploads()).toEqual(expect.arrayContaining(['b1.txt', 'b5.txt']));
  });

  it('expands a directory to the files directly in it, skipping hidden and nested', async () => {
    write('shoebox/box-one.txt', '1');
    write('shoebox/box-two.txt', '2');
    write('shoebox/.secret', 'no');
    write('shoebox/deeper/box-three.txt', '3');

    // Human mode: the skip notes are stderr chatter, which --json silences.
    const run = await runCli([...host, 'push', path.join(workspace, 'shoebox')]);

    expect(run.exitCode).toBe(0);
    expect(uploads()).toEqual(expect.arrayContaining(['box-one.txt', 'box-two.txt']));
    expect(run.stdout).toContain('box-one.txt');
    expect(run.stderr).toContain('skipped 1 hidden file');
    expect(run.stderr).toContain('skipped 1 sub-folder');
    expect(uploads()).not.toContain('.secret');
    expect(uploads()).not.toContain('box-three.txt');
  });

  it('pushes the working directory with `.`', async () => {
    const here = path.join(workspace, 'pwd-test');
    fs.mkdirSync(here, { recursive: true });
    fs.writeFileSync(path.join(here, 'here-a.txt'), 'a');
    fs.writeFileSync(path.join(here, 'here-b.txt'), 'b');

    const run = await inCwd(here, () => runCli([...host, '--json', 'push', '.']));

    expect(run.exitCode).toBe(0);
    expect(run.json<UploadResult>().accepted.map((file) => file.storedName).sort()).toEqual([
      'here-a.txt',
      'here-b.txt',
    ]);
  });

  it('--dir writes straight into a Downloads folder, creating it', async () => {
    const source = write('trip.txt', 'straight through');

    const run = await runCli([...host, '--json', 'push', source, '--dir', 'Holiday']);

    expect(run.exitCode).toBe(0);
    const result = run.json<UploadResult>();
    expect(result.accepted[0]?.folder).toBe('Holiday');
    // It skipped staging entirely: in downloads/, not uploads/.
    const landed = path.join(server.storageRoot, 'downloads', 'Holiday', 'trip.txt');
    expect(fs.readFileSync(landed, 'utf8')).toBe('straight through');
    expect(uploads()).not.toContain('trip.txt');
    // The note is stderr chatter, which --json deliberately silences — so the
    // human-mode run is where it is asserted.
    expect(run.stderr).toBe('');

    const human = await runCli([...host, 'push', write('trip1b.txt', 'again'), '--dir', 'Holiday']);
    expect(human.stderr).toContain('live on Downloads');
  });

  it('--dir appends to a folder that already exists rather than duplicating it', async () => {
    const second = write('trip2.txt', 'second file');

    await runCli([...host, '--json', 'push', second, '-d', 'Holiday']);

    // trip1b.txt came from the human-mode run in the test above — the point
    // here is that all three share ONE Holiday folder rather than minting
    // Holiday-1, Holiday-2 alongside it.
    const folder = fs.readdirSync(path.join(server.storageRoot, 'downloads', 'Holiday')).sort();
    expect(folder).toEqual(['trip.txt', 'trip1b.txt', 'trip2.txt']);
    expect(fs.readdirSync(path.join(server.storageRoot, 'downloads'))).toContain('Holiday');
    expect(fs.readdirSync(path.join(server.storageRoot, 'downloads'))).not.toContain('Holiday-1');
  });

  it('reports a mixed batch per file rather than as one opaque failure', async () => {
    const fine = write('small.txt', 'tiny');
    const huge = write('huge.bin', Buffer.alloc(2 * 1024 * 1024, 0x61));

    const run = await runCli([...host, '--json', 'push', fine, huge]);

    const result = run.json<UploadResult>();
    expect(result.accepted.map((file) => file.storedName)).toEqual(['small.txt']);
    expect(result.rejected).toEqual([{ name: 'huge.bin', reason: 'too-large' }]);
    // The accepted half really landed; the rejected half left nothing behind.
    expect(uploads()).toContain('small.txt');
    expect(uploads()).not.toContain('huge.bin');
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
    expect(run.stderr).toContain('no such file or folder');
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
    // chokidar's awaitWriteFinish debounce, then the listing settles. Holiday/
    // and its two files came from the --dir pushes above.
    // Asserting the seeded rows are present, not a total: the --dir tests above
    // put their own files in Downloads too, and a count would couple these two
    // blocks together for no reason.
    await vi.waitFor(
      async () => {
        const response = await fetch(`${server.baseUrl}/api/downloads`);
        const entries = (await response.json()) as DownloadEntry[];
        const seen = new Set(entries.map((entry) => `${entry.type}:${entry.parent ?? ''}/${entry.name}`));
        for (const wanted of [
          'file:/shared.txt',
          'file:Trip/shared.txt',
          'file:Trip/notes.txt',
          'file:Work/notes.txt',
          'folder:/Trip',
          'folder:/Work',
        ]) {
          expect(seen).toContain(wanted);
        }
      },
      { timeout: 20_000, interval: 250 },
    );
  }, 30_000);

  it('lists today’s flat shape, folder rows included, under --list', async () => {
    const run = await runCli([...host, '--json', 'pull', '--list']);
    const entries = run.json<DownloadEntry[]>();

    expect(
      entries.map((entry) => `${entry.type}:${entry.parent ?? ''}/${entry.name}`).sort(),
    ).toEqual([
      'file:/shared.txt',
      'file:Holiday/trip.txt',
      'file:Holiday/trip1b.txt',
      'file:Holiday/trip2.txt',
      'file:Trip/notes.txt',
      'file:Trip/shared.txt',
      'file:Work/notes.txt',
      'folder:/Holiday',
      'folder:/Trip',
      'folder:/Work',
    ]);
  });

  it('lists the same way with -l and with no argument at all', async () => {
    const short = await runCli([...host, '--json', 'pull', '-l']);
    const bare = await runCli([...host, '--json', 'pull']);

    expect(short.json<DownloadEntry[]>()).toEqual(bare.json<DownloadEntry[]>());
  });

  it('shows a folder with no size of its own, and its files with theirs', async () => {
    const run = await runCli([...host, 'pull', '--list']);

    const folderRow = run.stdout.split('\n').find((line) => line.includes('Trip ') && line.includes('folder'));
    expect(folderRow).toContain('—');
    expect(run.stdout).toContain('shared.txt');
    expect(run.stdout).toMatch(/\d+ B/);
  });

  it('downloads a file byte-identical to the source', async () => {
    const destination = path.join(workspace, 'pulled.txt');
    const run = await runCli([...host, 'pull', 'Trip/shared.txt', '--out', destination]);

    expect(run.exitCode).toBe(0);
    expect(fs.readFileSync(destination, 'utf8')).toBe('in a folder');
    // Nothing half-written left over.
    expect(fs.existsSync(`${destination}.part`)).toBe(false);
  });

  it('downloads a folder as a zip named after it', async () => {
    const into = path.join(workspace, 'zips');
    fs.mkdirSync(into, { recursive: true });

    const run = await inCwd(into, () => runCli([...host, '--json', 'pull', 'Trip']));

    expect(run.exitCode).toBe(0);
    const results = run.json<PullResult[]>();
    expect(results).toHaveLength(1);
    expect(results[0]?.type).toBe('folder');
    expect(results[0]?.path).toBe('Trip.zip');

    const archive = fs.readFileSync(path.join(into, 'Trip.zip'));
    expect(archive.length).toBeGreaterThan(0);
    // A real zip, not an error page: PK\x03\x04 is the local file header magic.
    expect(archive.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  });

  it('takes several names at once, mixing files and folders', async () => {
    const into = path.join(workspace, 'many');
    fs.mkdirSync(into, { recursive: true });

    const run = await inCwd(into, () =>
      runCli([...host, '--json', 'pull', 'shared.txt', 'Trip/notes.txt', 'Work']),
    );

    expect(run.exitCode).toBe(0);
    expect(run.json<PullResult[]>().map((row) => row.path)).toEqual([
      'shared.txt',
      'notes.txt',
      'Work.zip',
    ]);
    expect(fs.readdirSync(into).sort()).toEqual(['Work.zip', 'notes.txt', 'shared.txt']);
    expect(fs.readFileSync(path.join(into, 'shared.txt'), 'utf8')).toBe(seeded);
  });

  it('refuses --out with more than one name, since it names one destination', async () => {
    const run = await runCli([...host, 'pull', 'shared.txt', 'Trip', '--out', '/tmp/x']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('--out names one destination');
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
    expect(run.stderr).toContain('matches more than one entry');
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
    expect(run.stderr).toContain('nothing called "nowhere.txt" is on offer');
    expect(run.stderr).toContain('bifrost pull --list');
  });
});
