// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const status = vi.hoisted(() => ({ listeners: new Set<(status: string) => void>() }));
vi.mock('../sse', () => ({
  bifrostEvents: {
    onStatus: (listener: (status: string) => void) => {
      status.listeners.add(listener);
      return () => status.listeners.delete(listener);
    },
  },
}));

import { showBridgeClosed } from '../bridge';
import { BridgeClosedHost, BridgeClosedPage } from './BridgeClosed';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root.render(
      <MemoryRouter>
        <BridgeClosedHost />
      </MemoryRouter>,
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const sheets = () => container.querySelectorAll('[role="alertdialog"]');
const buttons = () => [...container.querySelectorAll('button')].map((button) => button.textContent);

describe('BridgeClosedHost', () => {
  it('shows nothing until asked', () => {
    expect(sheets()).toHaveLength(0);
  });

  it('shows one sheet however many failures arrive, with "Try again" when the hub is unreachable', () => {
    act(() => {
      showBridgeClosed({ reason: 'unreachable' });
      showBridgeClosed({ reason: 'unreachable' });
      showBridgeClosed({ reason: 'unreachable' });
    });
    expect(sheets()).toHaveLength(1);
    expect(container.textContent).toContain('The Bifröst is closed');
    expect(buttons()).toEqual(['Try again', 'Okay']);
  });

  it('offers no "Try again" on the standalone site, and adds "Download instead" when a page has one', () => {
    const download = vi.fn();
    act(() => showBridgeClosed({ reason: 'standalone' }));
    expect(buttons()).toEqual(['Okay']);
    act(() => showBridgeClosed({ reason: 'standalone', download }));
    expect(sheets()).toHaveLength(1);
    expect(buttons()).toEqual(['Download instead', 'Okay']);

    const downloadButton = [...container.querySelectorAll('button')][0];
    act(() => downloadButton?.click());
    expect(download).toHaveBeenCalledOnce();
    expect(sheets()).toHaveLength(0);
  });

  it('closes itself when the live stream reports the hub open again', () => {
    act(() => showBridgeClosed({ reason: 'unreachable' }));
    expect(sheets()).toHaveLength(1);
    act(() => {
      for (const listener of status.listeners) listener('open');
    });
    expect(sheets()).toHaveLength(0);
  });

  it('"Try again" closes the sheet once the hub answers, and keeps it while it does not', async () => {
    const fetch = vi.fn<() => Promise<Response>>(() => Promise.reject(new TypeError('Failed to fetch')));
    vi.stubGlobal('fetch', fetch);
    act(() => showBridgeClosed({ reason: 'unreachable' }));
    const tryAgain = () => [...container.querySelectorAll('button')].find((b) => b.textContent === 'Try again');

    await act(async () => tryAgain()?.click());
    expect(sheets()).toHaveLength(1);

    fetch.mockResolvedValue(new Response('{}', { status: 200 }));
    await act(async () => tryAgain()?.click());
    expect(fetch).toHaveBeenLastCalledWith('/api/v1/health', expect.anything());
    expect(sheets()).toHaveLength(0);
  });

  it('"Okay" just closes it', () => {
    act(() => showBridgeClosed({ reason: 'unreachable' }));
    const okay = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Okay');
    act(() => okay?.click());
    expect(sheets()).toHaveLength(0);
  });
});

describe('BridgeClosedPage', () => {
  it('is the sheet as a page body, with only "Okay"', () => {
    act(() =>
      root.render(
        <MemoryRouter>
          <BridgeClosedPage />
        </MemoryRouter>,
      ),
    );
    expect(sheets()).toHaveLength(1);
    expect(buttons()).toEqual(['Okay']);
  });
});
