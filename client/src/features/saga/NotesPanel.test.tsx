// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NotesPanel } from './NotesPanel';
import type { PdfDeck } from './loadPdfSlides';
import type { SagaSlide } from './loadSource';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const DECK = { pageCount: 1 } as PdfDeck;

describe('NotesPanel (PLAN-28, PLAN-29)', () => {
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

  const render = (slide: SagaSlide | undefined) =>
    act(() => root.render(<NotesPanel slide={slide} />));

  it('shows the note a markdown slide carries, as typed', () => {
    render({ kind: 'markdown', body: '# One', notes: 'do *not* render this' });
    expect(container.querySelector('.saga-notes__body')?.textContent).toBe('do *not* render this');
    expect(container.querySelector('.saga-notes__body em')).toBeNull();
  });

  it('stays and says so on a markdown slide the author never annotated', () => {
    render({ kind: 'markdown', body: '# One', notes: null });
    expect(container.querySelector('.saga-notes')).not.toBeNull();
    expect(container.querySelector('.saga-notes__empty')?.textContent).toContain('Nothing written');
  });

  it('renders nothing at all on a PDF page', () => {
    // Not the empty state: that one tells the author how to add a note, which
    // on a rasterized page is an instruction with nowhere to be followed.
    render({ kind: 'pdf', page: 1, deck: DECK });
    expect(container.querySelector('.saga-notes')).toBeNull();
    expect(container.textContent).toBe('');
  });
});
