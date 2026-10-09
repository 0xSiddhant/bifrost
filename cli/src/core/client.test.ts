import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiClient,
  describeTransportFailure,
  failureFromBody,
  LEGACY_SERVER_HINT,
  legacyPath,
  multipartFilename,
} from './client.js';
import { CliError, EXIT, setJsonMode } from './output.js';
import { failure } from '../test/failure.js';

const BASE = 'http://bifrost.local:4646';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function client(): ApiClient {
  return new ApiClient(BASE, 'cli-test-device');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('url building', () => {
  it('joins the base with the path and drops undefined query values', () => {
    expect(client().url('/api/v1/portkey', { q: 'router', limit: 5, offset: undefined })).toBe(
      `${BASE}/api/v1/portkey?q=router&limit=5`,
    );
  });

  it('sends the device header so writes are attributed', () => {
    expect(client().headers()['x-bifrost-device']).toBe('cli-test-device');
    expect(new ApiClient(BASE, null).headers()).toEqual({});
  });
});

describe('the error table', () => {
  it('maps 404 to "not found" and the not-found exit code', () => {
    const error = failureFromBody(
      'pulling notes.txt',
      404,
      JSON.stringify({ error: 'NOT_FOUND', message: 'download not found' }),
    );
    expect(error.message).toBe('pulling notes.txt failed: not found (download not found)');
    expect(error.exitCode).toBe(EXIT.notFound);
  });

  it('maps 409 to the server’s own words and the conflict exit code', () => {
    const error = failureFromBody(
      'running the download test',
      409,
      JSON.stringify({ error: 'TEST_IN_PROGRESS', message: 'another broom is flying (on Thor)' }),
    );
    expect(error.message).toBe(
      'running the download test failed: another broom is flying (on Thor)',
    );
    expect(error.exitCode).toBe(EXIT.conflict);
  });

  it('never repeats a 5xx body back at the user', () => {
    const error = failureFromBody('listing downloads', 503, '<html>gateway blew up</html>');
    expect(error.message).toBe('listing downloads failed: the Bifrost server errored (HTTP 503)');
    expect(error.message).not.toContain('html');
    expect(error.exitCode).toBe(EXIT.failure);
  });

  it('passes a 4xx explanation through, since it is about the request', () => {
    const error = failureFromBody(
      'creating a go-link',
      422,
      JSON.stringify({ error: 'INVALID_SLUG', message: 'slug shadows a page name' }),
    );
    expect(error.message).toBe('creating a go-link failed: slug shadows a page name');
  });

  it('falls back to the status when the body is not the server’s error shape', () => {
    expect(failureFromBody('pushing files', 400, 'nginx said no').message).toBe(
      'pushing files failed: HTTP 400',
    );
    expect(failureFromBody('pushing files', 400, '').message).toBe('pushing files failed: HTTP 400');
  });
});

describe('a transport failure', () => {
  it('becomes the one worded remediation, with the unreachable exit code', async () => {
    const transportError = Object.assign(new TypeError('fetch failed'), {
      cause: { code: 'ENOTFOUND' },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(transportError)),
    );

    const error = await failure(client().json('reading server health', 'GET', '/api/v1/health'));

    expect(error).toBeInstanceOf(CliError);
    expect(error.message).toContain(BASE);
    expect(error.message).toContain('ENOTFOUND');
    expect(error.message).toContain('bifrost config set-host');
    expect(error.exitCode).toBe(EXIT.unreachable);
  });

  it('names a timeout as a timeout rather than as an abort', () => {
    expect(describeTransportFailure(Object.assign(new Error('x'), { name: 'TimeoutError' }))).toBe(
      'timed out',
    );
    expect(describeTransportFailure({ cause: { code: 'ECONNREFUSED' } })).toBe('ECONNREFUSED');
    expect(describeTransportFailure(new Error('something else'))).toBe('something else');
  });
});

describe('the same-machine fallback (PLAN-39)', () => {
  const notFound = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
  const refused = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
  const FALLBACKS = ['http://127.0.0.1:4646', 'http://127.0.0.1:4647'];

  /** fetch that answers only for the origins in `up`, and records every URL asked. */
  function network(up: string[]): string[] {
    const asked: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        asked.push(url);
        if (up.some((origin) => url.startsWith(origin))) return jsonResponse(200, { ok: true });
        throw url.startsWith(BASE) ? notFound() : refused();
      }),
    );
    return asked;
  }

  it('moves to the web host on this machine when the default does not resolve', async () => {
    const asked = network(['http://127.0.0.1:4646']);
    const api = new ApiClient(BASE, 'cli-test-device', FALLBACKS);
    await api.json('reading server health', 'GET', '/api/v1/health');
    expect(api.baseUrl).toBe('http://127.0.0.1:4646');
    expect(api.fellBackFrom).toBe(BASE);
    // The original, the probe, then the request again at the fallback.
    expect(asked).toEqual([`${BASE}/api/v1/health`, 'http://127.0.0.1:4646/api/v1/health', 'http://127.0.0.1:4646/api/v1/health']);
  });

  it('tries the API alone (BIFROST_RUN=api) when no web host answers', async () => {
    network(['http://127.0.0.1:4647']);
    const api = new ApiClient(BASE, 'cli-test-device', FALLBACKS);
    await api.json('reading clipboard', 'GET', '/api/v1/clipboard');
    expect(api.baseUrl).toBe('http://127.0.0.1:4647');
  });

  it('names every address it tried when none answers, and probes only once per command', async () => {
    const asked = network([]);
    const api = new ApiClient(BASE, 'cli-test-device', FALLBACKS);
    const error = await failure(api.json('reading server health', 'GET', '/api/v1/health'));
    expect(error.exitCode).toBe(EXIT.unreachable);
    expect(error.message).toContain(BASE);
    expect(error.message).toContain('127.0.0.1:4646 or http://127.0.0.1:4647');
    await failure(api.json('reading server health', 'GET', '/api/v1/health'));
    expect(asked.filter((url) => url.startsWith('http://127.0.0.1'))).toHaveLength(2);
  });

  it('restarts an upload at the fallback when the default refused the connection', async () => {
    let received = 0;
    const server = http.createServer((request, response) => {
      if (request.url === '/api/v1/health') return void response.end('{"ok":true}');
      request.on('data', (chunk: Buffer) => (received += chunk.length));
      request.on('end', () => response.end('{"accepted":1}'));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const up = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    // A port nothing listens on: the connection is refused before a byte is sent.
    const dead = http.createServer();
    await new Promise<void>((resolve) => dead.listen(0, '127.0.0.1', resolve));
    const deadUrl = `http://127.0.0.1:${(dead.address() as { port: number }).port}`;
    await new Promise<void>((resolve) => dead.close(() => resolve()));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-cli-fallback-'));
    const file = path.join(dir, 'a.txt');
    fs.writeFileSync(file, 'x'.repeat(5000));
    try {
      const api = new ApiClient(deadUrl, 'cli-test-device', [up]);
      const answer = await api.postFiles<{ accepted: number }>('uploading', '/api/v1/files', [
        { path: file, name: 'a.txt', size: 5000 },
      ]);
      expect(answer).toEqual({ accepted: 1 });
      expect(api.baseUrl).toBe(up);
      expect(received).toBeGreaterThan(5000);
    } finally {
      server.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('never falls back from an address the person chose (no fallbacks given)', async () => {
    const asked = network(['http://127.0.0.1:4646']);
    await failure(client().json('reading server health', 'GET', '/api/v1/health'));
    expect(asked).toEqual([`${BASE}/api/v1/health`]);
  });

  it('never retries after a timeout: the request may have arrived', async () => {
    const asked: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        asked.push(String(input));
        throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
      }),
    );
    const api = new ApiClient(BASE, 'cli-test-device', FALLBACKS);
    await failure(api.json('saving', 'POST', '/api/v1/runestone', { body: {} }));
    expect(asked).toHaveLength(1);
    expect(api.fellBackFrom).toBeNull();
  });
});

describe('a successful call', () => {
  it('returns the parsed body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse(200, { ok: true, profile: 'local' }))),
    );
    await expect(client().json('reading server health', 'GET', '/api/v1/health')).resolves.toEqual({
      ok: true,
      profile: 'local',
    });
  });

  it('drains a 204 rather than leaving the socket half-read', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
    );
    await expect(
      client().voidCall('removing a clipboard entry', 'DELETE', '/api/v1/clipboard/abc'),
    ).resolves.toBeUndefined();
  });
});

describe('multipartFilename', () => {
  it('keeps the envelope well-formed without inventing a second sanitizer', () => {
    expect(multipartFilename('holiday photo.jpg')).toBe('holiday photo.jpg');
    expect(multipartFilename('sa"y "hi".txt')).toBe('sa_y _hi_.txt');
    expect(multipartFilename('two\r\nlines.txt')).toBe('two__lines.txt');
    expect(multipartFilename('back\\slash.txt')).toBe('back_slash.txt');
  });
});

describe('the API version probe (PLAN-37)', () => {
  /**
   * A hub that records every URL asked. `versioned: false` is a server from
   * before PLAN-37: `/api/v1/…` is a 404 there, the unversioned paths answer.
   */
  function hub(options: { versioned: boolean; healthStatus?: number }): string[] {
    const asked: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = new URL(String(input));
        asked.push(url.pathname);
        if (url.pathname === '/api/v1/health' && options.healthStatus !== undefined) {
          return jsonResponse(options.healthStatus, { error: 'X', message: 'x' });
        }
        const versioned = /^\/(api|[a-z]+\/api)\/v1\//.test(url.pathname);
        if (versioned !== options.versioned)
          return jsonResponse(404, { error: 'NOT_FOUND', message: 'nope' });
        return jsonResponse(200, { ok: true });
      }),
    );
    return asked;
  }

  function stderr(): { lines: () => string[] } {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    return { lines: () => spy.mock.calls.map((call) => String(call[0])) };
  }

  afterEach(() => setJsonMode(false));

  it('maps v1 paths to the unversioned ones a pre-PLAN-37 server answers', () => {
    expect(legacyPath('/api/v1/files/a.txt?x=/api/v1/y')).toBe('/api/files/a.txt?x=/api/v1/y');
    expect(legacyPath('/api/v1')).toBe('/api');
    expect(legacyPath('/edda/api/v1/trip-a1b2c3')).toBe('/edda/api/trip-a1b2c3');
    expect(legacyPath('/go/router')).toBe('/go/router');
  });

  it('speaks v1 to a v1 hub after one probe, and says nothing', async () => {
    const asked = hub({ versioned: true });
    const err = stderr();
    const api = client();
    await api.json('reading the clipboard', 'GET', '/api/v1/clipboard');
    await api.json('reading presence', 'GET', '/api/v1/presence');
    expect(asked).toEqual(['/api/v1/health', '/api/v1/clipboard', '/api/v1/presence']);
    expect(api.apiVersion).toBe('v1');
    expect(err.lines()).toEqual([]);
  });

  it('falls back to the unversioned paths on a 404, with one hint on stderr', async () => {
    const asked = hub({ versioned: false });
    const err = stderr();
    const api = client();
    await api.json('reading the clipboard', 'GET', '/api/v1/clipboard');
    await api.probe('/edda/api/v1/trip-a1b2c3');
    await api.json('reading presence', 'GET', '/api/v1/presence');
    expect(asked).toEqual([
      '/api/v1/health',
      '/api/clipboard',
      '/edda/api/trip-a1b2c3',
      '/api/presence',
    ]);
    expect(api.apiVersion).toBe('legacy');
    expect(api.url('/runestone/api/v1/a')).toBe(`${BASE}/runestone/api/a`);
    const hints = err.lines().filter((line) => line.includes(LEGACY_SERVER_HINT));
    expect(hints).toHaveLength(1);
  });

  it('never prints the hint in --json mode', async () => {
    hub({ versioned: false });
    setJsonMode(true);
    const err = stderr();
    await client().json('reading the clipboard', 'GET', '/api/v1/clipboard');
    expect(err.lines()).toEqual([]);
  });

  it('keeps v1 on any other probe answer, so the request fails exactly as before', async () => {
    const asked = hub({ versioned: true, healthStatus: 503 });
    const api = client();
    await api.json('reading the clipboard', 'GET', '/api/v1/clipboard');
    expect(api.apiVersion).toBe('v1');
    expect(asked).toEqual(['/api/v1/health', '/api/v1/clipboard']);
  });

  it('sends one probe for requests made together, and none for /go', async () => {
    const asked = hub({ versioned: true });
    const api = client();
    await api.probe('/go/router', { redirect: 'manual' });
    await Promise.all(
      ['runestone', 'edda', 'groot', 'atlas'].map((kind) => api.probe(`/${kind}/api/v1/doc`)),
    );
    expect(asked.filter((path) => path === '/api/v1/health')).toHaveLength(1);
    expect(asked[0]).toBe('/go/router');
  });

  it('moves to a pre-PLAN-37 hub on this machine and speaks its paths there', async () => {
    const asked: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        asked.push(url);
        if (url.startsWith(BASE)) {
          throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
        }
        return url.includes('/api/v1/')
          ? jsonResponse(404, { error: 'NOT_FOUND', message: 'nope' })
          : jsonResponse(200, { ok: true });
      }),
    );
    stderr();
    const api = new ApiClient(BASE, 'cli-test-device', ['http://127.0.0.1:4646']);
    await api.json('reading the clipboard', 'GET', '/api/v1/clipboard');
    expect(api.apiVersion).toBe('legacy');
    expect(asked).toEqual([
      `${BASE}/api/v1/health`,
      'http://127.0.0.1:4646/api/v1/health',
      'http://127.0.0.1:4646/api/health',
      'http://127.0.0.1:4646/api/clipboard',
    ]);
  });
});
