// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RouteBoundary } from './RouteBoundary';
import { ErrorBoundary } from './ErrorBoundary';
import { log } from '../log';
import { notifications } from '../notify';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const CHUNK_ERROR = 'Failed to fetch dynamically imported module: /assets/LokiPage-x.js';

function Boom({ message }: { message: string | null }): React.ReactElement {
  if (message) throw new Error(message);
  return <p>the page</p>;
}

describe('RouteBoundary', () => {
  let container: HTMLDivElement;
  let root: Root;
  let consoleError: ReturnType<typeof vi.spyOn>;
  let warn: ReturnType<typeof vi.spyOn>;
  let reportedError: ReturnType<typeof vi.spyOn>;
  let onRetry: ReturnType<typeof vi.fn<() => void>>;
  let bridgeUp: boolean;

  /** Render, then let the bridge probe settle. */
  const render = async (message: string | null, pathname = '/loki', retryToken = 0) => {
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <RouteBoundary pathname={pathname} retryToken={retryToken} onRetry={onRetry}>
            <Boom message={message} />
          </RouteBoundary>
        </ErrorBoundary>,
      );
    });
    await act(async () => {});
  };

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    onRetry = vi.fn<() => void>();
    bridgeUp = false;
    // React logs caught render errors itself; keep the test output readable.
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    reportedError = vi.spyOn(log, 'error').mockImplementation(() => {});
    // The boundary asks the server directly whether it is there; the SSE status
    // lags a network drop by seconds and cannot be trusted for this.
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      bridgeUp
        ? Promise.resolve(new Response('{}', { status: 200 }))
        : Promise.reject(new TypeError('Failed to fetch')),
    );
    notifications.dismissKey('route-unavailable');
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    notifications.dismissKey('route-unavailable');
    vi.restoreAllMocks();
    void consoleError;
  });

  it('renders its children when the chunk arrives', async () => {
    await render(null);
    expect(container.textContent).toContain('the page');
  });

  it('replaces only the page — not the app — when a chunk cannot be fetched', async () => {
    await render(CHUNK_ERROR);
    expect(container.textContent).toContain('Not available offline');
    // The app-wide crash card is what this exists to avoid.
    expect(container.querySelector('.crash')).toBeNull();
    expect(container.textContent).toContain('Try again');
  });

  it('raises the popup once and logs a warn, not a crash report', async () => {
    await render(CHUNK_ERROR);
    expect(notifications.getSnapshot().visible.some((n) => n.kind === 'error')).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect((warn.mock.calls[0] as [string])[0]).toContain('route chunk unavailable');
    expect(reportedError).not.toHaveBeenCalled();
  });

  it('hands a real render bug to the app-wide boundary instead of swallowing it', async () => {
    await render("Cannot read properties of undefined (reading 'map')");
    expect(container.querySelector('.crash')).not.toBeNull();
    expect(container.textContent).toContain('The bridge wavered');
    // Reported by the app-wide boundary, and not also by this one.
    expect(reportedError).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('reports one failure once, even when React re-renders and re-throws it', async () => {
    await render(CHUNK_ERROR);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(notifications.getSnapshot().visible[0]?.count).toBe(1);
  });

  it('clears the failure when the route changes, so a later visit retries', async () => {
    await render(CHUNK_ERROR);
    expect(container.textContent).toContain('Not available offline');
    await render(null, '/edda');
    expect(container.textContent).toContain('the page');
  });

  it('asks the app to rebuild the pages rather than clearing itself', async () => {
    await render(CHUNK_ERROR);
    const retry = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Try again',
    );
    act(() => retry?.click());

    // Clearing alone would re-throw React's cached rejection without fetching
    // anything, so the app owns the retry and answers with a new token.
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Not available offline');

    await render(null, '/loki', 1);
    expect(container.textContent).toContain('the page');
  });

  it('retries by itself once the bridge answers again', async () => {
    vi.useFakeTimers();
    try {
      await render(CHUNK_ERROR);
      expect(onRetry).not.toHaveBeenCalled();

      // Still down: asking again changes nothing.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(onRetry).not.toHaveBeenCalled();

      bridgeUp = true;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      // Recovering without waiting for the user to find the button is the whole
      // difference between "I came back online" and "I reloaded the tab".
      expect(onRetry).toHaveBeenCalledTimes(1);

      // And it stops asking once it has its answer.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      expect(onRetry).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('offers a reload, not a retry, when the server is answering', async () => {
    bridgeUp = true;
    await render(CHUNK_ERROR);
    // A URL whose module fetch failed is cached as failed for the life of the
    // document, so only a new document can load it — offering "Try again" here
    // would be offering a button that provably cannot work.
    expect(container.textContent).toContain('This page needs a reload');
    expect(container.textContent).toContain('Reload the page');
    expect(container.textContent).not.toContain('Try again');
  });

  it('never tells a freshly-offline user to reload', async () => {
    // The regression the probe exists for: the SSE keeps reporting `open` for
    // seconds after the network goes away, and a reload offered then costs the
    // user the tab and every page they had warmed. Only the server's own answer
    // decides this.
    await render(CHUNK_ERROR);
    expect(container.textContent).toContain('Not available offline');
    expect(container.textContent).not.toContain('Reload the page');
  });

  it('stops asking once the page it was watching for is gone', async () => {
    vi.useFakeTimers();
    try {
      await render(CHUNK_ERROR);
      const calls = vi.mocked(globalThis.fetch).mock.calls.length;
      act(() => root.render(<p>gone</p>));
      await vi.advanceTimersByTimeAsync(20_000);
      expect(vi.mocked(globalThis.fetch).mock.calls.length).toBe(calls);
    } finally {
      vi.useRealTimers();
    }
  });
});
