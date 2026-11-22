// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Season } from './types';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  vi.resetModules();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

/** Lets the idle wait and the season's chunk resolve. */
async function settle(done: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !done(); i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

/** A season no code in the app knows: the slots must work with any. */
function fakeSeason(load: Season['load']): Season {
  return {
    id: 'fake',
    label: 'Fake',
    decorations: [
      { id: 'flurry', slot: 'sky', label: 'Flurry', description: 'Falls.', switchable: true },
      { id: 'banner', slot: 'header', label: 'Banner', description: 'Hangs.', switchable: false },
    ],
    load,
  };
}

const components = {
  flurry: () => <span className="fake-flurry" />,
  banner: () => <span className="fake-banner" />,
};

/** Fresh modules (a clean registry and chunk cache), with the theme's tokens stubbed. */
async function setup(tokens: Record<string, string>, season: Season | null) {
  const theme = await import('../theme');
  vi.spyOn(theme.themeEngine, 'getActiveTokens').mockReturnValue(tokens);
  const registry = await import('./registry');
  registry.installSeason(season);
  const { DecorSlot } = await import('./DecorSlot');
  const prefs = await import('./prefs');
  const { log } = await import('../log');
  return { DecorSlot, prefs, theme, log };
}

const slotState = (slot: string) =>
  container.querySelector(`[data-decor-slot="${slot}"]`)?.getAttribute('data-decor-state');

describe('decoration slots', () => {
  it('render an empty marker and load nothing with no season installed', async () => {
    const { DecorSlot } = await setup({ '--decor-flurry': '1' }, null);
    act(() => root.render(<DecorSlot slot="sky" />));
    await settle(() => false);
    expect(slotState('sky')).toBe('empty');
    expect(container.querySelector('.fake-flurry')).toBeNull();
  });

  it("draw the season's decorations the theme turns on, fetching its chunk once", async () => {
    const load = vi.fn(() => Promise.resolve(components));
    const { DecorSlot } = await setup({ '--decor-flurry': '1' }, fakeSeason(load));
    act(() =>
      root.render(
        <>
          <DecorSlot slot="sky" />
          <DecorSlot slot="header" />
          <DecorSlot slot="footer" />
        </>,
      ),
    );
    await settle(() => slotState('sky') === 'ready');

    expect(container.querySelectorAll('.fake-flurry')).toHaveLength(1);
    // The theme does not turn the banner on, and the footer has nothing.
    expect(container.querySelector('.fake-banner')).toBeNull();
    expect(slotState('header')).toBe('empty');
    expect(slotState('footer')).toBe('empty');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('drop a decoration this device switches off, and bring it back', async () => {
    const { DecorSlot, prefs } = await setup(
      { '--decor-flurry': '1' },
      fakeSeason(() => Promise.resolve(components)),
    );
    act(() => root.render(<DecorSlot slot="sky" />));
    await settle(() => slotState('sky') === 'ready');

    act(() => prefs.setDecorationEnabled('flurry', false));
    expect(container.querySelector('.fake-flurry')).toBeNull();
    expect(slotState('sky')).toBe('empty');

    act(() => prefs.setDecorationEnabled('flurry', true));
    await settle(() => container.querySelector('.fake-flurry') !== null);
    expect(container.querySelector('.fake-flurry')).not.toBeNull();
  });

  it('cost only the decorations when the chunk cannot load: one warn for every slot', async () => {
    const { DecorSlot, log } = await setup(
      { '--decor-flurry': '1', '--decor-banner': '1' },
      fakeSeason(() => Promise.reject(new Error('Failed to fetch dynamically imported module'))),
    );
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    act(() =>
      root.render(
        <>
          <p className="shell-text">the shell</p>
          <DecorSlot slot="sky" />
          <DecorSlot slot="header" />
        </>,
      ),
    );
    await settle(() => slotState('sky') === 'failed' && slotState('header') === 'failed');
    expect(container.querySelector('.shell-text')?.textContent).toBe('the shell');
    expect(container.querySelector('.fake-flurry')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain(
      "the fake season's decorations could not be loaded",
    );
  });

  it('fetch again when a slot that failed next mounts, reporting loading until it lands', async () => {
    let release: (value: typeof components) => void = () => {};
    const load = vi
      .fn<Season['load']>()
      .mockRejectedValueOnce(new Error('Timed out fetching dynamically imported module'))
      .mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const { DecorSlot, prefs, log } = await setup({ '--decor-flurry': '1' }, fakeSeason(load));
    vi.spyOn(log, 'warn').mockImplementation(() => {});
    act(() => root.render(<DecorSlot slot="sky" />));
    await settle(() => slotState('sky') === 'failed');

    // The switch turns the decoration off and on: the slot remounts and asks again.
    act(() => prefs.setDecorationEnabled('flurry', false));
    expect(slotState('sky')).toBe('empty');
    act(() => prefs.setDecorationEnabled('flurry', true));
    await settle(() => load.mock.calls.length === 2);
    expect(slotState('sky')).toBe('loading');

    await act(async () => release(components));
    await settle(() => slotState('sky') === 'ready');
    expect(container.querySelector('.fake-flurry')).not.toBeNull();
  });

  it("contain a decoration's own bug: the shell stays, the slot is emptied and the error logged", async () => {
    const broken = {
      ...components,
      flurry: () => {
        throw new TypeError('flake is undefined');
      },
    };
    const { DecorSlot, log } = await setup(
      { '--decor-flurry': '1' },
      fakeSeason(() => Promise.resolve(broken)),
    );
    const reported = vi.spyOn(log, 'reportError').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    act(() =>
      root.render(
        <>
          <p className="shell-text">the shell</p>
          <DecorSlot slot="sky" />
        </>,
      ),
    );
    await settle(() => slotState('sky') === 'failed');
    expect(container.querySelector('.shell-text')?.textContent).toBe('the shell');
    expect(reported).toHaveBeenCalledTimes(1);
    expect(String(reported.mock.calls[0]?.[0])).toContain('in the sky slot failed and was removed');
  });
});

describe('decoration prefs', () => {
  it('leave every decoration on until a device switches one off', async () => {
    const prefs = await import('./prefs');
    expect(prefs.isDecorationEnabled('flurry')).toBe(true);
    prefs.setDecorationEnabled('flurry', false);
    expect(prefs.isDecorationEnabled('flurry')).toBe(false);
    expect(prefs.isDecorationEnabled('banner')).toBe(true);
    expect(localStorage.getItem('bifrost.decor.off')).toBe('["flurry"]');
    prefs.setDecorationEnabled('flurry', true);
    expect(localStorage.getItem('bifrost.decor.off')).toBeNull();
  });

  it('read as all on when the store throws (private mode)', async () => {
    const prefs = await import('./prefs');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(prefs.isDecorationEnabled('flurry')).toBe(true);
    expect(() => prefs.setDecorationEnabled('flurry', false)).not.toThrow();
  });

  it('still switch a decoration off for this session when the store refuses the write', async () => {
    const prefs = await import('./prefs');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const before = prefs.decorPrefsSnapshot();
    prefs.setDecorationEnabled('flurry', false);
    expect(prefs.isDecorationEnabled('flurry')).toBe(false);
    // A new snapshot, so the slots re-render and the snow actually stops.
    expect(prefs.decorPrefsSnapshot()).not.toBe(before);
    prefs.setDecorationEnabled('flurry', true);
    expect(prefs.isDecorationEnabled('flurry')).toBe(true);
  });

  it("hear another tab's switch through the storage event", async () => {
    const prefs = await import('./prefs');
    const listener = vi.fn();
    const stop = prefs.onDecorPrefsChange(listener);
    window.dispatchEvent(new StorageEvent('storage', { key: 'bifrost.decor.off' }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'bifrost.theme' }));
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    window.dispatchEvent(new StorageEvent('storage', { key: 'bifrost.decor.off' }));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('optInLevel', () => {
  it('reads a 0–1 token, and anything else as off', async () => {
    const { optInLevel } = await import('./useSlotDecorations');
    expect(optInLevel({ '--decor-x': '1' }, '--decor-x')).toBe(1);
    expect(optInLevel({ '--decor-x': '0.6' }, '--decor-x')).toBe(0.6);
    expect(optInLevel({ '--decor-x': '3' }, '--decor-x')).toBe(1);
    expect(optInLevel({ '--decor-x': '0' }, '--decor-x')).toBe(0);
    expect(optInLevel({ '--decor-x': 'lots' }, '--decor-x')).toBe(0);
    expect(optInLevel({}, '--decor-x')).toBe(0);
  });
});
