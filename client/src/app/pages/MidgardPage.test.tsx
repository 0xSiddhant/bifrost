// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const mocks = vi.hoisted(() => ({ modules: [] as string[] }));

vi.mock('../../core/useCapabilities', () => ({
  useCapabilities: () => ({ capabilities: { profile: 'local', modules: mocks.modules }, error: null }),
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
  it('shows every door the local profile serves', () => {
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

  // Found by PLAN-32a's cloud project: these three carried no module gate, so a
  // cloud server showed doors into pages whose APIs answer 404.
  it('hides Send, Receive and Hermes when their modules are not loaded (the cloud profile)', () => {
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
});
