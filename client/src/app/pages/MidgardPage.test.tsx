// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const mocks = vi.hoisted(() => ({ modules: [] as string[] }));

vi.mock('../../core/features', () => ({
  hasFeature: (id: string) => mocks.modules.includes(id),
}));

// The join card reads the server URL; a marker stands in for it here.
vi.mock('../../core/ui/JoinBifrostCard', () => ({
  JoinBifrostCard: () => <section className="join-card">Join Bifrost</section>,
}));

const { MidgardPage } = await import('./MidgardPage');

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function doors(): string[] {
  return [...container.querySelectorAll('a')].map((link) => link.getAttribute('href') ?? '');
}

describe('MidgardPage', () => {
  it('shows every door the hub build ships', () => {
    mocks.modules = ['file-transfer', 'clipboard', 'accio', 'saga'];
    act(() =>
      root.render(
        <MemoryRouter>
          <MidgardPage />
        </MemoryRouter>,
      ),
    );
    expect(doors()).toEqual(['/upload', '/downloads', '/hermes', '/accio', '/saga']);
  });

  // PLAN-32a's cloud project found these three carried no gate; since PLAN-35
  // the gate is the build's own feature list, and standalone keeps only Saga.
  it('keeps only Saga when the build ships none of the transfer doors (standalone)', () => {
    mocks.modules = ['saga', 'runestone'];
    act(() =>
      root.render(
        <MemoryRouter>
          <MidgardPage />
        </MemoryRouter>,
      ),
    );
    expect(doors()).toEqual(['/saga']);
  });

  // The standalone home is a public tools site, and its heading is what
  // search engines read as the page; transfer and saved eddas need the hub.
  it('heads and describes the hub and the standalone site each as what they are', async () => {
    // Vitest leaves this file's `__HUB__` a global it sets once, so the
    // standalone render sets it beside the build, as a real build bakes both,
    // and imports the page again, since the portal list is built on import.
    const globals = globalThis as { __BIFROST_BUILD__?: string; __HUB__?: boolean };
    const heading = () => container.querySelector('h1')?.textContent;
    mocks.modules = ['saga'];
    act(() =>
      root.render(
        <MemoryRouter>
          <MidgardPage />
        </MemoryRouter>,
      ),
    );
    expect(heading()).toBe('Your devices, connected.');
    expect(container.textContent).toContain('open a saved edda');

    const hub = globals.__HUB__;
    globals.__BIFROST_BUILD__ = 'standalone';
    globals.__HUB__ = false;
    try {
      vi.resetModules();
      const standalone = await import('./MidgardPage');
      act(() =>
        root.render(
          <MemoryRouter>
            <standalone.MidgardPage />
          </MemoryRouter>,
        ),
      );
      expect(heading()).toBe('Developer tools, in your browser.');
      expect(container.textContent).not.toMatch(/Wi-Fi|send and receive|saved edda/i);
      expect(container.textContent).toContain('a markdown deck or a PDF');
    } finally {
      globals.__BIFROST_BUILD__ = 'hub';
      globals.__HUB__ = hub;
      vi.resetModules();
    }
  });

  // PLAN-40: the card (and with it `qrcode`) loads after the page.
  describe('the Join card', () => {
    async function settle(done: () => boolean): Promise<void> {
      for (let i = 0; i < 100 && !done(); i += 1) {
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
      }
    }
    const card = () => container.querySelector('.join-card:not(.join-card--placeholder)');

    it('arrives after the page, in a placeholder that keeps its place', async () => {
      mocks.modules = ['file-transfer', 'saga'];
      vi.resetModules();
      const fresh = await import('./MidgardPage');
      act(() =>
        root.render(
          <MemoryRouter>
            <fresh.MidgardPage />
          </MemoryRouter>,
        ),
      );
      // The portals are there at once; the card's place is held for it.
      expect(doors()).toEqual(['/upload', '/downloads', '/saga']);
      expect(container.querySelector('.join-card--placeholder')).not.toBeNull();

      await settle(() => card() !== null);

      expect(card()?.textContent).toBe('Join Bifrost');
      expect(container.querySelector('.join-card--placeholder')).toBeNull();
    });

    it('costs only itself when its chunk cannot be fetched', async () => {
      mocks.modules = ['file-transfer', 'saga'];
      vi.resetModules();
      const fresh = await import('./MidgardPage');
      const { log } = await import('../../core/log');
      const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
      vi.spyOn(fresh.joinCardChunk, 'load').mockRejectedValue(
        new Error('Failed to fetch dynamically imported module: http://hub/assets/Join-x.js'),
      );
      act(() =>
        root.render(
          <MemoryRouter>
            <fresh.MidgardPage />
          </MemoryRouter>,
        ),
      );

      await settle(() => container.querySelector('.join-card--placeholder') === null);

      // The rest of the home page is still there; only the card is missing.
      expect(container.querySelector('h1')?.textContent).toBe('Your devices, connected.');
      expect(doors()).toEqual(['/upload', '/downloads', '/saga']);
      expect(card()).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      vi.restoreAllMocks();
    });
  });
});
