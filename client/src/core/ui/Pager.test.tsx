// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { FLOATING_PAGER_QUERY, Pager, usePagerFloats } from './Pager';

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

function render(page: number, pageCount: number, floating = false) {
  act(() =>
    root.render(
      <MemoryRouter>
        <Pager
          page={page}
          pageCount={pageCount}
          hrefFor={(p) => `/list?page=${p}`}
          floating={floating}
        />
      </MemoryRouter>,
    ),
  );
}

const controls = () => container.querySelectorAll('.pager > *').length;

describe('Pager', () => {
  it('renders nothing for a single page', () => {
    render(1, 1);
    expect(container.querySelector('.pager')).toBeNull();
  });

  it('marks the current page and links every number to its ?page=', () => {
    render(4, 40);
    const current = container.querySelector('[aria-current="page"]');
    expect(current?.textContent).toBe('4');
    expect(container.querySelector('a[aria-label="Page 40"]')?.getAttribute('href')).toBe(
      '/list?page=40',
    );
    expect(container.querySelector('a[aria-label="Next page"]')?.getAttribute('href')).toBe(
      '/list?page=5',
    );
    expect(container.querySelector('nav')?.getAttribute('aria-label')).toBe('Pages');
  });

  it('never shows more than nine controls', () => {
    for (const page of [1, 2, 3, 17, 38, 39, 40]) {
      render(page, 40);
      expect(controls()).toBeLessThanOrEqual(9);
    }
  });

  it('disables the arrow that leads nowhere', () => {
    render(1, 3);
    expect(container.querySelector('a[aria-label="Previous page"]')).toBeNull();
    expect(container.querySelector('a[aria-label="Next page"]')).not.toBeNull();
  });

  it('floats as a column or sits inline, as told', () => {
    render(2, 3, true);
    expect(container.querySelector('.pager--floating')).not.toBeNull();
    render(2, 3, false);
    expect(container.querySelector('.pager--inline')).not.toBeNull();
  });
});

describe('usePagerFloats', () => {
  function Probe() {
    return <span>{usePagerFloats() ? 'floating' : 'inline'}</span>;
  }

  it.each([
    [true, 'floating'],
    [false, 'inline'],
  ])('follows the iPad-and-tall media query (matches=%s)', (matches, expected) => {
    const matchMedia = vi.fn((query: string) => ({
      matches: query === FLOATING_PAGER_QUERY && matches,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    vi.stubGlobal('matchMedia', matchMedia);
    act(() => root.render(<Probe />));
    expect(container.textContent).toBe(expected);
    expect(matchMedia).toHaveBeenCalledWith('(min-width: 768px) and (min-height: 600px)');
  });
});
