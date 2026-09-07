import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiClient,
  describeTransportFailure,
  failureFromBody,
  multipartFilename,
} from './client.js';
import { CliError, EXIT } from './output.js';
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
    expect(client().url('/api/portkey', { q: 'router', limit: 5, offset: undefined })).toBe(
      `${BASE}/api/portkey?q=router&limit=5`,
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

    const error = await failure(client().json('reading server health', 'GET', '/api/health'));

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

describe('a successful call', () => {
  it('returns the parsed body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse(200, { ok: true, profile: 'local' }))),
    );
    await expect(client().json('reading server health', 'GET', '/api/health')).resolves.toEqual({
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
      client().voidCall('removing a clipboard entry', 'DELETE', '/api/clipboard/abc'),
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
