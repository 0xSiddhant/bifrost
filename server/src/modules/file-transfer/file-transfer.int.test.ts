import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { loadConfig } from '../../core/config/index.js';
import { createApp, type RunningApp } from '../../app.js';

const BOUNDARY = 'BifrostTestBoundary';

function multipartPayload(files: { name: string; content: Buffer | string }[]): Buffer {
  const parts = files.map((file) =>
    Buffer.concat([
      Buffer.from(
        `--${BOUNDARY}\r\n` +
          `Content-Disposition: form-data; name="files"; filename="${file.name}"\r\n` +
          `Content-Type: application/octet-stream\r\n\r\n`,
      ),
      Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content),
      Buffer.from('\r\n'),
    ]),
  );
  return Buffer.concat([...parts, Buffer.from(`--${BOUNDARY}--\r\n`)]);
}

const MULTIPART_HEADERS = { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` };

describe('file-transfer over HTTP', () => {
  let app: RunningApp;
  let storageRoot: string;

  beforeAll(async () => {
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-ft-'));
    // Pre-seed downloads/ — the boot scan must reconcile it into the listing.
    fs.mkdirSync(path.join(storageRoot, 'downloads'), { recursive: true });
    fs.writeFileSync(path.join(storageRoot, 'downloads', 'seeded.txt'), 'from the host');
    const config = loadConfig({
      HEIMDALL_PIN: '4321',
      STORAGE_ROOT: storageRoot,
      MAX_UPLOAD_SIZE_MB: '1',
      MAX_FILES_PER_UPLOAD: '3',
    });
    app = await createApp(config, { logger: pino({ level: 'silent' }) });
  });

  afterAll(async () => {
    await app.shutdown();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });

  it('accepts a multi-file upload: sanitized timestamped names, mode 0644, empty tmp', async () => {
    const response = await app.fastify.inject({
      method: 'POST',
      url: '/api/files',
      headers: MULTIPART_HEADERS,
      payload: multipartPayload([
        { name: 'notes.txt', content: 'hello bifrost' },
        { name: '../../escape.txt', content: 'trying to climb' },
      ]),
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.rejected).toEqual([]);
    expect(body.accepted).toHaveLength(2);
    expect(body.accepted[0].storedName).toMatch(/^\d{13}-notes\.txt$/);
    expect(body.accepted[1].storedName).toMatch(/^\d{13}-escape\.txt$/);

    for (const accepted of body.accepted) {
      const filePath = path.join(storageRoot, 'uploads', accepted.storedName);
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.statSync(filePath).mode & 0o777).toBe(0o644);
    }
    const tmpLeft = fs.readdirSync(path.join(storageRoot, 'tmp'));
    expect(tmpLeft).toEqual([]);
  });

  it('rejects an oversize file with 413 and leaves nothing behind', async () => {
    const uploadsBefore = fs.readdirSync(path.join(storageRoot, 'uploads'));
    const response = await app.fastify.inject({
      method: 'POST',
      url: '/api/files',
      headers: MULTIPART_HEADERS,
      payload: multipartPayload([{ name: 'big.bin', content: Buffer.alloc(1.5 * 1024 * 1024) }]),
    });

    expect(response.statusCode).toBe(413);
    expect(response.json().rejected).toEqual([{ name: 'big.bin', reason: 'too-large' }]);
    expect(fs.readdirSync(path.join(storageRoot, 'uploads'))).toEqual(uploadsBefore);
    expect(fs.readdirSync(path.join(storageRoot, 'tmp'))).toEqual([]);
  });

  it('keeps the good file in a mixed batch (201 + per-file rejection)', async () => {
    const response = await app.fastify.inject({
      method: 'POST',
      url: '/api/files',
      headers: MULTIPART_HEADERS,
      payload: multipartPayload([
        { name: 'small.txt', content: 'fits' },
        { name: 'big.bin', content: Buffer.alloc(1.5 * 1024 * 1024) },
      ]),
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.accepted).toHaveLength(1);
    expect(body.accepted[0].name).toBe('small.txt');
    expect(body.rejected).toEqual([{ name: 'big.bin', reason: 'too-large' }]);
  });

  it('rejects blocklisted extensions per file', async () => {
    const response = await app.fastify.inject({
      method: 'POST',
      url: '/api/files',
      headers: MULTIPART_HEADERS,
      payload: multipartPayload([{ name: 'setup.exe', content: 'MZ' }]),
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      accepted: [],
      rejected: [{ name: 'setup.exe', reason: 'blocked-extension' }],
    });
  });

  it('rejects a declared body far beyond the caps before streaming (413)', async () => {
    const response = await app.fastify.inject({
      method: 'POST',
      url: '/api/files',
      headers: {
        ...MULTIPART_HEADERS,
        // 3 files × 1 MB cap + overhead ≈ 4 MB — declare 100 MB.
        'content-length': String(100 * 1024 * 1024),
      },
      payload: multipartPayload([{ name: 'liar.bin', content: 'tiny' }]),
    });
    expect(response.statusCode).toBe(413);
    expect(response.json().error).toBe('PAYLOAD_TOO_LARGE');
  });

  it('serves the upload config the client validates against', async () => {
    const response = await app.fastify.inject({ method: 'GET', url: '/api/files/config' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      maxUploadSizeMb: 1,
      maxFilesPerUpload: 3,
      blockedExtensions: ['.exe', '.bat', '.cmd', '.msi'],
    });
  });

  it('exposes no read route for uploads/ under any pattern', async () => {
    const stored = fs.readdirSync(path.join(storageRoot, 'uploads'))[0];
    // API routes must 404; non-API paths may fall back to the SPA shell when
    // a client build exists — either way, uploaded bytes must never come back.
    const apiProbes = ['/api/uploads', `/api/uploads/${stored}`, '/api/files', `/api/files/${stored}`];
    for (const url of apiProbes) {
      const response = await app.fastify.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(404);
    }
    const staticProbes = [`/uploads/${stored}`, `/storage/uploads/${stored}`];
    for (const url of staticProbes) {
      const response = await app.fastify.inject({ method: 'GET', url });
      expect([200, 404], url).toContain(response.statusCode);
      expect(response.body, url).not.toContain('hello bifrost');
      if (response.statusCode === 200) {
        expect(response.headers['content-type'], url).toContain('text/html');
      }
    }
  });

  it('lists downloads reconciled from the boot scan, sorted by mtime desc', async () => {
    const response = await app.fastify.inject({ method: 'GET', url: '/api/downloads' });
    expect(response.statusCode).toBe(200);
    const list = response.json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'seeded.txt', ext: '.txt', size: 13 });
    expect(list[0].id).toMatch(/^[A-Za-z0-9_-]{16}$/);
  });

  it('streams a download by id with attachment disposition', async () => {
    const listing = await app.fastify.inject({ method: 'GET', url: '/api/downloads' });
    const { id } = listing.json()[0];
    const response = await app.fastify.inject({
      method: 'GET',
      url: `/api/downloads/${id}/content`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('from the host');
    expect(response.headers['content-disposition']).toContain('attachment');
    expect(response.headers['content-disposition']).toContain('seeded.txt');
    expect(Number(response.headers['content-length'])).toBe(13);
  });

  it('refuses traversal on the download route — the path never escapes downloads/', async () => {
    const probes = [
      '/api/downloads/..%2f..%2fdata%2fapp.db/content',
      '/api/downloads/%2e%2e%2fapp.db/content',
      '/api/downloads/AAAAAAAAAAAAAAAAAAAA/content', // wrong length
      '/api/downloads/no.dots.allowed!/content',
    ];
    for (const url of probes) {
      const response = await app.fastify.inject({ method: 'GET', url });
      expect([400, 404], url).toContain(response.statusCode);
    }
    // A raw ../ URL is dot-normalized off the API prefix before routing and can
    // only ever reach the SPA fallback — never a byte of the database file.
    const raw = await app.fastify.inject({
      method: 'GET',
      url: '/api/downloads/../../data/app.db/content',
    });
    expect([200, 404]).toContain(raw.statusCode);
    expect(raw.body).not.toContain('SQLite');
    if (raw.statusCode === 200) {
      expect(raw.headers['content-type']).toContain('text/html');
    }
    // A well-formed but unknown id is a clean 404.
    const unknown = await app.fastify.inject({
      method: 'GET',
      url: '/api/downloads/abcdefgh12345678/content',
    });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toEqual({ error: 'NOT_FOUND', message: 'file not found' });
  });

  it('rate-limits the upload route per IP with a clean 429', async () => {
    // Separate app: a tiny limit that the other tests' uploads don't consume.
    const limitedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-rl-'));
    const limited = await createApp(
      loadConfig({
        HEIMDALL_PIN: '4321',
        STORAGE_ROOT: limitedRoot,
        UPLOAD_RATE_LIMIT_PER_MIN: '2',
      }),
      { logger: pino({ level: 'silent' }) },
    );
    try {
      const post = () =>
        limited.fastify.inject({
          method: 'POST',
          url: '/api/files',
          headers: MULTIPART_HEADERS,
          payload: multipartPayload([{ name: 'ping.txt', content: 'x' }]),
        });
      expect((await post()).statusCode).toBe(201);
      expect((await post()).statusCode).toBe(201);
      const throttled = await post();
      expect(throttled.statusCode).toBe(429);
      expect(throttled.json().message).toContain('Rate limit exceeded');
      // Reads are not throttled.
      const listing = await limited.fastify.inject({ method: 'GET', url: '/api/downloads' });
      expect(listing.statusCode).toBe(200);
    } finally {
      await limited.shutdown();
      fs.rmSync(limitedRoot, { recursive: true, force: true });
    }
  });

  it('400s a non-multipart POST and an empty multipart', async () => {
    const plain = await app.fastify.inject({
      method: 'POST',
      url: '/api/files',
      headers: { 'content-type': 'application/json' },
      payload: { nope: true },
    });
    expect(plain.statusCode).toBe(400);

    const empty = await app.fastify.inject({
      method: 'POST',
      url: '/api/files',
      headers: MULTIPART_HEADERS,
      payload: multipartPayload([]),
    });
    expect(empty.statusCode).toBe(400);
  });
});
