import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../../core/bus/index.js';
import { AppError } from '../../../core/http/index.js';
import type { Portkey, PortkeyListFilter, PortkeyRepository } from '../ports.js';
import {
  CreatePortkeyUseCase,
  DeletePortkeyUseCase,
  ListPortkeysUseCase,
  RecordHitUseCase,
  ResolvePortkeyUseCase,
  UpdatePortkeyUseCase,
} from './manage-portkeys.js';

/** In-memory stand-in for the Drizzle repo — usecases only know the interface. */
class FakeRepo implements PortkeyRepository {
  readonly rows = new Map<string, Portkey>();

  insert(portkey: Portkey): void {
    this.rows.set(portkey.slug, { ...portkey });
  }
  update(slug: string, patch: { url: string; note: string | null }): Portkey | null {
    const row = this.rows.get(slug);
    if (!row) return null;
    const next = { ...row, ...patch };
    this.rows.set(slug, next);
    return { ...next };
  }
  findBySlug(slug: string): Portkey | null {
    const row = this.rows.get(slug);
    return row ? { ...row } : null;
  }
  list(filter: PortkeyListFilter): Portkey[] {
    return [...this.rows.values()].slice(filter.offset, filter.offset + filter.limit);
  }
  delete(slug: string): Portkey | null {
    const row = this.findBySlug(slug);
    this.rows.delete(slug);
    return row;
  }
  hasSlug(slug: string): boolean {
    return this.rows.has(slug);
  }
  recordHit(slug: string, at: number): Portkey | null {
    const row = this.rows.get(slug);
    if (!row) return null;
    const next = { ...row, hits: row.hits + 1, lastUsedAt: at };
    this.rows.set(slug, next);
    return { ...next };
  }
}

let repo: FakeRepo;
let bus: EventBus;

beforeEach(() => {
  repo = new FakeRepo();
  bus = new EventBus();
});

const create = () => new CreatePortkeyUseCase(repo, bus, () => 1000);

describe('CreatePortkeyUseCase', () => {
  it('normalizes the target, defaults hits/last-used and emits portkey.saved', () => {
    const seen = vi.fn();
    bus.on('portkey.saved', seen);
    const portkey = create().execute({ slug: 'router', url: '192.168.1.1', note: '  admin  ', authorDeviceId: 'd1' });
    expect(portkey).toMatchObject({
      slug: 'router',
      url: 'https://192.168.1.1/',
      note: 'admin',
      hits: 0,
      authorDeviceId: 'd1',
      createdAt: 1000,
      lastUsedAt: null,
    });
    expect(seen).toHaveBeenCalledWith({ portkey });
  });

  it('422s a bad slug with the validator reason', () => {
    expect(() => create().execute({ slug: 'My Router', url: 'x.com', authorDeviceId: null })).toThrow(AppError);
    try {
      create().execute({ slug: 'My Router', url: 'x.com', authorDeviceId: null });
    } catch (error) {
      expect((error as AppError).statusCode).toBe(422);
    }
  });

  it('422s a reserved slug and a non-web target', () => {
    expect(() => create().execute({ slug: 'go', url: 'x.com', authorDeviceId: null })).toThrow(/reserved/i);
    expect(() => create().execute({ slug: 'ok', url: 'javascript:alert(1)', authorDeviceId: null })).toThrow(
      /http\(s\)/i,
    );
  });

  it('409s a duplicate slug', () => {
    create().execute({ slug: 'nas', url: 'nas.local', authorDeviceId: null });
    try {
      create().execute({ slug: 'nas', url: 'other.local', authorDeviceId: null });
      throw new Error('expected a conflict');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(409);
    }
  });
});

describe('UpdatePortkeyUseCase', () => {
  it('edits url + note (slug stays), emits saved, and 404s a missing slug', () => {
    create().execute({ slug: 'nas', url: 'nas.local', note: 'old', authorDeviceId: null });
    const update = new UpdatePortkeyUseCase(repo, bus);
    const seen = vi.fn();
    bus.on('portkey.saved', seen);

    const edited = update.execute({ slug: 'nas', url: 'http://10.0.0.5', note: '' });
    expect(edited.url).toBe('http://10.0.0.5/');
    expect(edited.note).toBeNull();
    expect(seen).toHaveBeenCalledOnce();

    expect(() => update.execute({ slug: 'ghost', url: 'x.com' })).toThrow(AppError);
  });
});

describe('DeletePortkeyUseCase', () => {
  it('removes and emits portkey.deleted; 404s a missing slug', () => {
    create().execute({ slug: 'nas', url: 'nas.local', authorDeviceId: null });
    const remove = new DeletePortkeyUseCase(repo, bus);
    const seen = vi.fn();
    bus.on('portkey.deleted', seen);

    remove.execute('nas');
    expect(repo.hasSlug('nas')).toBe(false);
    expect(seen).toHaveBeenCalledWith({ slug: 'nas', url: 'https://nas.local/' });

    expect(() => remove.execute('nas')).toThrow(AppError);
  });
});

describe('resolve vs. record-hit ordering', () => {
  it('resolve is read-only — it never mutates hits or last-used', () => {
    create().execute({ slug: 'router', url: 'router.local', authorDeviceId: null });
    const resolve = new ResolvePortkeyUseCase(repo);

    const first = resolve.execute('router');
    const second = resolve.execute('router');
    expect(first?.hits).toBe(0);
    expect(second?.hits).toBe(0);
    expect(repo.findBySlug('router')?.hits).toBe(0);
    expect(resolve.execute('missing')).toBeNull();
  });

  it('record-hit bumps the count, stamps last-used, and emits portkey.hit', () => {
    create().execute({ slug: 'router', url: 'router.local', authorDeviceId: null });
    const recordHit = new RecordHitUseCase(repo, bus, () => 5000);
    const seen = vi.fn();
    bus.on('portkey.hit', seen);

    recordHit.execute('router');
    recordHit.execute('router');
    const row = repo.findBySlug('router');
    expect(row?.hits).toBe(2);
    expect(row?.lastUsedAt).toBe(5000);
    expect(seen).toHaveBeenCalledTimes(2);
    expect(seen).toHaveBeenLastCalledWith({ portkey: expect.objectContaining({ slug: 'router', hits: 2 }) });
  });

  it('record-hit on a since-deleted slug is a silent no-op (no event)', () => {
    const recordHit = new RecordHitUseCase(repo, bus, () => 5000);
    const seen = vi.fn();
    bus.on('portkey.hit', seen);
    recordHit.execute('ghost');
    expect(seen).not.toHaveBeenCalled();
  });
});

describe('ListPortkeysUseCase', () => {
  it('clamps limit/offset into range', () => {
    const list = new ListPortkeysUseCase(repo);
    create().execute({ slug: 'a', url: 'a.com', authorDeviceId: null });
    expect(list.execute({ limit: 0 })).toHaveLength(1);
    expect(list.execute({ limit: 99999 })).toHaveLength(1);
    expect(list.execute({ offset: -5 })).toHaveLength(1);
  });
});
