// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ErrorBoundary } from './ErrorBoundary';
import { log } from '../log';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

function Boom({ explode }: { explode: boolean }): React.ReactElement {
  if (explode) throw new Error('component exploded');
  return <p>all good</p>;
}

describe('ErrorBoundary', () => {
  let container: HTMLDivElement;
  let root: Root;
  let reported: ReturnType<typeof vi.spyOn>;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    reported = vi.spyOn(log, 'error').mockImplementation(() => {});
    // React logs caught render errors itself; keep the test output readable.
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    reported.mockRestore();
    consoleError.mockRestore();
  });

  it('renders its children when nothing throws', () => {
    act(() => root.render(<ErrorBoundary><Boom explode={false} /></ErrorBoundary>));
    expect(container.textContent).toContain('all good');
    expect(reported).not.toHaveBeenCalled();
  });

  it('shows the fallback instead of a white screen, and reports once', () => {
    act(() => root.render(<ErrorBoundary><Boom explode /></ErrorBoundary>));

    expect(container.querySelector('.crash')).not.toBeNull();
    expect(container.textContent).toContain('The bridge wavered');
    expect(container.textContent).toContain('component exploded');

    // Once per caught error — not once per re-render, or a broken page would
    // flood the endpoint it is trying to report through.
    expect(reported).toHaveBeenCalledTimes(1);
    const [msg, fields] = reported.mock.calls[0] as [string, { stack?: string }];
    expect(msg).toContain('component exploded');
    expect(fields.stack).toBeTruthy();
  });

  it('does not re-report when the parent re-renders the failed tree', () => {
    act(() => root.render(<ErrorBoundary><Boom explode /></ErrorBoundary>));
    act(() => root.render(<ErrorBoundary><Boom explode /></ErrorBoundary>));
    expect(reported).toHaveBeenCalledTimes(1);
  });
});
