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

// The join card reads the server URL; it is not what this test is about.
vi.mock('../../core/ui/JoinBifrostCard', () => ({ JoinBifrostCard: () => null }));

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
  // search engines read as the page; transfer is not something it does.
  it('heads the hub with transfer and the standalone site with its tools', () => {
    // Vitest leaves this file's `__HUB__` a global it sets once, so the
    // standalone render sets it beside the build, as a real build bakes both.
    const globals = globalThis as { __BIFROST_BUILD__?: string; __HUB__?: boolean };
    const heading = () => container.querySelector('h1')?.textContent;
    const render = () =>
      act(() =>
        root.render(
          <MemoryRouter>
            <MidgardPage />
          </MemoryRouter>,
        ),
      );
    mocks.modules = ['saga'];
    render();
    expect(heading()).toBe('Your devices, connected.');

    const hub = globals.__HUB__;
    globals.__BIFROST_BUILD__ = 'standalone';
    globals.__HUB__ = false;
    try {
      render();
      expect(heading()).toBe('Developer tools, in your browser.');
      expect(container.textContent).not.toMatch(/Wi-Fi|send and receive/i);
    } finally {
      globals.__BIFROST_BUILD__ = 'hub';
      globals.__HUB__ = hub;
    }
  });
});
