import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../core/bus/index.js';
import type { RunestoneSummary } from '../../../core/bus/events.js';
import { AppError } from '../../../core/http/index.js';
import type { RunestoneListFilter, RunestoneRecord, RunestoneRepository } from '../ports.js';
import {
  DeleteRunestoneUseCase,
  GetRunestoneUseCase,
  ListRunestonesUseCase,
  SaveRunestoneUseCase,
  UpdateRunestoneUseCase,
} from './manage-runestones.js';

const PAGING = { pageSize: 30, maxPageSize: 100 };

class MemoryRepo implements RunestoneRepository {
  rows = new Map<string, RunestoneRecord>();
  lastFilter: RunestoneListFilter | null = null;

  insert(record: RunestoneRecord): void {
    this.rows.set(record.id, { ...record });
  }
  update(record: RunestoneRecord): void {
    this.rows.set(record.id, { ...record });
  }
  findById(id: string): RunestoneRecord | null {
    const row = this.rows.get(id);
    return row ? { ...row } : null;
  }
  findBySlug(slug: string): RunestoneRecord | null {
    for (const row of this.rows.values()) if (row.slug === slug) return { ...row };
    return null;
  }
  list(filter: RunestoneListFilter): RunestoneSummary[] {
    this.lastFilter = filter;
    return [...this.rows.values()].map((row) => {
      const summary = { ...row } as Partial<RunestoneRecord>;
      delete summary.content;
      return summary as RunestoneSummary;
    });
  }
  delete(id: string): RunestoneRecord | null {
    const row = this.findById(id);
    if (row) this.rows.delete(id);
    return row;
  }
  listPage(filter: RunestoneListFilter): RunestoneSummary[] {
    return this.list(filter);
  }
  count(): number {
    return this.rows.size;
  }
  listAuthors(): string[] {
    const authors = [...this.rows.values()].flatMap((row) =>
      row.authorDeviceId ? [row.authorDeviceId] : [],
    );
    return [...new Set(authors)];
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
  bus.on('runestone.saved', (payload) => events.push({ name: 'saved', payload }));
  bus.on('runestone.deleted', (payload) => events.push({ name: 'deleted', payload }));
  return { repo, bus, events };
}

describe('SaveRunestoneUseCase', () => {
  it('saves valid JSON with a slug and emits runestone.saved', () => {
    const { repo, bus, events } = harness();
    const save = new SaveRunestoneUseCase({ repo, bus, maxDocBytes: 1024, now: () => 1000 });
    const record = save.execute({ name: 'My Doc', content: '{"a":1}', authorDeviceId: 'dev-1' });

    expect(record.slug).toBe(`my-doc-${record.id}`);
    expect(record.sizeBytes).toBe(7);
    expect(record.createdAt).toBe(1000);
    expect(repo.findBySlug(record.slug)?.content).toBe('{"a":1}');
    expect(events).toHaveLength(1);
    expect((events[0]?.payload as { runestone: RunestoneSummary }).runestone.id).toBe(record.id);
  });

  it('defaults the name to a relic title that avoids existing names', () => {
    const { repo, bus } = harness();
    const save = new SaveRunestoneUseCase({ repo, bus, maxDocBytes: 1024 });
    const record = save.execute({ content: '{}', authorDeviceId: null });
    expect(record.name).toMatch(/^[^ ]+ .+$/);
  });

  it('rejects invalid JSON with 422 and oversize with 413', () => {
    const { repo, bus } = harness();
    const save = new SaveRunestoneUseCase({ repo, bus, maxDocBytes: 16 });
    expect(() => save.execute({ content: '{nope', authorDeviceId: null })).toThrowError(AppError);
    try {
      save.execute({ content: '{nope', authorDeviceId: null });
    } catch (error) {
      expect((error as AppError).statusCode).toBe(422);
    }
    try {
      save.execute({ content: JSON.stringify({ big: 'x'.repeat(50) }), authorDeviceId: null });
    } catch (error) {
      expect((error as AppError).statusCode).toBe(413);
    }
  });

  it('retries id generation on collision', () => {
    const { repo, bus } = harness();
    // rng yields six 0s (id "aaaaaa" — pre-seeded, collides) then 0.5s ("ssssss").
    let calls = 0;
    const rng = () => (calls++ < 6 ? 0 : 0.5);
    const save = new SaveRunestoneUseCase({ repo, bus, maxDocBytes: 1024, rng });
    const zero = new SaveRunestoneUseCase({ repo, bus, maxDocBytes: 1024, rng: () => 0 });
    const first = zero.execute({ name: 'One', content: '{}', authorDeviceId: null });
    expect(first.id).toBe('aaaaaa');
    const second = save.execute({ name: 'Two', content: '{}', authorDeviceId: null });
    expect(second.id).toBe('ssssss');
  });
});

describe('UpdateRunestoneUseCase', () => {
  function seeded() {
    const h = harness();
    const save = new SaveRunestoneUseCase({ ...h, maxDocBytes: 1024, now: () => 1000 });
    const record = save.execute({ name: 'Old Name', content: '{"a":1}', authorDeviceId: 'dev-1' });
    h.events.length = 0;
    return { ...h, record };
  }

  it('renames → new slug, same id, old link resolvable by id', () => {
    const { repo, bus, record, events } = seeded();
    const update = new UpdateRunestoneUseCase({ repo, bus, maxDocBytes: 1024, now: () => 2000 });
    const renamed = update.execute({ id: record.id, name: 'New Name' });

    expect(renamed.slug).toBe(`new-name-${record.id}`);
    expect(renamed.id).toBe(record.id);
    expect(renamed.modifiedAt).toBe(2000);
    expect(renamed.createdAt).toBe(1000);
    expect(events).toHaveLength(1);

    const resolve = new GetRunestoneUseCase(repo);
    const viaOld = resolve.execute(record.slug);
    expect(viaOld.canonical).toBe(false);
    expect(viaOld.record.slug).toBe(renamed.slug);
  });

  it('updates content, revalidating and resizing', () => {
    const { repo, bus, record } = seeded();
    const update = new UpdateRunestoneUseCase({ repo, bus, maxDocBytes: 1024 });
    const updated = update.execute({ id: record.id, content: '{"b":[1,2,3]}' });
    expect(updated.sizeBytes).toBe(13);
    expect(updated.slug).toBe(record.slug);
    expect(() => update.execute({ id: record.id, content: 'broken{' })).toThrowError(AppError);
  });

  it('404s for unknown ids', () => {
    const { repo, bus } = harness();
    const update = new UpdateRunestoneUseCase({ repo, bus, maxDocBytes: 1024 });
    expect(() => update.execute({ id: 'zzzzzz', name: 'X' })).toThrowError(AppError);
  });
});

describe('GetRunestoneUseCase', () => {
  it('404s for unknown slugs', () => {
    const { repo } = harness();
    expect(() => new GetRunestoneUseCase(repo).execute('never-carved-abc123')).toThrowError(
      AppError,
    );
  });
});

describe('ListRunestonesUseCase', () => {
  it('clamps and defaults filter parameters', () => {
    const { repo } = harness();
    const list = new ListRunestonesUseCase(repo, PAGING);
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

describe('DeleteRunestoneUseCase', () => {
  it('deletes and emits runestone.deleted; 404 on repeat', () => {
    const { repo, bus, events } = harness();
    const save = new SaveRunestoneUseCase({ repo, bus, maxDocBytes: 1024 });
    const record = save.execute({ name: 'Doomed', content: '{}', authorDeviceId: null });
    events.length = 0;

    const remove = new DeleteRunestoneUseCase(repo, bus);
    remove.execute(record.id);
    expect(repo.rows.size).toBe(0);
    expect(events).toEqual([{ name: 'deleted', payload: { id: record.id, name: 'Doomed' } }]);
    expect(() => remove.execute(record.id)).toThrowError(AppError);
  });
});

describe('Runestone formats (PLAN-42)', () => {
  const COMMENTED = '{\n  // the port\n  "port": 4646,\n}';

  it('saves strict JSON when no format is named, as every older client does', () => {
    const { repo, bus, events } = harness();
    const save = new SaveRunestoneUseCase({ repo, bus, maxDocBytes: 1024 });
    const record = save.execute({ content: '{"a":1}', authorDeviceId: null });
    expect(record.format).toBe('json');
    expect(repo.findById(record.id)?.format).toBe('json');
    expect(events[0]?.payload).toMatchObject({ runestone: { format: 'json' } });
    expect(() => save.execute({ content: COMMENTED, authorDeviceId: null })).toThrow(
      'document is not valid JSON',
    );
  });

  it('saves JSONC with comments and trailing commas, byte for byte', () => {
    const { repo, bus, events } = harness();
    const save = new SaveRunestoneUseCase({ repo, bus, maxDocBytes: 1024 });
    const record = save.execute({ content: COMMENTED, format: 'jsonc', authorDeviceId: null });
    expect(record).toMatchObject({ format: 'jsonc', content: COMMENTED });
    expect(events[0]?.payload).toMatchObject({ runestone: { format: 'jsonc' } });
  });

  it('refuses JSON5-only syntax in JSONC with the same 422 code', () => {
    const { repo, bus } = harness();
    const save = new SaveRunestoneUseCase({ repo, bus, maxDocBytes: 1024 });
    for (const content of ["{'a': 1}", '{a: 1}', '{"a": NaN}', '{"a": 0x1F}', '// only']) {
      try {
        save.execute({ content, format: 'jsonc', authorDeviceId: null });
        expect.unreachable(content);
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).statusCode).toBe(422);
        expect((error as AppError).code).toBe('INVALID_JSON');
        expect((error as AppError).message).toBe('document is not valid JSONC');
      }
    }
  });

  it('applies the size cap to JSONC before parsing it', () => {
    const { repo, bus } = harness();
    const save = new SaveRunestoneUseCase({ repo, bus, maxDocBytes: 16 });
    try {
      save.execute({ content: `// ${'x'.repeat(40)}\n{}`, format: 'jsonc', authorDeviceId: null });
      expect.unreachable();
    } catch (error) {
      expect((error as AppError).statusCode).toBe(413);
    }
  });

  it('keeps the stored format when an update names none', () => {
    const { repo, bus } = harness();
    const deps = { repo, bus, maxDocBytes: 1024 };
    const saved = new SaveRunestoneUseCase(deps).execute({
      content: COMMENTED,
      format: 'jsonc',
      authorDeviceId: null,
    });
    const update = new UpdateRunestoneUseCase(deps);
    expect(update.execute({ id: saved.id, name: 'Renamed' }).format).toBe('jsonc');
    const edited = update.execute({ id: saved.id, content: '{ /* still */ "port": 1, }' });
    expect(edited.format).toBe('jsonc');
    expect(repo.findById(saved.id)?.format).toBe('jsonc');
  });

  it('changes the format on request, validating the content in the new one', () => {
    const { repo, bus, events } = harness();
    const deps = { repo, bus, maxDocBytes: 1024 };
    const saved = new SaveRunestoneUseCase(deps).execute({
      content: '{"a": 1}',
      authorDeviceId: null,
    });
    const update = new UpdateRunestoneUseCase(deps);
    // A mode change alone is a change worth saving.
    const toJsonc = update.execute({ id: saved.id, format: 'jsonc' });
    expect(toJsonc).toMatchObject({ format: 'jsonc', content: '{"a": 1}' });
    expect(events.at(-1)?.payload).toMatchObject({ runestone: { format: 'jsonc' } });
    update.execute({ id: saved.id, content: COMMENTED });
    // Comments cannot be switched back to strict JSON: refused, nothing written.
    expect(() => update.execute({ id: saved.id, format: 'json' })).toThrow(
      'document is not valid JSON',
    );
    expect(repo.findById(saved.id)).toMatchObject({ format: 'jsonc', content: COMMENTED });
    // Strict content may go back.
    expect(update.execute({ id: saved.id, content: '{"b": 2}', format: 'json' }).format).toBe(
      'json',
    );
  });

  it('passes a format filter to the repository and ignores an unknown one', () => {
    const { repo } = harness();
    const list = new ListRunestonesUseCase(repo, PAGING);
    list.execute({ format: 'jsonc' });
    expect(repo.lastFilter?.format).toBe('jsonc');
    list.executePage({ format: 'json' });
    expect(repo.lastFilter?.format).toBe('json');
    list.execute({ format: 'yaml' });
    expect(repo.lastFilter?.format).toBeUndefined();
    list.execute({});
    expect(repo.lastFilter?.format).toBeUndefined();
  });
});
