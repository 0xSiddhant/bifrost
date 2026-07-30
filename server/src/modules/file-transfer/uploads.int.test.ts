/**
 * PLAN-17b: uploads/ stops being write-only. These are the four actions a
 * sender can take on a staged file, plus the traversal and stale-card matrices
 * that decide whether the UI can trust the answers.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { loadConfig } from '../../core/config/index.js';
import { createApp, type RunningApp } from '../../app.js';

describe('uploads staging actions over HTTP', () => {
  let app: RunningApp;
  let storageRoot: string;
  let uploads: string;
  let downloads: string;

  const seed = (name: string, content = 'staged bytes'): void => {
    fs.writeFileSync(path.join(uploads, name), content);
  };

  beforeAll(async () => {
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-staging-'));
    uploads = path.join(storageRoot, 'uploads');
    downloads = path.join(storageRoot, 'downloads');
    fs.mkdirSync(uploads, { recursive: true });
    fs.mkdirSync(downloads, { recursive: true });
    app = await createApp(loadConfig({ HEIMDALL_PIN: '4321', STORAGE_ROOT: storageRoot }), {
      logger: pino({ level: 'silent' }),
    });
  });

  afterAll(async () => {
    await app.shutdown();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    for (const dir of [uploads, downloads]) {
      for (const name of fs.readdirSync(dir)) fs.rmSync(path.join(dir, name), { force: true });
    }
  });

  describe('publish', () => {
    it('moves the file to downloads/', async () => {
      seed('report.pdf', 'the report');

      const res = await app.fastify.inject({
        method: 'POST',
        url: '/api/files/report.pdf/publish',
        headers: { 'x-bifrost-device': 'device-a' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ finalName: 'report.pdf', renamed: false });
      // Exactly one location — never both, never neither (criterion 15). The
      // event this also fires is asserted where the SSE hub is observable
      // (watcher-sse.int.test.ts).
      expect(fs.existsSync(path.join(uploads, 'report.pdf'))).toBe(false);
      expect(fs.readFileSync(path.join(downloads, 'report.pdf'), 'utf8')).toBe('the report');
    });

    it('disambiguates against downloads/ and says so', async () => {
      fs.writeFileSync(path.join(downloads, 'report.pdf'), 'already here');
      seed('report.pdf', 'the new one');

      const res = await app.fastify.inject({
        method: 'POST',
        url: '/api/files/report.pdf/publish',
      });

      expect(res.json()).toEqual({ finalName: 'report-1.pdf', renamed: true });
      expect(fs.readFileSync(path.join(downloads, 'report.pdf'), 'utf8')).toBe('already here');
      expect(fs.readFileSync(path.join(downloads, 'report-1.pdf'), 'utf8')).toBe('the new one');
    });

    // Criterion 12: a stale card in a second tab asks for a file that is gone.
    it('404s a file that has already been published', async () => {
      seed('once.txt');
      const first = await app.fastify.inject({
        method: 'POST',
        url: '/api/files/once.txt/publish',
      });
      expect(first.statusCode).toBe(200);

      const second = await app.fastify.inject({
        method: 'POST',
        url: '/api/files/once.txt/publish',
      });
      expect(second.statusCode).toBe(404);
      expect(second.json()).toMatchObject({ error: 'NOT_FOUND' });
    });

    it('409s a second publish while the first is still in flight', async () => {
      seed('slow.bin', 'x'.repeat(64));
      const both = await Promise.all([
        app.fastify.inject({ method: 'POST', url: '/api/files/slow.bin/publish' }),
        app.fastify.inject({ method: 'POST', url: '/api/files/slow.bin/publish' }),
      ]);
      const codes = both.map((res) => res.statusCode).sort();

      // Whichever loses the race must lose it cleanly: 409 or 404, never a 500
      // and never two copies in downloads/.
      expect(codes[0]).toBe(200);
      expect([404, 409]).toContain(codes[1]);
      expect(fs.readdirSync(downloads)).toEqual(['slow.bin']);
    });
  });

  describe('rename', () => {
    it('renames within uploads/', async () => {
      seed('IMG_1153.png', 'a photo');

      const res = await app.fastify.inject({
        method: 'PATCH',
        url: '/api/files/IMG_1153.png',
        payload: { name: 'birthday.png' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ finalName: 'birthday.png', renamed: false });
      expect(fs.readdirSync(uploads)).toEqual(['birthday.png']);
      expect(fs.readFileSync(path.join(uploads, 'birthday.png'), 'utf8')).toBe('a photo');
    });

    it('suffixes when the new name is taken, reporting renamed: true', async () => {
      seed('taken.txt', 'first');
      seed('other.txt', 'second');

      const res = await app.fastify.inject({
        method: 'PATCH',
        url: '/api/files/other.txt',
        payload: { name: 'taken.txt' },
      });

      expect(res.json()).toEqual({ finalName: 'taken-1.txt', renamed: true });
      expect(fs.readFileSync(path.join(uploads, 'taken.txt'), 'utf8')).toBe('first');
      expect(fs.readFileSync(path.join(uploads, 'taken-1.txt'), 'utf8')).toBe('second');
    });

    // Criterion 8: never silently altered — refused, with the clean name shown.
    it('422s a name the sanitizer would change, handing back what it would use', async () => {
      seed('doc.txt');

      const res = await app.fastify.inject({
        method: 'PATCH',
        url: '/api/files/doc.txt',
        payload: { name: '../../etc/passwd' },
      });

      expect(res.statusCode).toBe(422);
      expect(res.json()).toMatchObject({
        error: 'BAD_NAME',
        details: { suggestion: 'etc_passwd' },
      });
      expect(fs.readdirSync(uploads)).toEqual(['doc.txt']);
    });

    it('404s a rename of something that is gone', async () => {
      const res = await app.fastify.inject({
        method: 'PATCH',
        url: '/api/files/ghost.txt',
        payload: { name: 'still-a-ghost.txt' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('delete', () => {
    it('removes the file and answers 204', async () => {
      seed('mistake.txt');
      const res = await app.fastify.inject({ method: 'DELETE', url: '/api/files/mistake.txt' });

      expect(res.statusCode).toBe(204);
      expect(fs.readdirSync(uploads)).toEqual([]);
    });

    it('404s a delete of something already gone', async () => {
      const res = await app.fastify.inject({ method: 'DELETE', url: '/api/files/ghost.txt' });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('preview + content', () => {
    it('serves metadata and bytes for a staged upload', async () => {
      seed('notes.txt', 'plain words');

      const meta = await app.fastify.inject({ method: 'GET', url: '/api/files/notes.txt/preview' });
      expect(meta.statusCode).toBe(200);
      expect(meta.json()).toMatchObject({
        previewable: true,
        kind: 'text',
        name: 'notes.txt',
        size: 'plain words'.length,
      });

      const content = await app.fastify.inject({
        method: 'GET',
        url: '/api/files/notes.txt/content?inline=1',
      });
      expect(content.statusCode).toBe(200);
      expect(content.body).toBe('plain words');
      expect(content.headers['content-type']).toBe('text/plain; charset=utf-8');
    });

    it('serves a byte range, so a video seeks', async () => {
      seed('clip.bin', '0123456789');

      const res = await app.fastify.inject({
        method: 'GET',
        url: '/api/files/clip.bin/content',
        headers: { range: 'bytes=2-5' },
      });

      expect(res.statusCode).toBe(206);
      expect(res.body).toBe('2345');
      expect(res.headers['content-range']).toBe('bytes 2-5/10');
    });

    // Criterion 25: uploads/ is writable by anyone on the LAN, and an inline
    // SVG runs same-origin scripts exactly like an HTML page.
    it('never serves an uploaded .svg as image/svg+xml', async () => {
      seed('payload.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

      const inline = await app.fastify.inject({
        method: 'GET',
        url: '/api/files/payload.svg/content?inline=1',
      });
      expect(inline.headers['content-type']).toBe('text/plain; charset=utf-8');

      const attachment = await app.fastify.inject({
        method: 'GET',
        url: '/api/files/payload.svg/content',
      });
      expect(attachment.headers['content-type']).toBe('application/octet-stream');
    });
  });

  describe('confinement', () => {
    // Criterion 10: nothing outside uploads/ is reachable through :name.
    it('refuses traversal, separators, and dot-files in the name', async () => {
      fs.writeFileSync(path.join(storageRoot, 'secret.txt'), 'not yours');
      fs.writeFileSync(path.join(uploads, '.hidden'), 'also not yours');

      for (const name of [
        '..%2Fsecret.txt',
        '%2e%2e%2fsecret.txt',
        '..\\secret.txt',
        '.hidden',
        '.',
      ]) {
        for (const url of [`/api/files/${name}/content`, `/api/files/${name}/preview`]) {
          const res = await app.fastify.inject({ method: 'GET', url });
          expect([400, 404], `${url} → ${res.statusCode}`).toContain(res.statusCode);
          expect(res.body).not.toContain('not yours');
        }
      }
      expect(fs.readFileSync(path.join(storageRoot, 'secret.txt'), 'utf8')).toBe('not yours');
    });

    it('refuses a symlink planted inside uploads/ that points outside it', async () => {
      fs.writeFileSync(path.join(storageRoot, 'outside.txt'), 'escaped');
      fs.symlinkSync(path.join(storageRoot, 'outside.txt'), path.join(uploads, 'link.txt'));

      const res = await app.fastify.inject({
        method: 'GET',
        url: '/api/files/link.txt/content',
      });

      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain('escaped');
    });
  });
});
