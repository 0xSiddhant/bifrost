import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as edda from '../../core/edda';
import { loadFromSlug, loadFromUrl } from './loadSource';
import { polyfillPromiseWithResolvers } from './__fixtures__/pdfjsUnderNode';

// See `loadPdfSlides.test.ts`: `?url` is a bundler instruction with no meaning
// outside a build, so Node gets the worker's real path on disk instead.
vi.mock('pdfjs-dist/legacy/build/pdf.worker.mjs?url', () => ({
  default: createRequire(import.meta.url).resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'),
}));

// Node 20 has no `Promise.withResolvers`, which pdf.js calls on every document
// it opens. See the module for why this is a test-runner gap and not a
// browser-support one.
polyfillPromiseWithResolvers();

const DECK = '# One\n\n<!-- notes: wave -->\n\n---\n\n# Two';

/** The same real three-page PDF the loader test parses. */
const PDF = readFileSync(fileURLToPath(new URL('./__fixtures__/three-pages.pdf', import.meta.url)));

function pdfResponse(contentType: string | null): Response {
  // A fresh copy each time: pdf.js transfers the buffer it is handed to the
  // worker, which detaches it.
  const body = new Uint8Array(PDF);
  return new Response(body, {
    status: 200,
    headers: contentType === null ? {} : { 'Content-Type': contentType },
  });
}

describe('loadSource (PLAN-28)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('fetches a URL and hands the text to parseSlides unchanged', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(DECK, { status: 200 }));

    const deck = await loadFromUrl('blob:whatever');

    expect(fetchMock).toHaveBeenCalledWith('blob:whatever');
    expect(deck.title).toBeNull();
    expect(deck.slides.map((slide) => slide.kind === 'markdown' && slide.body)).toEqual([
      '# One',
      '# Two',
    ]);
    expect(deck.slides[0]).toMatchObject({ kind: 'markdown', notes: 'wave' });
    // Markdown holds nothing open, and says so rather than handing back a
    // no-op the caller has to call anyway.
    expect(deck.dispose).toBeNull();
  });

  it('presents a PDF as one slide per page when the server says so', async () => {
    // `application/pdf` is what `core/localServe.ts` sends for a `.pdf` — the
    // terminal path's only clue, since the payload URL carries no extension.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(pdfResponse('application/pdf'));

    const deck = await loadFromUrl('http://127.0.0.1:1/payload');

    expect(deck.slides).toHaveLength(3);
    expect(deck.slides.map((slide) => slide.kind === 'pdf' && slide.page)).toEqual([1, 2, 3]);
    expect(deck.dispose).toBeTypeOf('function');
    deck.dispose?.();
  });

  it('presents a PDF the browser could not name a type for', async () => {
    // A dropped file whose type the OS could not resolve arrives with an empty
    // or generic content type; its own `%PDF-` header still names it.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(pdfResponse('application/octet-stream'));

    const deck = await loadFromUrl('blob:whatever');

    expect(deck.slides).toHaveLength(3);
    deck.dispose?.();
  });

  it('reads the content type past a charset parameter', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(pdfResponse('application/pdf; charset=binary'));
    const deck = await loadFromUrl('blob:whatever');
    expect(deck.slides).toHaveLength(3);
    deck.dispose?.();
  });

  it('does not mistake markdown that merely mentions a PDF for one', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('# %PDF- is how a PDF starts\n', { status: 200 }),
    );
    const deck = await loadFromUrl('blob:whatever');
    expect(deck.slides[0]?.kind).toBe('markdown');
  });

  it('names the status when the source refuses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 404 }));
    await expect(loadFromUrl('http://127.0.0.1:1/payload')).rejects.toThrow('404');
  });

  it('presents a saved edda through fetchEdda, carrying the canonical slug', async () => {
    // Through `core/edda.ts` on purpose: the 301-follow and the 404-as-null are
    // reused rather than re-derived against a raw fetch.
    vi.spyOn(edda, 'fetchEdda').mockResolvedValue({
      id: 'abc123',
      name: 'A Deck',
      slug: 'a-deck-abc123',
      authorDeviceId: null,
      sizeBytes: DECK.length,
      createdAt: 1,
      modifiedAt: 1,
      content: DECK,
    });

    const deck = await loadFromSlug('older-name-abc123');

    expect(deck?.title).toBe('A Deck');
    expect(deck?.slug).toBe('a-deck-abc123');
    expect(deck?.slides).toHaveLength(2);
  });

  it('returns null for a slug that does not exist', async () => {
    vi.spyOn(edda, 'fetchEdda').mockResolvedValue(null);
    expect(await loadFromSlug('nope')).toBeNull();
  });
});
