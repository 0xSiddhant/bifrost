import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from './client.js';
import {
  DOCUMENT_KINDS,
  hasRenderedPage,
  previewUrl,
  rawPath,
  resolveDocument,
} from './documents.js';
import { CliError, EXIT } from './output.js';
import { failure } from '../test/failure.js';

const BASE = 'http://bifrost.local:4646';

const TYPES: Record<string, string> = {
  runestone: 'application/json; charset=utf-8',
  edda: 'text/markdown; charset=utf-8',
  groot: 'application/yaml; charset=utf-8',
  atlas: 'application/xml; charset=utf-8',
};

/**
 * A fetch that answers 200 for the named kinds and 404 for the rest — the shape
 * the four raw endpoints really have.
 */
function fakeFetch(present: Record<string, string>): ReturnType<typeof vi.fn> {
  return vi.fn((input: string | URL) => {
    const url = String(input);
    const kind = Object.keys(present).find((name) => url.includes(`/${name}/api/`));
    if (kind === undefined) {
      return Promise.resolve(
        new Response(JSON.stringify({ error: 'NOT_FOUND', message: 'not found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }
    return Promise.resolve(
      new Response(present[kind], { status: 200, headers: { 'content-type': TYPES[kind] ?? '' } }),
    );
  });
}

function client(): ApiClient {
  return new ApiClient(BASE, null);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('resolveDocument without --type', () => {
  it('asks all four kinds and uses the one that answered', async () => {
    const call = fakeFetch({ groot: 'name: bifrost\n' });
    vi.stubGlobal('fetch', call);

    const document = await resolveDocument(client(), 'my-conf-a1b2c3');

    expect(document.kind).toBe('groot');
    expect(document.body).toBe('name: bifrost\n');
    expect(call).toHaveBeenCalledTimes(DOCUMENT_KINDS.length);
  });

  it('reports a clean not-found when no kind answers', async () => {
    vi.stubGlobal('fetch', fakeFetch({}));
    const error = await failure(resolveDocument(client(), 'nope'));

    expect(error).toBeInstanceOf(CliError);
    expect(error.message).toBe('no document with the slug "nope"');
    expect(error.exitCode).toBe(EXIT.notFound);
  });

  it('asks for --type on a genuine cross-kind collision rather than picking one', async () => {
    vi.stubGlobal('fetch', fakeFetch({ runestone: '{}', atlas: '<plist/>' }));
    const error = await failure(resolveDocument(client(), 'twins'));

    expect(error.message).toContain('exists as more than one kind (runestone, atlas)');
    expect(error.message).toContain('--type');
    expect(error.exitCode).toBe(EXIT.conflict);
  });

  it('does not mistake the SPA fallback for a document', async () => {
    // These endpoints sit OUTSIDE /api/, so on a profile without that module the
    // client shell answers 200 with index.html. Matching the media type is what
    // keeps that from reading as a hit.
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response('<!doctype html><title>Bifrost</title>', {
            status: 200,
            headers: { 'content-type': 'text/html; charset=utf-8' },
          }),
        ),
      ),
    );

    await expect(resolveDocument(client(), 'anything')).rejects.toThrow('no document with the slug');
  });
});

describe('resolveDocument with --type', () => {
  it('short-circuits the fan-out to a single request', async () => {
    const call = fakeFetch({ edda: '# Trip\n' });
    vi.stubGlobal('fetch', call);

    const document = await resolveDocument(client(), 'trip-notes-a1b2c3', 'edda');

    expect(document.kind).toBe('edda');
    expect(call).toHaveBeenCalledTimes(1);
    expect(String(call.mock.calls[0]?.[0])).toContain('/edda/api/');
  });

  it('names the kind in the not-found message', async () => {
    vi.stubGlobal('fetch', fakeFetch({}));
    await expect(resolveDocument(client(), 'nope', 'atlas')).rejects.toThrow(
      'no atlas with the slug "nope"',
    );
  });

  it('refuses a kind that is not one of the four, without a request', async () => {
    const call = fakeFetch({});
    vi.stubGlobal('fetch', call);

    await expect(resolveDocument(client(), 'x', 'pensieve')).rejects.toThrow('unknown --type');
    expect(call).not.toHaveBeenCalled();
  });
});

describe('the canonical slug', () => {
  it('follows a 301 and reports the slug the bridge redirected to', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          Object.defineProperty(
            new Response('# Renamed\n', {
              status: 200,
              headers: { 'content-type': TYPES.edda ?? '' },
            }),
            'url',
            { value: `${BASE}/edda/api/new-name-a1b2c3` },
          ),
        ),
      ),
    );

    const document = await resolveDocument(client(), 'old-name-a1b2c3', 'edda');
    expect(document.slug).toBe('new-name-a1b2c3');
  });
});

describe('previewUrl', () => {
  it('sends edda to its real rendered page', () => {
    expect(previewUrl(BASE, { kind: 'edda', slug: 'trip-a1b2c3', body: '' })).toBe(
      `${BASE}/edda/preview/trip-a1b2c3`,
    );
    expect(hasRenderedPage('edda')).toBe(true);
  });

  it('sends the other three to their raw content URL, which has no rendered page yet', () => {
    for (const kind of ['runestone', 'groot', 'atlas'] as const) {
      expect(previewUrl(BASE, { kind, slug: 'doc-a1b2c3', body: '' })).toBe(
        `${BASE}${rawPath(kind, 'doc-a1b2c3')}`,
      );
      expect(hasRenderedPage(kind)).toBe(false);
    }
  });
});
