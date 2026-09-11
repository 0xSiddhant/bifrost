// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SlideView } from './SlideView';
import type { PdfDeck } from './loadPdfSlides';
import type { SagaSlide } from './loadSource';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

/**
 * jsdom has no `ResizeObserver` and no canvas 2d context, so the PDF branch is
 * driven against a hand-made `PdfDeck` — the same public interface
 * `loadPdfSlides` returns. What is under test here is the branch and what it
 * asks for, not pdf.js: that a real PDF rasterizes is `loadPdfSlides.test.ts`
 * and, in a real browser, live-verify.
 */
/** Callbacks of the live observers, so a test can fire one a second time. */
const observers: (() => void)[] = [];

class FakeResizeObserver {
  constructor(private readonly callback: () => void) {}
  observe() {
    observers.push(this.callback);
    this.callback();
  }
  disconnect() {
    const at = observers.indexOf(this.callback);
    if (at !== -1) observers.splice(at, 1);
  }
}

interface RenderCall {
  page: number;
  box: { width: number; height: number };
}

function fakeDeck(calls: RenderCall[], pageCount = 3): PdfDeck {
  return {
    pageCount,
    renderPage: (page, _canvas, box) => {
      calls.push({ page, box });
      return Promise.resolve({ width: 400, height: 518 });
    },
    destroy: () => Promise.resolve(),
  };
}

describe('SlideView (PLAN-29)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    // jsdom never lays anything out, so a frame measures zero and the render
    // would be skipped as "not sized yet". These give it a size to fit into.
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
      fn(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    observers.length = 0;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const render = (slide: SagaSlide | undefined, scale = 1) =>
    act(() => root.render(<SlideView slide={slide} scale={scale} />));

  it('renders a markdown slide through the shared pipeline', () => {
    render({ kind: 'markdown', body: '# Heading\n\nWords.', notes: null });
    expect(container.querySelector('.md-preview h1')?.textContent).toBe('Heading');
    expect(container.querySelector('canvas')).toBeNull();
  });

  it('renders a PDF page onto a canvas instead, labelled for a screen reader', async () => {
    const calls: RenderCall[] = [];
    await act(async () => {
      root.render(<SlideView slide={{ kind: 'pdf', page: 2, deck: fakeDeck(calls) }} scale={1} />);
    });

    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas?.getAttribute('aria-label')).toBe('Page 2');
    expect(container.querySelector('.md-preview')).toBeNull();
    expect(calls).toEqual([{ page: 2, box: { width: 800, height: 600 } }]);
  });

  it('rasterizes a page once on mount, not once per size report', async () => {
    // `observe()` reports the element's current size as well as later changes,
    // so the explicit first call and the observer's own both reach `draw` with
    // an identical box. Without the guard that is two rasterizations of the
    // same pixels on every slide.
    const calls: RenderCall[] = [];
    const deck = fakeDeck(calls);
    await act(async () => {
      root.render(<SlideView slide={{ kind: 'pdf', page: 1, deck }} scale={1} />);
    });
    // Drive the observer again with the frame unchanged, as a resize storm does.
    observers.forEach((fire) => fire());
    await act(async () => {
      await Promise.resolve();
    });
    expect(calls).toHaveLength(1);
  });

  it('re-rasterizes when the box actually changes', async () => {
    const calls: RenderCall[] = [];
    const deck = fakeDeck(calls);
    await act(async () => {
      root.render(<SlideView slide={{ kind: 'pdf', page: 1, deck }} scale={1} />);
    });
    await act(async () => {
      root.render(<SlideView slide={{ kind: 'pdf', page: 1, deck }} scale={1.5} />);
    });
    expect(calls.map((call) => call.box.width)).toEqual([800, 1200]);
  });

  it('scales the box it fits the page into, so + and - mean the same thing here', async () => {
    const calls: RenderCall[] = [];
    await act(async () => {
      root.render(<SlideView slide={{ kind: 'pdf', page: 1, deck: fakeDeck(calls) }} scale={1.5} />);
    });
    expect(calls).toEqual([{ page: 1, box: { width: 1200, height: 900 } }]);
  });

  it('renders an empty markdown slide rather than throwing on no slide at all', () => {
    render(undefined);
    expect(container.querySelector('.saga-slide__body')).not.toBeNull();
  });
});
