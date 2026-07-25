import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../../core/bus/index.js';
import { AppError } from '../../../core/http/index.js';
import type { AccioLink, AccioListFilter, AccioRepository, TitleFetcher } from '../ports.js';
import {
  DeleteLinkUseCase,
  EnrichTitleUseCase,
  ListLinksUseCase,
  SaveLinkUseCase,
  UpdateLinkUseCase,
} from './manage-links.js';

/** In-memory stand-in for the Drizzle repo — usecases only know the interface. */
class FakeRepo implements AccioRepository {
  readonly rows = new Map<string, AccioLink>();

  insert(link: AccioLink): void {
    this.rows.set(link.id, { ...link });
  }
  update(link: AccioLink): void {
    this.rows.set(link.id, { ...link });
  }
  findById(id: string): AccioLink | null {
    const row = this.rows.get(id);
    return row ? { ...row } : null;
  }
  list(filter: AccioListFilter): AccioLink[] {
    return [...this.rows.values()]
      .filter((row) => !filter.tag || row.tags.includes(filter.tag))
      .slice(filter.offset, filter.offset + filter.limit);
  }
  delete(id: string): AccioLink | null {
    const row = this.findById(id);
    this.rows.delete(id);
    return row;
  }
  hasId(id: string): boolean {
    return this.rows.has(id);
  }
}

let repo: FakeRepo;
let bus: EventBus;

beforeEach(() => {
  repo = new FakeRepo();
  bus = new EventBus();
});

const save = () => new SaveLinkUseCase({ repo, bus, now: () => 1000 });

describe('SaveLinkUseCase', () => {
  it('normalizes the URL and emits accio.saved', () => {
    const seen = vi.fn();
    bus.on('accio.saved', seen);

    const link = save().execute({ url: 'example.com/read ', authorDeviceId: 'device-a' });

    expect(link.url).toBe('https://example.com/read');
    expect(link.authorDeviceId).toBe('device-a');
    expect(link.createdAt).toBe(1000);
    expect(seen).toHaveBeenCalledWith({ link });
  });

  it('stores a null title when the client sends none — enrichment fills it later', () => {
    expect(save().execute({ url: 'example.com', authorDeviceId: null }).title).toBeNull();
    expect(save().execute({ url: 'example.com', title: '  ', authorDeviceId: null }).title).toBeNull();
  });

  it('normalizes tags: lowercased, deduped, capped', () => {
    const link = save().execute({
      url: 'example.com',
      tags: ['Recipes', 'recipes', ' Slow  Cooking ', ''],
      authorDeviceId: null,
    });
    expect(link.tags).toEqual(['recipes', 'slow cooking']);
  });

  it('rejects an unsupported scheme with 422, storing nothing', () => {
    expect(() => save().execute({ url: 'javascript:alert(1)', authorDeviceId: null })).toThrow(
      AppError,
    );
    try {
      save().execute({ url: 'javascript:alert(1)', authorDeviceId: null });
    } catch (error) {
      expect((error as AppError).statusCode).toBe(422);
    }
    expect(repo.rows.size).toBe(0);
  });

  it('retries on an id collision instead of overwriting', () => {
    const ids = ['aaaaaa', 'aaaaaa', 'bbbbbb'];
    let call = 0;
    // rng feeding newAccioId: return a sequence that yields the ids above.
    const idFor = (id: string) => {
      const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
      return [...id].map((ch) => alphabet.indexOf(ch) / alphabet.length);
    };
    const stream = ids.flatMap(idFor);
    const rng = () => stream[call++] ?? 0;

    const usecase = new SaveLinkUseCase({ repo, bus, now: () => 1, rng });
    const first = usecase.execute({ url: 'a.com', authorDeviceId: null });
    const second = usecase.execute({ url: 'b.com', authorDeviceId: null });

    expect(first.id).toBe('aaaaaa');
    expect(second.id).toBe('bbbbbb');
    expect(repo.rows.size).toBe(2);
  });
});

describe('UpdateLinkUseCase', () => {
  it('edits title and tags and emits accio.updated', () => {
    const link = save().execute({ url: 'example.com', authorDeviceId: null });
    const seen = vi.fn();
    bus.on('accio.updated', seen);

    const updated = new UpdateLinkUseCase({ repo, bus }).execute({
      id: link.id,
      title: 'A Better Name',
      tags: ['Later'],
    });

    expect(updated.title).toBe('A Better Name');
    expect(updated.tags).toEqual(['later']);
    expect(seen).toHaveBeenCalledWith({ link: updated });
  });

  it('an empty title clears it back to the bare URL', () => {
    const link = save().execute({ url: 'example.com', title: 'Old', authorDeviceId: null });
    const updated = new UpdateLinkUseCase({ repo, bus }).execute({ id: link.id, title: '' });
    expect(updated.title).toBeNull();
  });

  it('404s an unknown id', () => {
    expect(() => new UpdateLinkUseCase({ repo, bus }).execute({ id: 'nope', title: 'x' })).toThrow(
      AppError,
    );
  });
});

describe('ListLinksUseCase', () => {
  it('normalizes the tag filter so casing composes with what was stored', () => {
    save().execute({ url: 'a.com', tags: ['Recipes'], authorDeviceId: null });
    save().execute({ url: 'b.com', tags: ['work'], authorDeviceId: null });

    const found = new ListLinksUseCase(repo).execute({ tag: 'RECIPES' });
    expect(found).toHaveLength(1);
    expect(found[0]?.url).toBe('https://a.com/');
  });
});

describe('DeleteLinkUseCase', () => {
  it('removes the row and emits accio.deleted', () => {
    const link = save().execute({ url: 'example.com', title: 'Gone', authorDeviceId: null });
    const seen = vi.fn();
    bus.on('accio.deleted', seen);

    new DeleteLinkUseCase(repo, bus).execute(link.id);

    expect(repo.rows.size).toBe(0);
    expect(seen).toHaveBeenCalledWith({ id: link.id, url: link.url, title: 'Gone' });
  });

  it('404s an unknown id', () => {
    expect(() => new DeleteLinkUseCase(repo, bus).execute('nope')).toThrow(AppError);
  });
});

describe('EnrichTitleUseCase', () => {
  const fetcher = (title: string | null): TitleFetcher => ({ fetchTitle: async () => title });

  it('patches the row and emits accio.updated on success', async () => {
    const link = save().execute({ url: 'example.com', authorDeviceId: null });
    const seen = vi.fn();
    bus.on('accio.updated', seen);

    await new EnrichTitleUseCase(repo, bus, fetcher('Fetched Title')).execute(link.id);

    expect(repo.findById(link.id)?.title).toBe('Fetched Title');
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('leaves the row alone when the site is unreachable (null title)', async () => {
    const link = save().execute({ url: 'example.com', authorDeviceId: null });
    const seen = vi.fn();
    bus.on('accio.updated', seen);

    await new EnrichTitleUseCase(repo, bus, fetcher(null)).execute(link.id);

    expect(repo.findById(link.id)?.title).toBeNull();
    expect(seen).not.toHaveBeenCalled();
  });

  it('never overwrites a title the user set while the fetch was in flight', async () => {
    const link = save().execute({ url: 'example.com', authorDeviceId: null });
    const racing: TitleFetcher = {
      fetchTitle: async () => {
        new UpdateLinkUseCase({ repo, bus }).execute({ id: link.id, title: 'Mine' });
        return 'Theirs';
      },
    };

    await new EnrichTitleUseCase(repo, bus, racing).execute(link.id);

    expect(repo.findById(link.id)?.title).toBe('Mine');
  });

  it('never reaches for the network on a non-http scheme', async () => {
    const link = save().execute({ url: 'chrome://flags/#enable-foo', authorDeviceId: null });
    const fetchTitle = vi.fn(async () => 'should not happen');

    await new EnrichTitleUseCase(repo, bus, { fetchTitle }).execute(link.id);

    expect(fetchTitle).not.toHaveBeenCalled();
    expect(repo.findById(link.id)?.title).toBeNull();
  });

  it('is a no-op when the row was deleted mid-fetch', async () => {
    const link = save().execute({ url: 'example.com', authorDeviceId: null });
    const racing: TitleFetcher = {
      fetchTitle: async () => {
        repo.delete(link.id);
        return 'Too late';
      },
    };

    await expect(
      new EnrichTitleUseCase(repo, bus, racing).execute(link.id),
    ).resolves.toBeUndefined();
    expect(repo.rows.size).toBe(0);
  });
});
