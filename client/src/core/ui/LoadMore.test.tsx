// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LoadMore, countLabel } from './LoadMore';

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
  vi.unstubAllGlobals();
});

type Status = 'idle' | 'loading-more' | 'error-more';

function render(status: Status, onLoadMore: () => void, hasMore = true, loaded = 30) {
  act(() =>
    root.render(
      <LoadMore hasMore={hasMore} status={status} onLoadMore={onLoadMore} loaded={loaded} />,
    ),
  );
}

describe('LoadMore', () => {
  it('asks for the next batch when the sentinel nears the viewport', () => {
    let callback: IntersectionObserverCallback | undefined;
    let options: IntersectionObserverInit | undefined;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: IntersectionObserverCallback, init?: IntersectionObserverInit) {
          callback = cb;
          options = init;
        }
        observe() {}
        disconnect() {}
      },
    );
    const onLoadMore = vi.fn();
    render('idle', onLoadMore);
    expect(options?.rootMargin).toBe('600px');
    act(() =>
      callback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      ),
    );
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('works by button alone where IntersectionObserver is missing', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const onLoadMore = vi.fn();
    render('idle', onLoadMore);
    const button = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Load more',
    );
    act(() => button?.click());
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('shows Try again after a failed batch and does not observe, so nothing retries by itself', () => {
    const observe = vi.fn();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe = observe;
        disconnect() {}
      },
    );
    const onLoadMore = vi.fn();
    render('error-more', onLoadMore);
    expect(container.textContent).toContain('Couldn’t load more.');
    expect(observe).not.toHaveBeenCalled();
    const retry = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Try again',
    );
    act(() => retry?.click());
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('renders nothing once everything is loaded', () => {
    render('idle', vi.fn(), false);
    expect(container.innerHTML).toBe('');
  });

  it('labels the count', () => {
    expect(countLabel(90, 312, 'link')).toBe('Showing 90 of 312');
    expect(countLabel(312, 312, 'link')).toBe('All 312 shown');
    expect(countLabel(1, 1, 'link')).toBe('1 link');
  });
});
