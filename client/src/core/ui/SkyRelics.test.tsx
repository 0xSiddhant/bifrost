// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  // A viewport the scatter can place relics in (jsdom's default is 1024×768).
  Object.assign(window, { innerWidth: 1280, innerHeight: 800 });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

/**
 * Lets the lazy chunk resolve. Real time, not a count of turns: the first
 * `import()` of the drawings transforms five modules under Vitest.
 */
async function settle(done: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !done(); i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

const relics = () => container.querySelectorAll('.relic');

// PLAN-41: the drawings are their own chunk, drawn after the first render.
describe('SkyRelics', () => {
  it('draws relics once their chunk arrives', async () => {
    vi.resetModules();
    const { SkyRelics } = await import('./SkyRelics');
    act(() =>
      root.render(
        <MemoryRouter>
          <SkyRelics />
        </MemoryRouter>,
      ),
    );

    await settle(() => relics().length > 0);

    expect(relics().length).toBeGreaterThanOrEqual(1);
    expect(relics().length).toBeLessThanOrEqual(14);
  });

  it('costs only the relics when their chunk cannot be fetched', async () => {
    vi.resetModules();
    const fresh = await import('./SkyRelics');
    const { log } = await import('../log');
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    const load = vi
      .spyOn(fresh.relicScatterChunk, 'load')
      .mockRejectedValue(
        new Error('Failed to fetch dynamically imported module: http://hub/assets/Relic-x.js'),
      );
    act(() =>
      root.render(
        <MemoryRouter>
          <p className="shell-text">the shell</p>
          <fresh.SkyRelics />
        </MemoryRouter>,
      ),
    );

    await settle(() => warn.mock.calls.length > 0);

    // The rest of the shell is untouched; the sky is just empty.
    expect(container.querySelector('.shell-text')?.textContent).toBe('the shell');
    expect(relics()).toHaveLength(0);
    expect(load).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("the relic drawings' chunk could not be loaded");
  });
});
