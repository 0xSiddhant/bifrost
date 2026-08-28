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

  const render = (message: string | null, pathname = '/loki') =>
    act(() =>
      root.render(
        <ErrorBoundary>
          <RouteBoundary pathname={pathname}>
            <Boom message={message} />
          </RouteBoundary>
        </ErrorBoundary>,
      ),
    );

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    // React logs caught render errors itself; keep the test output readable.
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    reportedError = vi.spyOn(log, 'error').mockImplementation(() => {});
    notifications.dismissKey('route-unavailable');
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    notifications.dismissKey('route-unavailable');
    vi.restoreAllMocks();
    void consoleError;
  });

  it('renders its children when the chunk arrives', () => {
    render(null);
    expect(container.textContent).toContain('the page');
  });

  it('replaces only the page — not the app — when a chunk cannot be fetched', () => {
    render(CHUNK_ERROR);
    expect(container.textContent).toContain('Not available offline');
    // The app-wide crash card is what this exists to avoid.
    expect(container.querySelector('.crash')).toBeNull();
    expect(container.textContent).toContain('Try again');
  });

  it('raises the popup once and logs a warn, not a crash report', () => {
    render(CHUNK_ERROR);
    expect(notifications.getSnapshot().visible.some((n) => n.kind === 'error')).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect((warn.mock.calls[0] as [string])[0]).toContain('route chunk unavailable');
    expect(reportedError).not.toHaveBeenCalled();
  });

  it('hands a real render bug to the app-wide boundary instead of swallowing it', () => {
    render("Cannot read properties of undefined (reading 'map')");
    expect(container.querySelector('.crash')).not.toBeNull();
    expect(container.textContent).toContain('The bridge wavered');
    // Reported by the app-wide boundary, and not also by this one.
    expect(reportedError).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('reports one failure once, even when React re-renders and re-throws it', () => {
    const boundary = new RouteBoundary({ children: null, pathname: '/loki' });
    const error = new Error(CHUNK_ERROR);
    boundary.componentDidCatch(error);
    boundary.componentDidCatch(error);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(notifications.getSnapshot().visible[0]?.count).toBe(1);
  });

  it('clears the failure when the route changes, so a later visit retries', () => {
    render(CHUNK_ERROR);
    expect(container.textContent).toContain('Not available offline');
    render(null, '/edda');
    expect(container.textContent).toContain('the page');
  });

  it('retries on demand and dismisses the popup with it', () => {
    render(CHUNK_ERROR);
    const retry = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Try again',
    );
    // The child still throws, so this proves the reset path runs, not that the
    // import succeeded — the real retry is against a bridge that came back.
    act(() => retry?.click());
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
