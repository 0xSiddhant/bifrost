import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../../core/bus/index.js';
import { AppError } from '../../../core/http/index.js';
import type { ClipboardEntry } from '../../../core/bus/events.js';
import type { ClipboardRepository, StoredClipboardEntry } from '../ports.js';
import {
  AddClipboardEntryUseCase,
  DeleteClipboardEntryUseCase,
} from './manage-clipboard.js';

class FakeRepo implements ClipboardRepository {
  entries: StoredClipboardEntry[] = [];

  insert(entry: StoredClipboardEntry): void {
    this.entries.push(entry);
  }
  list(now: number): ClipboardEntry[] {
    return this.entries
      .filter((e) => e.expiresAt === null || e.expiresAt > now)
      .sort((a, b) => b.createdAt - a.createdAt);
  }
  delete(id: string): boolean {
    const i = this.entries.findIndex((e) => e.id === id);
    if (i < 0) return false;
    this.entries.splice(i, 1);
    return true;
  }
  prune(max: number, now: number): string[] {
    const removed: string[] = [];
    for (const e of [...this.entries]) {
      if (e.expiresAt !== null && e.expiresAt <= now) {
        removed.push(e.id);
        this.delete(e.id);
      }
    }
    const sorted = [...this.entries].sort((a, b) => b.createdAt - a.createdAt);
    for (const e of sorted.slice(max)) {
      removed.push(e.id);
      this.delete(e.id);
    }
    return removed;
  }
}

function build(overrides: { maxEntries?: number; maxTextBytes?: number } = {}) {
  const repo = new FakeRepo();
  const bus = new EventBus();
  let seq = 0;
  const add = new AddClipboardEntryUseCase({
    repo,
    bus,
    maxEntries: overrides.maxEntries ?? 100,
    maxTextBytes: overrides.maxTextBytes ?? 64 * 1024,
    now: () => 1000 + seq,
    genId: () => `id-${seq++}`,
  });
  return { repo, bus, add };
}

describe('AddClipboardEntryUseCase', () => {
  it('stores the entry and broadcasts an add', () => {
    const { repo, bus, add } = build();
    const events: unknown[] = [];
    bus.on('clipboard.updated', (e) => events.push(e));

    const entry = add.execute({ text: 'hello lan', deviceId: 'dev-1' });

    expect(entry.text).toBe('hello lan');
    expect(entry.kind).toBe('text');
    expect(repo.entries).toHaveLength(1);
    expect(events).toEqual([{ action: 'add', entry }]);
  });

  it('keeps a code entry with its language hint', () => {
    const { add } = build();
    const entry = add.execute({ text: 'const x = 1', kind: 'code', lang: 'ts', deviceId: null });
    expect(entry.kind).toBe('code');
    expect(entry.lang).toBe('ts');
  });

  it('rejects empty text and oversize text', () => {
    const { add } = build({ maxTextBytes: 8 });
    expect(() => add.execute({ text: '   ', deviceId: null })).toThrow(AppError);
    expect(() => add.execute({ text: 'way too many bytes', deviceId: null })).toThrow(/too large/);
  });

  it('evicts the oldest entry past the cap and broadcasts its deletion', () => {
    const { repo, bus, add } = build({ maxEntries: 2 });
    const deletes: string[] = [];
    bus.on('clipboard.updated', (e) => {
      if (e.action === 'delete') deletes.push(e.id);
    });

    const first = add.execute({ text: 'one', deviceId: null });
    add.execute({ text: 'two', deviceId: null });
    add.execute({ text: 'three', deviceId: null });

    expect(repo.entries).toHaveLength(2);
    expect(repo.entries.some((e) => e.id === first.id)).toBe(false);
    expect(deletes).toEqual([first.id]);
  });
});

describe('DeleteClipboardEntryUseCase', () => {
  it('removes an entry and broadcasts the deletion', () => {
    const { repo, bus, add } = build();
    const entry = add.execute({ text: 'bye', deviceId: null });
    const del = new DeleteClipboardEntryUseCase(repo, bus);
    const listener = vi.fn();
    bus.on('clipboard.updated', listener);

    del.execute(entry.id);

    expect(repo.entries).toHaveLength(0);
    expect(listener).toHaveBeenCalledWith({ action: 'delete', id: entry.id });
  });

  it('404s an unknown id', () => {
    const { repo, bus } = build();
    const del = new DeleteClipboardEntryUseCase(repo, bus);
    expect(() => del.execute('nope')).toThrow(AppError);
  });
});
