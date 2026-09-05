/**
 * PLAN-24 end to end, over HTTP: uploading into a folder, the flat listing the
 * two Receive views filter, previewing a nested file, and the zip.
 *
 * The archive route is exercised through a **real listen** rather than
 * `fastify.inject`, because the response is a stream with no content-length —
 * the thing worth proving is that a client reading it off the socket gets a
 * valid zip, not that a buffered payload came back.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { loadConfig } from '../../core/config/index.js';
import { createApp, type RunningApp } from '../../app.js';

const BOUNDARY = 'BifrostFolderBoundary';
const MULTIPART_HEADERS = { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` };

function multipartPayload(files: { name: string; content: string }[]): Buffer {
  const parts = files.map((file) =>
    Buffer.concat([
      Buffer.from(
        `--${BOUNDARY}\r\n` +
          `Content-Disposition: form-data; name="files"; filename="${file.name}"\r\n` +
          `Content-Type: application/octet-stream\r\n\r\n`,
      ),
      Buffer.from(file.content),
      Buffer.from('\r\n'),
    ]),
  );
  return Buffer.concat([...parts, Buffer.from(`--${BOUNDARY}--\r\n`)]);
}

interface Entry {
  id: string;
  name: string;
  size: number;
  ext: string;
  type: 'file' | 'folder';
  parent: string | null;
}

/** Central-directory file names, read straight off the zip's own end record. */
function zipEntryNames(zip: Buffer): string[] {
  const names: string[] = [];
  // Local file headers: PK\x03\x04, name length at +26, name at +30.
  for (let i = 0; i + 30 <= zip.length; i += 1) {
    if (zip.readUInt32LE(i) !== 0x04034b50) continue;
    const nameLength = zip.readUInt16LE(i + 26);
    names.push(zip.subarray(i + 30, i + 30 + nameLength).toString('utf8'));
  }
  return names;
}

describe('download folders over HTTP', () => {
  let app: RunningApp;
  let storageRoot: string;
  let origin: string;

  const listing = async (): Promise<Entry[]> =>
    (await app.fastify.inject({ method: 'GET', url: '/api/downloads' })).json();

  /** The watcher only sees a folder after chokidar's awaitWriteFinish debounce. */
  async function waitForEntry(match: (entry: Entry) => boolean): Promise<Entry> {
    const deadline = Date.now() + 15_000;
    for (;;) {
      const found = (await listing()).find(match);
      if (found) return found;
      if (Date.now() > deadline) throw new Error('entry never appeared in the listing');
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  beforeAll(async () => {
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-folders-'));
    fs.mkdirSync(path.join(storageRoot, 'downloads'), { recursive: true });
    // A folder made in Finder, files one level deep, plus one two levels deep
    // that must stay invisible (criteria 8 and 9).
    fs.mkdirSync(path.join(storageRoot, 'downloads', 'Dropped in', 'Deeper'), { recursive: true });
    fs.writeFileSync(path.join(storageRoot, 'downloads', 'Dropped in', 'note.txt'), 'by hand');
    fs.writeFileSync(
      path.join(storageRoot, 'downloads', 'Dropped in', 'Deeper', 'buried.txt'),
      'invisible',
    );
    const config = loadConfig({ HEIMDALL_PIN: '4321', STORAGE_ROOT: storageRoot });
    app = await createApp(config, { logger: pino({ level: 'silent' }) });
    await app.fastify.listen({ port: 0, host: '127.0.0.1' });
    const address = app.fastify.server.address();
    origin = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : '';
  }, 30_000);

  afterAll(async () => {
    await app.shutdown();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });

  it('reconciles a Finder-made folder one level deep, and never two', async () => {
    const entries = await listing();

    expect(entries.find((e) => e.name === 'Dropped in')).toMatchObject({
      type: 'folder',
      parent: null,
      size: 0,
      ext: '',
    });
    expect(entries.find((e) => e.name === 'note.txt')).toMatchObject({
      type: 'file',
      parent: 'Dropped in',
    });
    // Criterion 9: silently absent, not an error — and its folder too.
    expect(entries.map((e) => e.name)).not.toContain('buried.txt');
    expect(entries.map((e) => e.name)).not.toContain('Deeper');
  });

  it('uploads straight into a new folder, skipping uploads/ entirely', async () => {
    const response = await app.fastify.inject({
      method: 'POST',
      url: '/api/files?folder=Trip%20photos',
      headers: { ...MULTIPART_HEADERS, 'x-bifrost-device': 'device-a' },
      payload: multipartPayload([
        { name: 'a.jpg', content: 'first' },
        { name: 'b.jpg', content: 'second' },
      ]),
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.rejected).toEqual([]);
    expect(body.accepted).toEqual([
      { name: 'a.jpg', storedName: 'a.jpg', size: 5, folder: 'Trip photos' },
      { name: 'b.jpg', storedName: 'b.jpg', size: 6, folder: 'Trip photos' },
    ]);

    const folder = path.join(storageRoot, 'downloads', 'Trip photos');
    expect(fs.readdirSync(folder).sort()).toEqual(['a.jpg', 'b.jpg']);
    expect(fs.statSync(path.join(folder, 'a.jpg')).mode & 0o777).toBe(0o644);
    // Criterion 2: nothing staged, nothing left in tmp.
    expect(fs.readdirSync(path.join(storageRoot, 'uploads'))).toEqual([]);
    expect(fs.readdirSync(path.join(storageRoot, 'tmp'))).toEqual([]);
  });

  it('appends to the existing folder and suffixes a colliding name', async () => {
    const response = await app.fastify.inject({
      method: 'POST',
      url: '/api/files?folder=Trip%20photos',
      headers: MULTIPART_HEADERS,
      payload: multipartPayload([{ name: 'a.jpg', content: 'third' }]),
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().accepted[0].storedName).toBe('a-1.jpg');
    // Criterion 3: one folder, and the file already there is untouched.
    expect(fs.readdirSync(path.join(storageRoot, 'downloads')).sort()).toEqual([
      'Dropped in',
      'Trip photos',
    ]);
    expect(
      fs.readFileSync(path.join(storageRoot, 'downloads', 'Trip photos', 'a.jpg'), 'utf8'),
    ).toBe('first');
  });

  /** Criterion 5: a folder name that is really a root file is a clean 409. */
  it('409s an upload into a name that is already a plain file', async () => {
    fs.writeFileSync(path.join(storageRoot, 'downloads', 'Notes'), 'a file, not a folder');

    const response = await app.fastify.inject({
      method: 'POST',
      url: '/api/files?folder=Notes',
      headers: MULTIPART_HEADERS,
      payload: multipartPayload([{ name: 'a.txt', content: 'x' }]),
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: 'FOLDER_CONFLICT' });
    expect(fs.statSync(path.join(storageRoot, 'downloads', 'Notes')).isFile()).toBe(true);
    expect(fs.readdirSync(path.join(storageRoot, 'tmp'))).toEqual([]);
  });

  it('rejects a folder name with separators before it reaches the usecase', async () => {
    for (const folder of ['..%2Fescape', '.hidden', 'a%2Fb']) {
      const response = await app.fastify.inject({
        method: 'POST',
        url: `/api/files?folder=${folder}`,
        headers: MULTIPART_HEADERS,
        payload: multipartPayload([{ name: 'a.txt', content: 'x' }]),
      });
      expect(response.statusCode, folder).toBe(400);
    }
  });

  it('serves and previews a file that lives inside a folder', async () => {
    const nested = await waitForEntry((e) => e.name === 'a.jpg' && e.parent === 'Trip photos');

    const content = await app.fastify.inject({
      method: 'GET',
      url: `/api/downloads/${nested.id}/content`,
    });
    expect(content.statusCode).toBe(200);
    expect(content.body).toBe('first');
    expect(content.headers['content-disposition']).toContain('a.jpg');

    // The previews module re-derives the same id from its own scan (criterion 19).
    const meta = await app.fastify.inject({
      method: 'GET',
      url: `/api/downloads/${nested.id}/meta`,
    });
    expect(meta.statusCode).toBe(200);
    // The base name, never the folder-qualified one — that is what the modal titles.
    expect(meta.json()).toMatchObject({ name: 'a.jpg', size: 5 });
  }, 20_000);

  /** Criterion 13, the other half: a folder id asking for bytes is a clean 404. */
  it('404s /content on a folder id', async () => {
    const folder = await waitForEntry((e) => e.name === 'Trip photos' && e.type === 'folder');

    const response = await app.fastify.inject({
      method: 'GET',
      url: `/api/downloads/${folder.id}/content`,
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'NOT_FOUND', message: 'file not found' });
  }, 20_000);

  it('400s /archive on a file id', async () => {
    const file = await waitForEntry((e) => e.name === 'a.jpg');

    const response = await app.fastify.inject({
      method: 'GET',
      url: `/api/downloads/${file.id}/archive`,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'NOT_A_FOLDER' });
  }, 20_000);

  it('streams a zip of exactly that folder’s files, named as they sit inside it', async () => {
    const folder = await waitForEntry((e) => e.name === 'Trip photos' && e.type === 'folder');
    await waitForEntry((e) => e.name === 'a-1.jpg' && e.parent === 'Trip photos');

    const response = await fetch(`${origin}/api/downloads/${folder.id}/archive`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/zip');
    expect(response.headers.get('content-disposition')).toContain('attachment');
    expect(response.headers.get('content-disposition')).toContain('Trip%20photos.zip');
    // Chunked, because the final size is unknown until finalize() completes.
    expect(response.headers.get('content-length')).toBeNull();

    const zip = Buffer.from(await response.arrayBuffer());
    expect(zip.subarray(0, 2).toString()).toBe('PK');
    expect(zipEntryNames(zip).sort()).toEqual(['a-1.jpg', 'a.jpg', 'b.jpg']);
    // Never the two-levels-deep file the watcher does not index.
    expect(zipEntryNames(zip)).not.toContain('buried.txt');
  }, 30_000);

  it('answers an empty folder with a valid, empty zip rather than an error', async () => {
    fs.mkdirSync(path.join(storageRoot, 'downloads', 'Empty'));
    const folder = await waitForEntry((e) => e.name === 'Empty' && e.type === 'folder');

    const response = await fetch(`${origin}/api/downloads/${folder.id}/archive`);

    expect(response.status).toBe(200);
    const zip = Buffer.from(await response.arrayBuffer());
    expect(zip.subarray(0, 2).toString()).toBe('PK');
    expect(zipEntryNames(zip)).toEqual([]);
  }, 30_000);

  it('drops a folder and its children from the listing when it is removed', async () => {
    fs.rmSync(path.join(storageRoot, 'downloads', 'Dropped in'), { recursive: true, force: true });

    const deadline = Date.now() + 15_000;
    for (;;) {
      const names = (await listing()).map((e) => e.name);
      if (!names.includes('Dropped in') && !names.includes('note.txt')) break;
      if (Date.now() > deadline) throw new Error('folder and children never left the listing');
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }, 20_000);

  it('leaves the plain staging upload exactly as it was', async () => {
    const response = await app.fastify.inject({
      method: 'POST',
      url: '/api/files',
      headers: MULTIPART_HEADERS,
      payload: multipartPayload([{ name: 'staged.txt', content: 'waiting' }]),
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().accepted[0]).toEqual({
      name: 'staged.txt',
      storedName: 'staged.txt',
      size: 7,
    });
    // Criterion 1: still in uploads/, still needing a Move.
    expect(fs.readdirSync(path.join(storageRoot, 'uploads'))).toEqual(['staged.txt']);
  });
});
