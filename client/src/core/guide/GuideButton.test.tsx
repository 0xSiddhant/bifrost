// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { GuideButton } from './GuideButton';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

/*
 * The guide bodies are the real files, loaded through Vite's `?raw`, and are
 * deliberately not stubbed: a stub would prove the panel renders *a* string,
 * when the thing worth proving is that the registry's own loaders reach the
 * content that actually ships.
 */

async function tick(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * Wait for a real dynamic import to land. A fixed number of ticks would be a
 * flake waiting to happen — how many turns `import()` takes is Vite's business,
 * not this test's — so this waits on the outcome instead.
 */
async function settleUntil(done: () => boolean, tries = 50): Promise<void> {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    if (done()) return;
    await tick();
  }
  throw new Error('the guide panel never finished loading');
}

describe('GuideButton', () => {
  let container: HTMLDivElement;
  let root: Root;

  const mount = (pathname: string) =>
    act(() =>
      root.render(
        <MemoryRouter initialEntries={[pathname]}>
          <GuideButton />
        </MemoryRouter>,
      ),
    );

  const bulb = () => container.querySelector<HTMLButtonElement>('.guide-button > button');
  const panel = () => container.querySelector('.guide-panel');

  /** Open the drawer and wait for it to settle on content or on its error. */
  const openOn = async (pathname: string) => {
    mount(pathname);
    act(() => bulb()?.click());
    await settleUntil(
      () => (panel()?.querySelector('.guide-panel__body, .guide-panel__status') ?? null) !== null,
    );
    // The status node is also the "Loading…" line; wait past it.
    await settleUntil(() => !/^Loading the /.test(status()));
  };

  const status = () => panel()?.querySelector('.guide-panel__status')?.textContent?.trim() ?? '';

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it.each(['/runestone', '/edda', '/atlas', '/groot', '/loki', '/brotli'])(
    'renders the bulb on %s',
    (pathname) => {
      mount(pathname);
      expect(bulb()).not.toBeNull();
    },
  );

  it.each(['/', '/pensieve', '/variant'])('renders nothing at all on %s', (pathname) => {
    mount(pathname);
    expect(container.innerHTML).toBe('');
  });

  it('loads no guide content until the bulb is actually clicked', async () => {
    mount('/runestone');
    await tick();
    expect(panel()).toBeNull();

    await openOn('/runestone');

    expect(panel()?.querySelector('.guide-panel__body')).not.toBeNull();
  });

  it('shows the matching guide for the page', async () => {
    await openOn('/groot');

    expect(container.querySelector('.guide-panel__title')?.textContent).toBe('YAML');
    // Real content from assets/guides/yaml.md, not a placeholder.
    expect(panel()?.textContent).toContain('advisory rail');
  });

  it('renders the guide through the shared markdown preview, copy buttons and all', async () => {
    await openOn('/runestone');

    expect(panel()?.querySelector('.md-preview')).not.toBeNull();
    expect(panel()?.querySelectorAll('.md-copy').length).toBeGreaterThan(0);
  });

  it('closes on its own ×', async () => {
    await openOn('/edda');
    const close = panel()?.querySelector<HTMLButtonElement>('button[aria-label="Close guide"]');

    act(() => close?.click());

    expect(panel()).toBeNull();
  });

  it('closes on Escape', async () => {
    await openOn('/edda');

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(panel()).toBeNull();
  });

  it('closes on a click outside, but not on one inside', async () => {
    await openOn('/edda');

    act(() => {
      panel()?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    expect(panel()).not.toBeNull();

    act(() => {
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    expect(panel()).toBeNull();
  });

  it('reports a guide that fails to load instead of showing an empty drawer', async () => {
    const registry = await import('./registry');
    const guide = registry.GUIDES.find((entry) => entry.route === '/loki');
    if (!guide) throw new Error('no Loki guide');
    const load = vi.spyOn(guide, 'load').mockRejectedValue(new Error('chunk gone'));

    await openOn('/loki');

    expect(panel()?.textContent).toContain('could not be loaded');
    load.mockRestore();
  });
});
