// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const mocks = vi.hoisted(() => ({
  modules: ['runestone', 'edda'] as string[],
  listRunestones: vi.fn(),
  deleteRunestone: vi.fn(),
  listEddas: vi.fn(),
  deleteEdda: vi.fn(),
  subscriptions: [] as string[],
}));

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
    on: (event: string) => {
      mocks.subscriptions.push(event);
      return () => undefined;
    },
  },
}));

vi.mock('../../core/runestone', () => ({
  listRunestones: mocks.listRunestones,
  deleteRunestone: mocks.deleteRunestone,
}));

vi.mock('../../core/edda', () => ({
  listEddas: mocks.listEddas,
  deleteEdda: mocks.deleteEdda,
}));

const { PensievePage } = await import('./PensievePage');

function summary(id: string, name: string, modifiedAt: number) {
  return {
    id,
    name,
    slug: `${name.toLowerCase().replace(/\s+/g, '-')}-${id}`,
    authorDeviceId: 'device-a',
    sizeBytes: 120,
    createdAt: modifiedAt,
    modifiedAt,
  };
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
    mocks.listRunestones.mockResolvedValue([summary('r1', 'Beta config', 50)]);
    mocks.listEddas.mockResolvedValue([summary('e1', 'Alpha notes', 70)]);
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

    const button = container.querySelector<HTMLButtonElement>('[aria-label="Delete Alpha notes"]');
    await act(async () => button?.click());

    expect(mocks.deleteEdda).toHaveBeenCalledWith('e1');
    expect(mocks.deleteRunestone).not.toHaveBeenCalled();
    expect(rowNames()).toEqual(['Beta config']);
  });

  // Criterion 6: one module down must not blank the page.
  it('renders the healthy kind and a Retry strip for the failed one', async () => {
    mocks.listEddas.mockRejectedValue(new Error('502'));
    await open();

    expect(rowNames()).toEqual(['Beta config']);
    const strip = container.querySelector('.lib-failed');
    expect(strip?.textContent).toContain('Markdown');
    expect(chip('Markdown')?.disabled).toBe(true);
  });

  it('retries only the failed kind, and recovers without a reload', async () => {
    mocks.listEddas.mockRejectedValueOnce(new Error('502'));
    await open();
    expect(container.querySelector('.lib-failed')).not.toBeNull();

    mocks.listRunestones.mockClear();
    const retry = [...container.querySelectorAll<HTMLButtonElement>('.lib-failed button')][0];
    await act(async () => retry?.click());

    expect(mocks.listRunestones).not.toHaveBeenCalled();
    expect(container.querySelector('.lib-failed')).toBeNull();
    expect(rowNames()).toEqual(['Alpha notes', 'Beta config']);
  });

  // Criterion 7: a kind the profile does not serve costs nothing at all.
  it('never chips, fetches or subscribes for an absent capability', async () => {
    mocks.modules = ['runestone'];
    await open();

    expect(mocks.listEddas).not.toHaveBeenCalled();
    expect(mocks.subscriptions).toEqual(['runestone.saved', 'runestone.deleted']);
    // One kind means no chip row at all — a filter with one option is decoration.
    expect(container.querySelector('.lib-chips')).toBeNull();
    expect(rowNames()).toEqual(['Beta config']);
  });

  it('searches across kinds, passing the query to every list endpoint', async () => {
    await open();
    mocks.listRunestones.mockResolvedValue([]);
    mocks.listEddas.mockResolvedValue([summary('e1', 'Alpha notes', 70)]);

    await act(async () => type('alpha'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    const expected = { q: 'alpha', author: undefined, sort: 'modified', order: 'desc' };
    expect(mocks.listRunestones).toHaveBeenLastCalledWith(expected);
    expect(mocks.listEddas).toHaveBeenLastCalledWith(expected);
    expect(rowNames()).toEqual(['Alpha notes']);
  });

  it('shows an empty state that tells filtering apart from an empty basin', async () => {
    mocks.listRunestones.mockResolvedValue([]);
    mocks.listEddas.mockResolvedValue([]);
    await open();
    expect(container.querySelector('.empty__title')?.textContent).toBe('Nothing kept yet');

    await act(async () => chip('Markdown')?.click());
    expect(container.querySelector('.empty__title')?.textContent).toBe('Nothing matches');
  });
});
