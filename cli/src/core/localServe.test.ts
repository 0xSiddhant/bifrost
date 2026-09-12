import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { serveFileOnce } from './localServe.js';

const ORIGIN = 'http://bifrost.local:4646';

describe('localServe (PLAN-28, PLAN-29)', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-serve-'));
    file = path.join(dir, 'deck.md');
    fs.writeFileSync(file, '# One\n\n---\n\n# Two\n');
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('serves the file once, on loopback, then closes itself', async () => {
    const server = await serveFileOnce(file, { origin: ORIGIN });
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/payload$/);

    const response = await fetch(server.url);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('# One\n\n---\n\n# Two\n');

    // The whole point of "one-shot": the command must not leave a server up.
    await expect(server.finished).resolves.toBeUndefined();
    await expect(fetch(server.url)).rejects.toThrow();
  });

  it('names the payload markdown, so the page reads it as text', async () => {
    const server = await serveFileOnce(file, { origin: ORIGIN });
    const response = await fetch(server.url);
    expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    await response.text();
    await server.finished;
  });

  it('names a .pdf payload application/pdf (PLAN-29)', async () => {
    // The header is the page's only clue: the payload is served from one fixed
    // path with no extension on it, so `/saga?source=…` cannot read the kind
    // off the URL the way a dropped file's name gives it away.
    const pdf = path.join(dir, 'slides.pdf');
    fs.writeFileSync(pdf, '%PDF-1.4\n');
    const server = await serveFileOnce(pdf, { origin: ORIGIN });

    const response = await fetch(server.url);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(await response.text()).toBe('%PDF-1.4\n');
    await server.finished;
  });

  it('refuses to guess a type it has no row for', async () => {
    // `core/preview.ts` has already refused anything unknown by the time a
    // server exists, so this is the row-added-there-and-forgotten-here case:
    // unknown bytes, not a confident and wrong `text/markdown`.
    const odd = path.join(dir, 'deck.rtf');
    fs.writeFileSync(odd, 'whatever');
    const server = await serveFileOnce(odd, { origin: ORIGIN });

    const response = await fetch(server.url);
    expect(response.headers.get('content-type')).toBe('application/octet-stream');
    await response.text();
    await server.finished;
  });

  it('allows exactly the Bifrost origin, never *', async () => {
    const server = await serveFileOnce(file, { origin: ORIGIN });
    const response = await fetch(server.url);
    expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    await server.finished;
  });

  it('404s every path but /payload, and does not count that as served', async () => {
    const server = await serveFileOnce(file, { origin: ORIGIN });
    const base = server.url.replace('/payload', '');

    expect((await fetch(`${base}/`)).status).toBe(404);
    expect((await fetch(`${base}/../../etc/passwd`)).status).toBe(404);
    // Still alive, because nothing has taken the payload yet.
    expect((await fetch(server.url)).status).toBe(200);
    await server.finished;
  });

  it('refuses a path that is not a file, before opening any port', async () => {
    await expect(serveFileOnce(path.join(dir, 'missing.md'), { origin: ORIGIN })).rejects.toThrow(
      /no such file/,
    );
    await expect(serveFileOnce(dir, { origin: ORIGIN })).rejects.toThrow(/no such file/);
  });

  it('gives up when nobody ever fetches it', async () => {
    const server = await serveFileOnce(file, { origin: ORIGIN, timeoutMs: 60 });
    await expect(server.finished).rejects.toThrow(/never fetched/);
  });

  it('closes on request, for a browser that never launched', async () => {
    const server = await serveFileOnce(file, { origin: ORIGIN });
    server.close();
    await expect(server.finished).resolves.toBeUndefined();
    await expect(fetch(server.url)).rejects.toThrow();
  });
});
