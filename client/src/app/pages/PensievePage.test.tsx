// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

interface Summary {
  id: string;
  name: string;
  slug: string;
  authorDeviceId: string | null;
  sizeBytes: number;
  createdAt: number;
  modifiedAt: number;
}

interface PageQuery {
  q?: string;
  author?: string;
  sort: 'name' | 'created' | 'modified' | 'size';
  order: 'asc' | 'desc';
}

const mocks = vi.hoisted(() => ({
  modules: ['runestone', 'edda'] as string[],
  data: { runestone: [] as Summary[], edda: [] as Summary[] },
  pageSize: 2,
  down: new Set<string>(),
  /** When set, every list request waits on it — a request held in flight. */
  gate: null as Promise<void> | null,
  calls: [] as Array<{ kind: string; query: PageQuery; offset: number }>,
  deleteRunestone: vi.fn(),
  deleteEdda: vi.fn(),
  subscriptions: [] as string[],
  listeners: new Map<string, Array<(payload: unknown) => void>>(),
  statusListeners: [] as Array<(status: string) => void>,
}));

/** A paged list endpoint over `mocks.data[kind]`, ordered the way the servers are. */
function servePage(kind: 'runestone' | 'edda') {
  return async (query: PageQuery, request: { offset: number; limit?: number }) => {
    mocks.calls.push({ kind, query, offset: request.offset });
    if (mocks.gate) await mocks.gate;
    if (mocks.down.has(kind)) return Promise.reject(new Error('502'));
    const direction = query.order === 'asc' ? 1 : -1;
    const keyOf = (row: Summary): number | string =>
      query.sort === 'name'
        ? row.name.toLowerCase()
        : query.sort === 'size'
          ? row.sizeBytes
          : query.sort === 'created'
            ? row.createdAt
            : row.modifiedAt;
    const rows = mocks.data[kind]
      .filter((row) => !query.q || row.name.toLowerCase().includes(query.q.toLowerCase()))
      .filter((row) => !query.author || row.authorDeviceId === query.author)
      .sort((a, b) => {
        const ka = keyOf(a);
        const kb = keyOf(b);
        if (ka !== kb) return (ka < kb ? -1 : 1) * direction;
        return (a.id < b.id ? -1 : 1) * direction;
      });
    const limit = request.limit ?? mocks.pageSize;
    return Promise.resolve({
      items: rows.slice(request.offset, request.offset + limit),
      total: rows.length,
      limit,
      offset: request.offset,
      authors: [
        ...new Set(
          mocks.data[kind].flatMap((row) => (row.authorDeviceId ? [row.authorDeviceId] : [])),
        ),
      ],
    });
  };
}

vi.mock('../../core/useCapabilities', () => ({
  useCapabilities: () => ({
    capabilities: { profile: 'local', modules: mocks.modules },
    error: null,
  }),
}));

vi.mock('../../core/devices', () => ({
  deviceName: (id: string) => `device ${id}`,
  onDevicesChange: () => () => undefined,
}));

vi.mock('../../core/sse', () => ({
  bifrostEvents: {
    on: (event: string, listener: (payload: unknown) => void) => {
      mocks.subscriptions.push(event);
      const list = mocks.listeners.get(event) ?? [];
      list.push(listener);
      mocks.listeners.set(event, list);
      return () => {
        mocks.listeners.set(
          event,
          (mocks.listeners.get(event) ?? []).filter((fn) => fn !== listener),
        );
      };
    },
    onStatus: (listener: (status: string) => void) => {
      mocks.statusListeners.push(listener);
      return () => {
        mocks.statusListeners = mocks.statusListeners.filter((fn) => fn !== listener);
      };
    },
  },
}));

vi.mock('../../core/runestone', () => ({
  listRunestonesPage: servePage('runestone'),
  deleteRunestone: mocks.deleteRunestone,
}));

vi.mock('../../core/edda', () => ({
  listEddasPage: servePage('edda'),
  deleteEdda: mocks.deleteEdda,
}));

const { PensievePage } = await import('./PensievePage');

function summary(
  id: string,
  name: string,
  modifiedAt: number,
  authorDeviceId = 'device-a',
): Summary {
  return {
    id,
    name,
    slug: `${name.toLowerCase().replace(/\s+/g, '-')}-${id}`,
    authorDeviceId,
    sizeBytes: 120,
    createdAt: modifiedAt,
    modifiedAt,
  };
}

/** Deliver an SSE event to every subscribed listener. */
function emit(event: string, payload: unknown = {}) {
  for (const listener of mocks.listeners.get(event) ?? []) listener(payload);
}

let location = '';

function LocationProbe() {
  const current = useLocation();
  location = `${current.pathname}${current.search}`;
  return null;
}

describe('PensievePage', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    mocks.modules = ['runestone', 'edda'];
    mocks.subscriptions = [];
    mocks.data = {
      runestone: [summary('r1', 'Beta config', 50)],
      edda: [summary('e1', 'Alpha notes', 70)],
    };
    mocks.pageSize = 2;
    mocks.down = new Set();
    mocks.gate = null;
    mocks.calls = [];
    mocks.listeners = new Map();
    mocks.statusListeners = [];
    mocks.deleteRunestone.mockResolvedValue(null);
    mocks.deleteEdda.mockResolvedValue(null);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  /** Render at `entry` and let the debounce plus the fan-out settle. */
  async function open(entry = '/pensieve') {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[entry]}>
          <LocationProbe />
          <PensievePage />
        </MemoryRouter>,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
  }

  const rowNames = () =>
    [...container.querySelectorAll('.lib-row__name')].map((node) => node.textContent);
  /**
   * React keeps its own value tracker on a controlled input and drops an event
   * whose value it believes unchanged — so the native setter has to be used.
   */
  function type(value: string) {
    const input = container.querySelector<HTMLInputElement>('.lib-search input');
    if (!input) throw new Error('search input missing');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  const chip = (label: string) =>
    [...container.querySelectorAll<HTMLButtonElement>('.lib-chip')].find(
      (node) => node.textContent?.trim() === label,
    );

  it('lists both kinds in one sorted list, each with a type badge', async () => {
    await open();

    expect(rowNames()).toEqual(['Alpha notes', 'Beta config']);
    expect([...container.querySelectorAll('.lib-badge')].map((n) => n.textContent)).toEqual([
      'Markdown',
      'JSON',
    ]);
  });

  // Criterion 2: the chip writes the URL, and the URL is what filters.
  it('filters to one kind and back through the URL', async () => {
    await open();

    await act(async () => chip('Markdown')?.click());
    expect(location).toBe('/pensieve?type=edda');
    expect(rowNames()).toEqual(['Alpha notes']);

    await act(async () => chip('All')?.click());
    expect(location).toBe('/pensieve');
    expect(rowNames()).toEqual(['Alpha notes', 'Beta config']);
  });

  it('deep-links straight to a filtered view', async () => {
    await open('/pensieve?type=runestone');

    expect(rowNames()).toEqual(['Beta config']);
    expect(chip('JSON')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('ignores a ?type= naming a kind this profile does not have', async () => {
    await open('/pensieve?type=groot');

    expect(rowNames()).toEqual(['Alpha notes', 'Beta config']);
    expect(chip('All')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('confirms before deleting, and does not fire when refused', async () => {
    await open();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

    const button = container.querySelector<HTMLButtonElement>('[aria-label="Delete Alpha notes"]');
    await act(async () => button?.click());

    expect(confirm).toHaveBeenCalled();
    expect(mocks.deleteEdda).not.toHaveBeenCalled();
    expect(rowNames()).toEqual(['Alpha notes', 'Beta config']);
  });

  it('deletes through the row own kind client and drops the row', async () => {
    await open();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mocks.deleteEdda.mockImplementation((id: string) => {
      mocks.data.edda = mocks.data.edda.filter((row) => row.id !== id);
      return Promise.resolve(null);
    });

    const button = container.querySelector<HTMLButtonElement>('[aria-label="Delete Alpha notes"]');
    await act(async () => button?.click());

    expect(mocks.deleteEdda).toHaveBeenCalledWith('e1');
    expect(mocks.deleteRunestone).not.toHaveBeenCalled();
    expect(rowNames()).toEqual(['Beta config']);
  });

  // Criterion 6: one module down must not blank the page.
  it('renders the healthy kind and a Retry strip for the failed one', async () => {
    mocks.down.add('edda');
    await open();

    expect(rowNames()).toEqual(['Beta config']);
    const strip = container.querySelector('.lib-failed');
    expect(strip?.textContent).toContain('Markdown');
    expect(chip('Markdown')?.disabled).toBe(true);
  });

  // PLAN-31: Retry rebuilds the current page with the recovered kind merged
  // back in — its rows change where every page boundary falls.
  it('retries by rebuilding the current page with the recovered kind included', async () => {
    mocks.data.runestone = [summary('r1', 'R one', 90), summary('r2', 'R two', 50)];
    mocks.data.edda = [summary('e1', 'E one', 80), summary('e2', 'E two', 40)];
    mocks.down.add('edda');
    await open('/pensieve?page=1');
    expect(container.querySelector('.lib-failed')).not.toBeNull();
    expect(rowNames()).toEqual(['R one', 'R two']);

    mocks.down.clear();
    const retry = [...container.querySelectorAll<HTMLButtonElement>('.lib-failed button')][0];
    await act(async () => retry?.click());

    expect(container.querySelector('.lib-failed')).toBeNull();
    expect(rowNames()).toEqual(['R one', 'E one']);
    expect(container.querySelector('.lib-status')?.textContent).toContain('Showing 1–2 of 4');
  });

  // Criterion 7: a kind the profile does not serve costs nothing at all.
  it('never chips, fetches or subscribes for an absent capability', async () => {
    mocks.modules = ['runestone'];
    await open();

    expect(mocks.calls.some((call) => call.kind === 'edda')).toBe(false);
    expect(mocks.subscriptions).toEqual(['runestone.saved', 'runestone.deleted']);
    // One kind means no chip row at all — a filter with one option is decoration.
    expect(container.querySelector('.lib-chips')).toBeNull();
    expect(rowNames()).toEqual(['Beta config']);
  });

  it('searches across kinds, passing the query to every list endpoint', async () => {
    await open();

    await act(async () => type('alpha'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    const expected = { q: 'alpha', author: undefined, sort: 'modified', order: 'desc' };
    const last = (kind: string) => mocks.calls.filter((call) => call.kind === kind).at(-1)?.query;
    expect(last('runestone')).toEqual(expected);
    expect(last('edda')).toEqual(expected);
    expect(rowNames()).toEqual(['Alpha notes']);
  });

  // Acceptance 13 (PLAN-28): the row action follows Saga's own capability, not
  // the row's kind — an edda is presentable, but only where Saga is loaded.
  it('offers Present on edda rows only while the saga module is loaded', async () => {
    mocks.modules = ['runestone', 'edda', 'saga'];
    await open();

    const present = [...container.querySelectorAll('.lib-row__link')].filter((node) =>
      node.textContent?.includes('Present'),
    );
    expect(present).toHaveLength(1);
    expect(present[0]?.getAttribute('href')).toBe('/saga/alpha-notes-e1');
  });

  it('drops Present everywhere when the saga module is absent', async () => {
    mocks.modules = ['runestone', 'edda'];
    await open();

    expect(container.textContent).not.toContain('Present');
  });

  it('shows an empty state that tells filtering apart from an empty basin', async () => {
    mocks.data = { runestone: [], edda: [] };
    await open();
    expect(container.querySelector('.empty__title')?.textContent).toBe('Nothing kept yet');

    await act(async () => chip('Markdown')?.click());
    expect(container.querySelector('.empty__title')?.textContent).toBe('Nothing matches');
  });
  // ── PLAN-31: numbered pages ────────────────────────────────────────────
  /** Five documents over two kinds: E5, R4, E3, R2, E1 newest first. */
  function fiveDocs() {
    mocks.data.runestone = [summary('r4', 'R4', 40, 'phone'), summary('r2', 'R2', 20, 'phone')];
    mocks.data.edda = [summary('e5', 'E5', 50), summary('e3', 'E3', 30), summary('e1', 'E1', 10)];
  }
  const pagerLinks = () =>
    [...container.querySelectorAll<HTMLAnchorElement>('.pager a')].map((a) => a.textContent);
  const settle = async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
  };

  it('pages the merged list: Showing X–Y of Z, and a pager with the current page marked', async () => {
    fiveDocs();
    await open();
    expect(rowNames()).toEqual(['E5', 'R4']);
    expect(container.querySelector('.lib-status')?.textContent).toContain('Showing 1–2 of 5');
    expect(pagerLinks()).toEqual(['1', '2', '3', '']);
    expect(container.querySelector('.pager [aria-current="page"]')?.textContent).toBe('1');

    const two = container.querySelector<HTMLAnchorElement>('.pager a[aria-label="Page 2"]');
    await act(async () => two?.click());
    await settle();
    expect(location).toBe('/pensieve?page=2');
    expect(rowNames()).toEqual(['E3', 'R2']);
  });

  it('opens a deep page cold and clamps or ignores a bad ?page=', async () => {
    fiveDocs();
    await open('/pensieve?page=3');
    expect(rowNames()).toEqual(['E1']);
    expect(container.querySelector('.lib-status')?.textContent).toContain('Showing 5–5 of 5');
  });

  it.each([
    ['/pensieve?page=0', '/pensieve', ['E5', 'R4']],
    ['/pensieve?page=abc', '/pensieve', ['E5', 'R4']],
    ['/pensieve?page=999', '/pensieve?page=3', ['E1']],
  ])('reads %s as the right page', async (entry, expected, names) => {
    fiveDocs();
    await open(entry);
    expect(location).toBe(expected);
    expect(rowNames()).toEqual(names);
  });

  it('a type chip fetches only that kind and resets the page', async () => {
    fiveDocs();
    await open('/pensieve?page=2');
    await act(async () => chip('Markdown')?.click());
    await settle();
    expect(location).toBe('/pensieve?type=edda');
    expect(rowNames()).toEqual(['E5', 'E3']);
    expect(container.querySelector('.lib-status')?.textContent).toContain('of 3');
  });

  it('refetches page 1 on a live change, but only shows a chip on a later page', async () => {
    fiveDocs();
    await open();
    mocks.data.edda.push(summary('e9', 'E9', 99));
    await act(async () => emit('edda.saved'));
    await settle();
    expect(rowNames()).toEqual(['E9', 'E5']);
    expect(container.querySelector('.lib-stale')).toBeNull();

    const two = container.querySelector<HTMLAnchorElement>('.pager a[aria-label="Page 2"]');
    await act(async () => two?.click());
    await settle();
    const before = rowNames();
    mocks.data.edda.push(summary('e8', 'E8', 98));
    await act(async () => emit('edda.saved'));
    await settle();
    expect(rowNames()).toEqual(before);
    expect(container.querySelector('.lib-stale')?.textContent).toContain('The library changed');

    const refresh = container.querySelector<HTMLButtonElement>('.lib-stale button');
    await act(async () => refresh?.click());
    await settle();
    expect(container.querySelector('.lib-stale')).toBeNull();
    // E9, E8, E5, R4, … — page 2 is rebuilt from the top.
    expect(rowNames()).toEqual(['E5', 'R4']);
  });

  it('treats an SSE reconnect as a change', async () => {
    fiveDocs();
    await open('/pensieve?page=2');
    await act(async () => {
      for (const listener of mocks.statusListeners) listener('connecting');
      for (const listener of mocks.statusListeners) listener('open');
    });
    expect(container.querySelector('.lib-stale')).not.toBeNull();
  });

  it('refetches in place after an own delete, without raising the chip for its echo', async () => {
    fiveDocs();
    await open('/pensieve?page=2');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mocks.deleteEdda.mockImplementation((id: string) => {
      mocks.data.edda = mocks.data.edda.filter((row) => row.id !== id);
      return Promise.resolve(null);
    });

    const button = container.querySelector<HTMLButtonElement>('[aria-label="Delete E3"]');
    await act(async () => button?.click());
    await act(async () => emit('edda.deleted', { id: 'e3', name: 'E3' }));
    await settle();

    expect(rowNames()).toEqual(['R2', 'E1']);
    expect(container.querySelector('.lib-stale')).toBeNull();
  });

  it('steps back to the new last page when an own delete empties the last one', async () => {
    fiveDocs();
    await open('/pensieve?page=3');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mocks.deleteEdda.mockImplementation((id: string) => {
      mocks.data.edda = mocks.data.edda.filter((row) => row.id !== id);
      return Promise.resolve(null);
    });

    const button = container.querySelector<HTMLButtonElement>('[aria-label="Delete E1"]');
    await act(async () => button?.click());
    await settle();

    expect(location).toBe('/pensieve?page=2');
    expect(rowNames()).toEqual(['E3', 'R2']);
  });

  it('lists every author from the facet, and keeps the current selection selectable', async () => {
    fiveDocs();
    await open();
    const options = () =>
      [
        ...container.querySelectorAll<HTMLOptionElement>(
          'select[aria-label="Filter by device"] option',
        ),
      ].map((option) => option.value);
    expect(options().sort()).toEqual(['', 'device-a', 'phone']);

    const select = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Filter by device"]',
    );
    await act(async () => {
      if (!select) return;
      select.value = 'phone';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();
    // Only runestones were saved from the phone; switching to Markdown keeps
    // "phone" as an option even though no edda author matches it.
    await act(async () => chip('Markdown')?.click());
    await settle();
    expect(options()).toContain('phone');
    expect(select?.value).toBe('phone');
  });

  it('does not let a live change on page 1 undo a click to page 2 still in flight', async () => {
    fiveDocs();
    await open();
    const two = container.querySelector<HTMLAnchorElement>('.pager a[aria-label="Page 2"]');
    let release = () => undefined as void;
    mocks.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // The walk to page 2 is now in flight and held there…
    await act(async () => two?.click());
    // …when another device saves, and the page-1 refresh window passes.
    mocks.data.edda.push(summary('e9', 'E9', 99));
    await act(async () => emit('edda.saved'));
    await settle();
    mocks.gate = null;
    await act(async () => release());
    await settle();
    await settle();
    expect(location).toBe('/pensieve?page=2');
    // E9, E5 | R4, E3 — page 2 of the list as it now is.
    expect(rowNames()).toEqual(['R4', 'E3']);
  });
});
