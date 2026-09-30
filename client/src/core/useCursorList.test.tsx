// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { CursorListPage } from './api';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const sse = vi.hoisted(() => ({ status: [] as Array<(status: string) => void> }));
vi.mock('./sse', () => ({
  bifrostEvents: {
    onStatus: (listener: (status: string) => void) => {
      sse.status.push(listener);
      return () => {
        sse.status = sse.status.filter((fn) => fn !== listener);
      };
    },
  },
}));
vi.mock('./log', () => ({ log: { reportError: vi.fn(), warn: vi.fn() } }));

const { useCursorList } = await import('./useCursorList');
type Hook = ReturnType<typeof useCursorList<Row, Query, CursorListPage<Row>>>;

interface Row {
  id: string;
  at: number;
  tag: string;
}
interface Query {
  tag: string;
}

/** A newest-first keyset server over `rows`, two per batch. */
function server(rows: () => Row[]) {
  return vi.fn(
    (query: Query, cursor: string | null, options: { signal: AbortSignal; limit?: number }) => {
      const matching = rows()
        .filter((row) => !query.tag || row.tag === query.tag)
        .sort((a, b) => b.at - a.at);
      const start = cursor ? matching.findIndex((row) => row.id === cursor) + 1 : 0;
      const limit = options.limit ?? 2;
      const items = matching.slice(start, start + limit);
      const last = items.at(-1);
      return Promise.resolve({
        items,
        total: matching.length,
        limit,
        nextCursor: start + limit < matching.length && last ? last.id : null,
      });
    },
  );
}

let container: HTMLDivElement;
let root: Root;
let hook: Hook;

function Probe(props: { query: Query; fetchPage: ReturnType<typeof server> }) {
  hook = useCursorList<Row, Query, CursorListPage<Row>>({
    query: props.query,
    fetchPage: props.fetchPage,
    keyOf: (row) => row.id,
    matches: (row, query) => !query.tag || row.tag === query.tag,
    compare: (a, b) => b.at - a.at,
    module: 'test',
  });
  return null;
}

const ALL: Query = { tag: '' };
const settle = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
};

async function mount(fetchPage: ReturnType<typeof server>, query: Query = ALL) {
  await act(async () => root.render(<Probe query={query} fetchPage={fetchPage} />));
  await settle();
}

const ids = () => hook.items.map((row) => row.id);
let rows: Row[];

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  sse.status = [];
  rows = [
    { id: 'e', at: 50, tag: 'x' },
    { id: 'd', at: 40, tag: 'y' },
    { id: 'c', at: 30, tag: 'x' },
    { id: 'b', at: 20, tag: 'y' },
    { id: 'a', at: 10, tag: 'x' },
  ];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('useCursorList', () => {
  it('loads batches until the cursor runs out', async () => {
    await mount(server(() => rows));
    expect(ids()).toEqual(['e', 'd']);
    expect(hook.total).toBe(5);
    expect(hook.hasMore).toBe(true);

    await act(async () => hook.loadMore());
    await settle();
    await act(async () => hook.loadMore());
    await settle();
    expect(ids()).toEqual(['e', 'd', 'c', 'b', 'a']);
    expect(hook.hasMore).toBe(false);
  });

  it('keeps one batch in flight', async () => {
    const fetchPage = server(() => rows);
    await mount(fetchPage);
    await act(async () => {
      hook.loadMore();
      hook.loadMore();
    });
    await settle();
    expect(fetchPage).toHaveBeenCalledTimes(2); // first batch + one more
  });

  it('de-duplicates a row that comes back in a later batch', async () => {
    await mount(server(() => rows));
    // 'e', already shown, re-sorts past the cursor server-side (its key moved
    // mid-scroll), so a later batch hands it back.
    rows = rows.map((row) => (row.id === 'e' ? { ...row, at: 15 } : row));
    await act(async () => hook.loadMore());
    await settle();
    await act(async () => hook.loadMore());
    await settle();
    expect(ids()).toEqual(['e', 'd', 'c', 'b', 'a']);
  });

  it('drops a slow answer for the old filter once the filter changes', async () => {
    let release: (() => void) | undefined;
    const slow = vi.fn((query: Query) => {
      if (query.tag === 'x')
        return server(() => rows)(query, null, { signal: new AbortController().signal });
      return new Promise<CursorListPage<Row>>((resolve) => {
        release = () => resolve({ items: [rows[1] as Row], total: 99, limit: 2, nextCursor: null });
      });
    });
    await act(async () => root.render(<Probe query={{ tag: 'y' }} fetchPage={slow} />));
    await act(async () => root.render(<Probe query={{ tag: 'x' }} fetchPage={slow} />));
    await settle();
    await act(async () => release?.());
    await settle();
    expect(ids()).toEqual(['e', 'c']);
    expect(hook.total).toBe(3);
  });

  it('places a live insert only where it provably belongs', async () => {
    await mount(server(() => rows));
    // Newer than everything: top of the list.
    await act(async () => hook.upsert({ id: 'f', at: 60, tag: 'x' }, true));
    expect(ids()).toEqual(['f', 'e', 'd']);
    expect(hook.total).toBe(6);
    // Older than the last loaded row, with more to load: left for the scroll.
    await act(async () => hook.upsert({ id: 'z', at: 1, tag: 'x' }, true));
    expect(ids()).toEqual(['f', 'e', 'd']);
    expect(hook.total).toBe(7);
  });

  it('ignores a new row outside the filter, and drops a loaded row that leaves it', async () => {
    await mount(
      server(() => rows),
      { tag: 'x' },
    );
    expect(ids()).toEqual(['e', 'c']);
    await act(async () => hook.upsert({ id: 'g', at: 70, tag: 'y' }, true));
    expect(ids()).toEqual(['e', 'c']);
    expect(hook.total).toBe(3);
    await act(async () => hook.upsert({ id: 'e', at: 50, tag: 'y' }));
    expect(ids()).toEqual(['c']);
    expect(hook.total).toBe(2);
  });

  it('removes a loaded row locally, and re-counts for one never loaded', async () => {
    const fetchPage = server(() => rows);
    await mount(fetchPage);
    await act(async () => hook.remove('e'));
    expect(ids()).toEqual(['d']);
    expect(hook.total).toBe(4);

    rows = rows.filter((row) => row.id !== 'a' && row.id !== 'e');
    await act(async () => hook.remove('a'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(fetchPage).toHaveBeenLastCalledWith(ALL, null, expect.objectContaining({ limit: 1 }));
    expect(hook.total).toBe(3);
  });

  it('re-reads the first batch after an SSE reconnect', async () => {
    await mount(server(() => rows));
    rows = [{ id: 'h', at: 90, tag: 'x' }, ...rows];
    await act(async () => {
      for (const listener of sse.status) listener('connecting');
      for (const listener of sse.status) listener('open');
    });
    await settle();
    expect(ids()).toEqual(['h', 'e', 'd']);
    expect(hook.total).toBe(6);
  });

  it('stops after a failed batch until asked again', async () => {
    let fail = false;
    const base = server(() => rows);
    const fetchPage = vi.fn(
      (query: Query, cursor: string | null, options: { signal: AbortSignal; limit?: number }) =>
        fail && cursor ? Promise.reject(new Error('down')) : base(query, cursor, options),
    );
    await mount(fetchPage as unknown as ReturnType<typeof server>);
    fail = true;
    await act(async () => hook.loadMore());
    await settle();
    expect(hook.status).toBe('error-more');
    fail = false;
    await act(async () => hook.loadMore());
    await settle();
    expect(hook.status).toBe('idle');
    expect(ids()).toEqual(['e', 'd', 'c', 'b']);
  });

  it('retries the first batch on reconnect when it had failed', async () => {
    let down = true;
    const base = server(() => rows);
    const fetchPage = vi.fn(
      (query: Query, cursor: string | null, options: { signal: AbortSignal; limit?: number }) =>
        down ? Promise.reject(new Error('down')) : base(query, cursor, options),
    );
    await mount(fetchPage as unknown as ReturnType<typeof server>);
    expect(hook.status).toBe('error');
    down = false;
    await act(async () => {
      for (const listener of sse.status) listener('closed');
      for (const listener of sse.status) listener('open');
    });
    await settle();
    expect(hook.status).toBe('idle');
    expect(ids()).toEqual(['e', 'd']);
    expect(hook.hasMore).toBe(true);
  });

  it('starts over on reconnect when a list it thought complete has grown past the first batch', async () => {
    rows = rows.slice(0, 2); // e, d — one batch, nothing more to load
    await mount(server(() => rows));
    expect(hook.hasMore).toBe(false);
    // During the outage three older rows arrive, past the first batch's end.
    rows = [
      ...rows,
      { id: 'c', at: 30, tag: 'x' },
      { id: 'b', at: 20, tag: 'y' },
      { id: 'a', at: 10, tag: 'x' },
    ];
    await act(async () => {
      for (const listener of sse.status) listener('connecting');
      for (const listener of sse.status) listener('open');
    });
    await settle();
    await settle();
    expect(hook.total).toBe(5);
    expect(hook.hasMore).toBe(true);
  });

  it('re-counts, rather than adds one, when an edit moves an unloaded row into the loaded range', async () => {
    const fetchPage = server(() => rows);
    await mount(fetchPage);
    expect(ids()).toEqual(['e', 'd']);
    expect(hook.total).toBe(5);
    // 'a' was never loaded; an edit moves it to the top. It was already
    // counted in the server's total, so the total must not grow.
    rows = rows.map((row) => (row.id === 'a' ? { ...row, at: 99 } : row));
    await act(async () => hook.upsert({ id: 'a', at: 99, tag: 'x' }));
    expect(ids()).toEqual(['a', 'e', 'd']);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(fetchPage).toHaveBeenLastCalledWith(ALL, null, expect.objectContaining({ limit: 1 }));
    expect(hook.total).toBe(5);
  });

  it('keeps a batch that lands in the same tick as a live insert', async () => {
    const base = server(() => rows);
    let resolveBatch: (() => void) | undefined;
    const fetchPage = vi.fn(
      (query: Query, cursor: string | null, options: { signal: AbortSignal; limit?: number }) => {
        if (!cursor) return base(query, cursor, options);
        return new Promise<CursorListPage<Row>>((resolve) => {
          resolveBatch = () => void base(query, cursor, options).then(resolve);
        });
      },
    );
    await mount(fetchPage as unknown as ReturnType<typeof server>);
    await act(async () => hook.loadMore());
    // The batch resolves and, before React commits it, another device saves.
    await act(async () => {
      resolveBatch?.();
      for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
      hook.upsert({ id: 'f', at: 60, tag: 'x' }, true);
    });
    await settle();
    expect(ids()).toEqual(['f', 'e', 'd', 'c', 'b']);
  });
});
