import { afterEach, describe, expect, it, vi } from 'vitest';
import * as edda from '../../core/edda';
import { loadFromSlug, loadFromUrl } from './loadSource';

const DECK = '# One\n\n<!-- notes: wave -->\n\n---\n\n# Two';

describe('loadSource (PLAN-28)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('fetches a URL and hands the text to parseSlides unchanged', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(DECK, { status: 200 }));

    const deck = await loadFromUrl('blob:whatever');

    expect(fetchMock).toHaveBeenCalledWith('blob:whatever');
    expect(deck.title).toBeNull();
    expect(deck.slides.map((slide) => slide.body)).toEqual(['# One', '# Two']);
    expect(deck.slides[0]?.notes).toBe('wave');
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
