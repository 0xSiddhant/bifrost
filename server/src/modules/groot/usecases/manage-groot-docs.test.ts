import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../core/bus/index.js';
import type { GrootSummary } from '../../../core/bus/events.js';
import { AppError } from '../../../core/http/index.js';
import type { GrootListFilter, GrootRecord, GrootRepository } from '../ports.js';
import {
  DeleteGrootUseCase,
  GetGrootUseCase,
  ListGrootUseCase,
  SaveGrootUseCase,
  UpdateGrootUseCase,
} from './manage-groot-docs.js';

class MemoryRepo implements GrootRepository {
  rows = new Map<string, GrootRecord>();
  lastFilter: GrootListFilter | null = null;

  insert(record: GrootRecord): void {
    this.rows.set(record.id, { ...record });
  }
  update(record: GrootRecord): void {
    this.rows.set(record.id, { ...record });
  }
  findById(id: string): GrootRecord | null {
    const row = this.rows.get(id);
    return row ? { ...row } : null;
  }
  findBySlug(slug: string): GrootRecord | null {
    for (const row of this.rows.values()) if (row.slug === slug) return { ...row };
    return null;
  }
  list(filter: GrootListFilter): GrootSummary[] {
    this.lastFilter = filter;
    return [...this.rows.values()].map((row) => {
      const summary = { ...row } as Partial<GrootRecord>;
      delete summary.content;
      return summary as GrootSummary;
    });
  }
  delete(id: string): GrootRecord | null {
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
  bus.on('groot.saved', (payload) => events.push({ name: 'saved', payload }));
  bus.on('groot.deleted', (payload) => events.push({ name: 'deleted', payload }));
  return { repo, bus, events };
}

describe('SaveGrootUseCase', () => {
  it('saves yaml with a slug and emits groot.saved', () => {
    const { repo, bus, events } = harness();
    const save = new SaveGrootUseCase({ repo, bus, maxDocBytes: 1024, now: () => 1000 });
    const record = save.execute({
      name: 'Cluster Manifest',
      content: 'kind: Deployment\n',
      authorDeviceId: 'dev-1',
    });

    expect(record.slug).toBe(`cluster-manifest-${record.id}`);
    expect(record.sizeBytes).toBe(17);
    expect(record.createdAt).toBe(1000);
    expect(repo.findBySlug(record.slug)?.content).toBe('kind: Deployment\n');
    expect(events).toHaveLength(1);
    expect((events[0]?.payload as { groot: GrootSummary }).groot.id).toBe(record.id);
  });

  it('stores text the server cannot parse — it never parses YAML at all', () => {
    // The accepted consequence of "the server stores bytes": a direct POST of
    // broken YAML is stored and served back, exactly as Edda does with markdown.
    const { repo, bus } = harness();
    const save = new SaveGrootUseCase({ repo, bus, maxDocBytes: 1024 });
    const record = save.execute({ content: 'a: [1, 2\n', authorDeviceId: null });
    expect(repo.findById(record.id)?.content).toBe('a: [1, 2\n');
  });

  it('accepts an empty document', () => {
    const { repo, bus } = harness();
    const save = new SaveGrootUseCase({ repo, bus, maxDocBytes: 1024 });
    const record = save.execute({ content: '', authorDeviceId: null });
    expect(record.sizeBytes).toBe(0);
  });

  it('counts bytes, not characters, against the cap', () => {
    const { repo, bus } = harness();
    const save = new SaveGrootUseCase({ repo, bus, maxDocBytes: 1024 });
    const record = save.execute({ content: 'note: héllo 🌉\n', authorDeviceId: null });
    expect(record.sizeBytes).toBe(Buffer.byteLength('note: héllo 🌉\n', 'utf8'));
  });

  it('defaults the name to a relic title that avoids existing names', () => {
    const { repo, bus } = harness();
    const save = new SaveGrootUseCase({ repo, bus, maxDocBytes: 1024 });
    const record = save.execute({ content: 'a: 1\n', authorDeviceId: null });
    expect(record.name).toMatch(/^[^ ]+ .+$/);
  });

  it('rejects oversize with 413', () => {
    const { repo, bus } = harness();
    const save = new SaveGrootUseCase({ repo, bus, maxDocBytes: 16 });
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
    const save = new SaveGrootUseCase({ repo, bus, maxDocBytes: 1024, rng });
    const first = save.execute({ name: 'One', content: 'a: 1\n', authorDeviceId: null });
    const second = save.execute({ name: 'Two', content: 'b: 2\n', authorDeviceId: null });
    expect(second.id).not.toBe(first.id);
    expect(repo.rows.size).toBe(2);
  });
});

describe('UpdateGrootUseCase', () => {
  function seeded() {
    const h = harness();
    const save = new SaveGrootUseCase({ ...h, maxDocBytes: 1024, now: () => 1000 });
    const record = save.execute({ name: 'Old Name', content: 'a: 1\n', authorDeviceId: 'dev-1' });
    h.events.length = 0;
    return { ...h, record };
  }

  it('renames → new slug, same id, old link resolvable by id', () => {
    const { repo, bus, record, events } = seeded();
    const update = new UpdateGrootUseCase({ repo, bus, maxDocBytes: 1024, now: () => 2000 });
    const renamed = update.execute({ id: record.id, name: 'New Name' });

    expect(renamed.slug).toBe(`new-name-${record.id}`);
    expect(renamed.id).toBe(record.id);
    expect(renamed.modifiedAt).toBe(2000);
    expect(renamed.createdAt).toBe(1000);
    expect(events).toHaveLength(1);

    const resolve = new GetGrootUseCase(repo);
    const viaOld = resolve.execute(record.slug);
    expect(viaOld.canonical).toBe(false);
    expect(viaOld.record.slug).toBe(renamed.slug);
  });

  it('updates content, resizing, and keeps the slug', () => {
    const { repo, bus, record } = seeded();
    const update = new UpdateGrootUseCase({ repo, bus, maxDocBytes: 1024 });
    const updated = update.execute({ id: record.id, content: 'a: 1\nb: 2\n' });
    expect(updated.sizeBytes).toBe(10);
    expect(updated.slug).toBe(record.slug);
  });

  it('preserves comments byte for byte — the document is never re-serialized', () => {
    const { repo, bus, record } = seeded();
    const commented = '# why this port\nport: 4646 # inline\n';
    const update = new UpdateGrootUseCase({ repo, bus, maxDocBytes: 1024 });
    update.execute({ id: record.id, content: commented });
    expect(repo.findById(record.id)?.content).toBe(commented);
  });

  it('404s for unknown ids', () => {
    const { repo, bus } = harness();
    const update = new UpdateGrootUseCase({ repo, bus, maxDocBytes: 1024 });
    expect(() => update.execute({ id: 'zzzzzz', name: 'X' })).toThrowError(AppError);
  });
});

describe('GetGrootUseCase', () => {
  it('404s for unknown slugs', () => {
    const { repo } = harness();
    expect(() => new GetGrootUseCase(repo).execute('never-grown-abc123')).toThrowError(AppError);
  });

  it('404s for reserved bare segments so they never shadow a surface', () => {
    const { repo } = harness();
    const get = new GetGrootUseCase(repo);
    for (const seg of ['api', 'library', 'pensieve']) {
      expect(() => get.execute(seg)).toThrowError(AppError);
    }
  });
});

describe('ListGrootUseCase', () => {
  it('clamps and defaults filter parameters', () => {
    const { repo } = harness();
    const list = new ListGrootUseCase(repo);
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

describe('DeleteGrootUseCase', () => {
  it('deletes and emits groot.deleted; 404 on repeat', () => {
    const { repo, bus, events } = harness();
    const save = new SaveGrootUseCase({ repo, bus, maxDocBytes: 1024 });
    const record = save.execute({ name: 'Doomed', content: 'a: 1\n', authorDeviceId: null });
    events.length = 0;

    const remove = new DeleteGrootUseCase(repo, bus);
    remove.execute(record.id);
    expect(repo.rows.size).toBe(0);
    expect(events).toEqual([{ name: 'deleted', payload: { id: record.id, name: 'Doomed' } }]);
    expect(() => remove.execute(record.id)).toThrowError(AppError);
  });
});
