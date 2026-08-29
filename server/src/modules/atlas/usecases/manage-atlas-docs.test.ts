import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../core/bus/index.js';
import type { AtlasSummary } from '../../../core/bus/events.js';
import { AppError } from '../../../core/http/index.js';
import type { AtlasListFilter, AtlasRecord, AtlasRepository } from '../ports.js';
import {
  DeleteAtlasUseCase,
  GetAtlasUseCase,
  ListAtlasUseCase,
  SaveAtlasUseCase,
  UpdateAtlasUseCase,
} from './manage-atlas-docs.js';

class MemoryRepo implements AtlasRepository {
  rows = new Map<string, AtlasRecord>();
  lastFilter: AtlasListFilter | null = null;

  insert(record: AtlasRecord): void {
    this.rows.set(record.id, { ...record });
  }
  update(record: AtlasRecord): void {
    this.rows.set(record.id, { ...record });
  }
  findById(id: string): AtlasRecord | null {
    const row = this.rows.get(id);
    return row ? { ...row } : null;
  }
  findBySlug(slug: string): AtlasRecord | null {
    for (const row of this.rows.values()) if (row.slug === slug) return { ...row };
    return null;
  }
  list(filter: AtlasListFilter): AtlasSummary[] {
    this.lastFilter = filter;
    return [...this.rows.values()].map((row) => {
      const summary = { ...row } as Partial<AtlasRecord>;
      delete summary.content;
      return summary as AtlasSummary;
    });
  }
  delete(id: string): AtlasRecord | null {
    const row = this.findById(id);
    if (row) this.rows.delete(id);
    return row;
  }
  listNames(): string[] {
    return [...this.rows.values()].map((row) => row.name);
  }
  hasId(id: string): boolean {
    return this.rows.has(id);
  }
}

function harness() {
  const repo = new MemoryRepo();
  const bus = new EventBus();
  const events: Array<{ name: string; payload: unknown }> = [];
  bus.on('atlas.saved', (payload) => events.push({ name: 'saved', payload }));
  bus.on('atlas.deleted', (payload) => events.push({ name: 'deleted', payload }));
  return { repo, bus, events };
}

describe('SaveAtlasUseCase', () => {
  it('saves xml with a slug and emits atlas.saved', () => {
    const { repo, bus, events } = harness();
    const save = new SaveAtlasUseCase({ repo, bus, maxDocBytes: 1024, now: () => 1000 });
    const record = save.execute({
      name: 'Bundle Info',
      content: '<plist version="1.0"/>\n',
      authorDeviceId: 'dev-1',
    });

    expect(record.slug).toBe(`bundle-info-${record.id}`);
    expect(record.sizeBytes).toBe(23);
    expect(record.createdAt).toBe(1000);
    expect(repo.findBySlug(record.slug)?.content).toBe('<plist version="1.0"/>\n');
    expect(events).toHaveLength(1);
    expect((events[0]?.payload as { atlas: AtlasSummary }).atlas.id).toBe(record.id);
  });

  it('stores text the server cannot parse — it never parses XML at all', () => {
    // The accepted consequence of "the server stores bytes": a direct POST of
    // malformed XML is stored and served back, exactly as Edda does with
    // markdown and Groot with YAML. The browser is the only parser in Atlas,
    // and it is the only one with an entity-amplification guard.
    const { repo, bus } = harness();
    const save = new SaveAtlasUseCase({ repo, bus, maxDocBytes: 1024 });
    const record = save.execute({ content: '<a><b></a>', authorDeviceId: null });
    expect(repo.findById(record.id)?.content).toBe('<a><b></a>');
  });

  it('stores an entity-bomb document without expanding a byte of it', () => {
    // Proof of the boundary rather than of the parser: the server has no XML
    // parser to bomb, so the amplification never happens here — it is refused
    // in the browser, where PLAN-23's spike measured the platform guard.
    const { repo, bus } = harness();
    const save = new SaveAtlasUseCase({ repo, bus, maxDocBytes: 4096 });
    const bomb =
      '<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol1 "&lol;&lol;&lol;">]><lolz>&lol1;</lolz>';
    const record = save.execute({ content: bomb, authorDeviceId: null });
    expect(repo.findById(record.id)?.content).toBe(bomb);
    expect(record.sizeBytes).toBe(bomb.length);
  });

  it('accepts an empty document', () => {
    const { repo, bus } = harness();
    const save = new SaveAtlasUseCase({ repo, bus, maxDocBytes: 1024 });
    const record = save.execute({ content: '', authorDeviceId: null });
    expect(record.sizeBytes).toBe(0);
  });

  it('counts bytes, not characters, against the cap', () => {
    const { repo, bus } = harness();
    const save = new SaveAtlasUseCase({ repo, bus, maxDocBytes: 1024 });
    const record = save.execute({ content: '<note>héllo 🌉</note>', authorDeviceId: null });
    expect(record.sizeBytes).toBe(Buffer.byteLength('<note>héllo 🌉</note>', 'utf8'));
  });

  it('defaults the name to a relic title that avoids existing names', () => {
    const { repo, bus } = harness();
    const save = new SaveAtlasUseCase({ repo, bus, maxDocBytes: 1024 });
    const record = save.execute({ content: '<a>1</a>', authorDeviceId: null });
    expect(record.name).toMatch(/^[^ ]+ .+$/);
  });

  it('rejects oversize with 413', () => {
    const { repo, bus } = harness();
    const save = new SaveAtlasUseCase({ repo, bus, maxDocBytes: 16 });
    try {
      save.execute({ content: 'x'.repeat(50), authorDeviceId: null });
      expect.unreachable();
    } catch (error) {
      expect((error as AppError).statusCode).toBe(413);
    }
  });

  it('never collides an id, even when the generator repeats itself', () => {
    const { repo, bus } = harness();
    // An rng that returns the same value forever would mint the same id twice
    // without the retry loop; the second save must still land its own row.
    const ids = ['aaaaaa', 'aaaaaa', 'bbbbbb'];
    let call = 0;
    const rng = () => {
      const id = ids[Math.floor(call / 6)] ?? 'zzzzzz';
      const ch = id[call % 6] ?? 'a';
      call += 1;
      return (ch.charCodeAt(0) - 97) / 36 + 0.001;
    };
    const save = new SaveAtlasUseCase({ repo, bus, maxDocBytes: 1024, rng });
    const first = save.execute({ name: 'One', content: '<a>1</a>', authorDeviceId: null });
    const second = save.execute({ name: 'Two', content: '<b>2</b>', authorDeviceId: null });
    expect(second.id).not.toBe(first.id);
    expect(repo.rows.size).toBe(2);
  });
});

describe('UpdateAtlasUseCase', () => {
  function seeded() {
    const h = harness();
    const save = new SaveAtlasUseCase({ ...h, maxDocBytes: 1024, now: () => 1000 });
    const record = save.execute({ name: 'Old Name', content: '<a>1</a>', authorDeviceId: 'dev-1' });
    h.events.length = 0;
    return { ...h, record };
  }

  it('renames → new slug, same id, old link resolvable by id', () => {
    const { repo, bus, record, events } = seeded();
    const update = new UpdateAtlasUseCase({ repo, bus, maxDocBytes: 1024, now: () => 2000 });
    const renamed = update.execute({ id: record.id, name: 'New Name' });

    expect(renamed.slug).toBe(`new-name-${record.id}`);
    expect(renamed.id).toBe(record.id);
    expect(renamed.modifiedAt).toBe(2000);
    expect(renamed.createdAt).toBe(1000);
    expect(events).toHaveLength(1);

    const resolve = new GetAtlasUseCase(repo);
    const viaOld = resolve.execute(record.slug);
    expect(viaOld.canonical).toBe(false);
    expect(viaOld.record.slug).toBe(renamed.slug);
  });

  it('updates content, resizing, and keeps the slug', () => {
    const { repo, bus, record } = seeded();
    const update = new UpdateAtlasUseCase({ repo, bus, maxDocBytes: 1024 });
    const updated = update.execute({ id: record.id, content: '<a>1</a><!--x-->' });
    expect(updated.sizeBytes).toBe(16);
    expect(updated.slug).toBe(record.slug);
  });

  it('preserves the DOCTYPE and comments byte for byte — never re-serialized', () => {
    // XMLSerializer drops the XML declaration outright. Storing bytes is what
    // makes `/atlas/api/:slug` return the file the author actually wrote.
    const { repo, bus, record } = seeded();
    const commented =
      '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<!-- why this port -->\n<plist version="1.0"><dict/></plist>\n';
    const update = new UpdateAtlasUseCase({ repo, bus, maxDocBytes: 1024 });
    update.execute({ id: record.id, content: commented });
    expect(repo.findById(record.id)?.content).toBe(commented);
  });

  it('404s for unknown ids', () => {
    const { repo, bus } = harness();
    const update = new UpdateAtlasUseCase({ repo, bus, maxDocBytes: 1024 });
    expect(() => update.execute({ id: 'zzzzzz', name: 'X' })).toThrowError(AppError);
  });
});

describe('GetAtlasUseCase', () => {
  it('404s for unknown slugs', () => {
    const { repo } = harness();
    expect(() => new GetAtlasUseCase(repo).execute('never-grown-abc123')).toThrowError(AppError);
  });

  it('404s for reserved bare segments so they never shadow a surface', () => {
    const { repo } = harness();
    const get = new GetAtlasUseCase(repo);
    for (const seg of ['api', 'library', 'pensieve']) {
      expect(() => get.execute(seg)).toThrowError(AppError);
    }
  });
});

describe('ListAtlasUseCase', () => {
  it('clamps and defaults filter parameters', () => {
    const { repo } = harness();
    const list = new ListAtlasUseCase(repo);
    list.execute({ sort: 'bogus', order: 'sideways', limit: 9999, offset: -3 });
    expect(repo.lastFilter).toEqual({
      q: undefined,
      authorDeviceId: undefined,
      sort: 'modified',
      order: 'desc',
      limit: 500,
      offset: 0,
    });
    list.execute({ sort: 'name' });
    expect(repo.lastFilter?.order).toBe('asc');
  });
});

describe('DeleteAtlasUseCase', () => {
  it('deletes and emits atlas.deleted; 404 on repeat', () => {
    const { repo, bus, events } = harness();
    const save = new SaveAtlasUseCase({ repo, bus, maxDocBytes: 1024 });
    const record = save.execute({ name: 'Doomed', content: '<a>1</a>', authorDeviceId: null });
    events.length = 0;

    const remove = new DeleteAtlasUseCase(repo, bus);
    remove.execute(record.id);
    expect(repo.rows.size).toBe(0);
    expect(events).toEqual([{ name: 'deleted', payload: { id: record.id, name: 'Doomed' } }]);
    expect(() => remove.execute(record.id)).toThrowError(AppError);
  });
});
