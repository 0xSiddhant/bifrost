// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Dropzone } from './Dropzone';

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
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Dropzone', () => {
  // Saved manuscripts live in the hub's Pensieve; the standalone site has none.
  it('offers the Pensieve on the hub only', () => {
    // Vitest leaves `__HUB__` a global it sets once, so set it beside the build.
    const globals = globalThis as { __BIFROST_BUILD__?: string; __HUB__?: boolean };
    const pensieve = () => container.querySelector('a[href^="/pensieve"]');
    act(() => root.render(<Dropzone onFile={() => {}} />));
    expect(pensieve()).not.toBeNull();

    const hub = globals.__HUB__;
    globals.__BIFROST_BUILD__ = 'standalone';
    globals.__HUB__ = false;
    try {
      act(() => root.render(<Dropzone key="standalone" onFile={() => {}} />));
      expect(pensieve()).toBeNull();
      expect(container.textContent).not.toMatch(/saved manuscript/);
      expect(container.textContent).toContain('Never uploaded, never stored.');
    } finally {
      globals.__BIFROST_BUILD__ = 'hub';
      globals.__HUB__ = hub;
    }
  });
});
