import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { loadConfig } from '../../core/config/index.js';
import { createApp, type RunningApp } from '../../app.js';

/** Real files (a genuine 1x1 PNG) so file-type sniffing works on tiny fixtures. */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const MP4_BYTES = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from('ftypisom'),
  Buffer.alloc(64),
]);

describe('previews + qr-tool over HTTP', () => {
  let app: RunningApp;
  let storageRoot: string;

  const seed = (name: string, content: Buffer | string) =>
    fs.writeFileSync(path.join(storageRoot, 'downloads', name), content);

  const idOf = async (name: string): Promise<string> => {
    const listing = await app.fastify.inject({ method: 'GET', url: '/api/downloads' });
    const entry = (listing.json() as { id: string; name: string }[]).find(
      (candidate) => candidate.name === name,
    );
    if (!entry) throw new Error(`${name} not in listing`);
    return entry.id;
  };

  const metaOf = async (name: string) => {
    const response = await app.fastify.inject({
      method: 'GET',
      url: `/api/downloads/${await idOf(name)}/meta`,
    });
    expect(response.statusCode).toBe(200);
    return response.json();
  };

  beforeAll(async () => {
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-prev-'));
    fs.mkdirSync(path.join(storageRoot, 'downloads'), { recursive: true });
    seed('notes.md', '# Hello\n\nsome *markdown*');
    seed('photo-lying.txt', PNG_BYTES); // png bytes behind a .txt extension
    seed('clip.mp4', MP4_BYTES);
    seed('junk.bin', Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x00]));
    seed('huge.txt', 'x'.repeat(1024 * 1024 + 10));
    seed('range-target.txt', 'from the host'); // 13 bytes
    const config = loadConfig({ HEIMDALL_PIN: '4321', STORAGE_ROOT: storageRoot });
    app = await createApp(config, { logger: pino({ level: 'silent' }) });
  });

  afterAll(async () => {
    await app.shutdown();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });

  describe('meta endpoint', () => {
    it('resolves markdown by extension', async () => {
      expect(await metaOf('notes.md')).toMatchObject({
        previewable: true,
        kind: 'markdown',
        name: 'notes.md',
      });
    });

    it('lets sniffed bytes beat a lying extension', async () => {
      expect(await metaOf('photo-lying.txt')).toMatchObject({
        previewable: true,
        kind: 'image',
        mime: 'image/png',
      });
    });

    it('detects video and rejects unknown binaries', async () => {
      expect((await metaOf('clip.mp4')).kind).toBe('video');
      expect(await metaOf('junk.bin')).toMatchObject({ previewable: false, kind: 'none' });
    });

    it('marks oversized text as not previewable', async () => {
      expect(await metaOf('huge.txt')).toMatchObject({ previewable: false, kind: 'text' });
    });

    it('404s unknown and malformed ids', async () => {
      const unknown = await app.fastify.inject({
        method: 'GET',
        url: '/api/downloads/abcdefgh12345678/meta',
      });
      expect(unknown.statusCode).toBe(404);
      const malformed = await app.fastify.inject({
        method: 'GET',
        url: '/api/downloads/short/meta',
      });
      expect(malformed.statusCode).toBe(400);
    });
  });

  describe('range streaming on the content route', () => {
    const content = (id: string, headers: Record<string, string> = {}, query = '') =>
      app.fastify.inject({ method: 'GET', url: `/api/downloads/${id}/content${query}`, headers });

    it('serves 200 with accept-ranges when no Range header is sent', async () => {
      const response = await content(await idOf('range-target.txt'));
      expect(response.statusCode).toBe(200);
      expect(response.headers['accept-ranges']).toBe('bytes');
      expect(response.body).toBe('from the host');
    });

    it('serves a bounded range as 206 with correct Content-Range', async () => {
      const response = await content(await idOf('range-target.txt'), { range: 'bytes=0-4' });
      expect(response.statusCode).toBe(206);
      expect(response.body).toBe('from ');
      expect(response.headers['content-range']).toBe('bytes 0-4/13');
      expect(Number(response.headers['content-length'])).toBe(5);
    });

    it('serves open-ended and suffix ranges', async () => {
      const id = await idOf('range-target.txt');
      const open = await content(id, { range: 'bytes=5-' });
      expect(open.statusCode).toBe(206);
      expect(open.body).toBe('the host');
      expect(open.headers['content-range']).toBe('bytes 5-12/13');

      const suffix = await content(id, { range: 'bytes=-4' });
      expect(suffix.statusCode).toBe(206);
      expect(suffix.body).toBe('host');
      expect(suffix.headers['content-range']).toBe('bytes 9-12/13');
    });

    it('416s an out-of-bounds range with the total size', async () => {
      const response = await content(await idOf('range-target.txt'), { range: 'bytes=999-' });
      expect(response.statusCode).toBe(416);
      expect(response.headers['content-range']).toBe('bytes */13');
    });

    it('ignores malformed Range headers and serves the full file', async () => {
      const response = await content(await idOf('range-target.txt'), { range: 'bytes=nope' });
      expect(response.statusCode).toBe(200);
      expect(response.body).toBe('from the host');
    });

    it('switches disposition and mime with ?inline=1', async () => {
      const id = await idOf('range-target.txt');
      const inline = await content(id, {}, '?inline=1');
      expect(inline.headers['content-disposition']).toContain('inline');
      expect(inline.headers['content-type']).toContain('text/plain');

      const attachment = await content(id);
      expect(attachment.headers['content-disposition']).toContain('attachment');
      expect(attachment.headers['content-type']).toContain('application/octet-stream');
    });
  });

  describe('qr-tool', () => {
    it('lists every server url, mdns included for the local profile', async () => {
      const response = await app.fastify.inject({ method: 'GET', url: '/api/qr/server-url' });
      expect(response.statusCode).toBe(200);
      const { urls } = response.json() as { urls: string[] };
      expect(urls.length).toBeGreaterThan(0);
      expect(urls.every((url) => url.startsWith('http://'))).toBe(true);
      expect(urls.some((url) => url.includes('.local:'))).toBe(true);
    });
  });
});
