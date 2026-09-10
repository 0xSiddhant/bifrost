import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { serveFileOnce } from './localServe.js';

const ORIGIN = 'http://bifrost.local:4646';

describe('localServe (PLAN-28)', () => {
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
