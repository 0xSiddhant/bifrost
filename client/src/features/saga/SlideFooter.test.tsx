// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SlideFooter, type SlideFooterProps } from './SlideFooter';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const BASE: SlideFooterProps = {
  index: 1,
  count: 4,
  onPrevious: () => {},
  onNext: () => {},
  fullscreen: false,
  onToggleFullscreen: () => {},
  notesOpen: false,
  onToggleNotes: () => {},
  onShowShortcuts: () => {},
  scale: {
    value: 1,
    percent: 100,
    dec: () => {},
    inc: () => {},
    reset: () => {},
    atMin: false,
    atMax: false,
  },
};

describe('SlideFooter (PLAN-28)', () => {
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

  const render = (props: Partial<SlideFooterProps> = {}) =>
    act(() => root.render(<SlideFooter {...BASE} {...props} />));

  const footer = () => container.querySelector('.saga-footer');
  const button = (label: string) => container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);

  it('shows the position one-based', () => {
    render();
    expect(container.querySelector('.saga-footer__position')?.textContent).toBe('2 / 4');
  });

  it('carries a key legend, every entry of which is also a real control here', () => {
    render();
    const legend = [...container.querySelectorAll('.saga-legend')].map(
      (node) => node.textContent ?? '',
    );
    expect(legend.some((entry) => entry.includes('navigate'))).toBe(true);
    expect(legend.some((entry) => entry.includes('fullscreen'))).toBe(true);
    expect(legend.some((entry) => entry.includes('size'))).toBe(true);
    // Ranked, so CSS drops the least useful first rather than whichever is last.
    expect(
      [...container.querySelectorAll('.saga-legend')].map((n) => n.getAttribute('data-rank')),
    ).toEqual(['1', '2', '3', '4', '5']);
    // Decoration: each binding is a button in this same bar, and `?` reads out
    // the full list — so a screen reader must not hear the legend twice.
    expect(container.querySelector('.saga-footer__legend')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
  });

  it('is in the flow windowed, and overlaid while presenting', () => {
    render({ fullscreen: false });
    expect(footer()?.className).not.toContain('saga-footer--overlay');

    // Overlaid so the slide's own box does not move when it appears. Which
    // devices actually *see* it while presenting is a CSS decision (a keyboard
    // machine shows none), and that is a live-verify matter, not a jsdom one.
    render({ fullscreen: true });
    expect(footer()?.className).toContain('saga-footer--overlay');
  });

  it('keeps the notes toggle on every slide, note or no note', () => {
    // It is a mode, not a per-slide control: a toggle that came and went as you
    // moved through a deck read as the control breaking rather than the slide
    // changing, and made `N` look dead on any unannotated slide.
    render();
    expect(button('Show presenter notes')).not.toBeNull();
    render({ notesOpen: true });
    expect(button('Hide presenter notes')).not.toBeNull();
  });

  it('disables prev on the first slide and next on the last', () => {
    render({ index: 0 });
    expect(button('Previous slide')?.disabled).toBe(true);
    expect(button('Next slide')?.disabled).toBe(false);

    render({ index: 3 });
    expect(button('Previous slide')?.disabled).toBe(false);
    expect(button('Next slide')?.disabled).toBe(true);
  });

  it('offers the size controls in both modes — a deck is sized in fullscreen', () => {
    render({ fullscreen: false });
    expect(button('Larger slide text')).not.toBeNull();
    expect(button('Smaller slide text')).not.toBeNull();

    render({ fullscreen: true });
    expect(button('Larger slide text')).not.toBeNull();
    expect(button('Smaller slide text')).not.toBeNull();
  });

  it('shows the current size and offers a reset only away from 100%', () => {
    render();
    expect(container.querySelector('.saga-footer__scale')?.textContent).toContain('100%');
    expect(button('Slide text size 100%, reset to 100%')?.disabled).toBe(true);

    render({ scale: { ...BASE.scale, value: 1.4, percent: 140 } });
    expect(container.querySelector('.saga-footer__scale')?.textContent).toContain('140%');
    expect(button('Slide text size 140%, reset to 100%')?.disabled).toBe(false);
  });

  it('disables the end of the range it has reached', () => {
    render({ scale: { ...BASE.scale, atMin: true } });
    expect(button('Smaller slide text')?.disabled).toBe(true);
    expect(button('Larger slide text')?.disabled).toBe(false);

    render({ scale: { ...BASE.scale, atMax: true } });
    expect(button('Smaller slide text')?.disabled).toBe(false);
    expect(button('Larger slide text')?.disabled).toBe(true);
  });

  it('wires the size controls to their callbacks', () => {
    const inc = vi.fn();
    const dec = vi.fn();
    const reset = vi.fn();
    render({ scale: { ...BASE.scale, value: 1.2, percent: 120, inc, dec, reset } });

    act(() => button('Larger slide text')?.click());
    act(() => button('Smaller slide text')?.click());
    act(() => button('Slide text size 120%, reset to 100%')?.click());

    expect(inc).toHaveBeenCalledOnce();
    expect(dec).toHaveBeenCalledOnce();
    expect(reset).toHaveBeenCalledOnce();
  });

  it('wires every control to its callback', () => {
    const onNext = vi.fn();
    const onPrevious = vi.fn();
    const onToggleFullscreen = vi.fn();
    const onToggleNotes = vi.fn();
    const onShowShortcuts = vi.fn();
    render({ onNext, onPrevious, onToggleFullscreen, onToggleNotes, onShowShortcuts });

    act(() => button('Next slide')?.click());
    act(() => button('Previous slide')?.click());
    act(() => button('Enter fullscreen')?.click());
    act(() => button('Show presenter notes')?.click());
    act(() => button('Keyboard shortcuts')?.click());

    expect(onNext).toHaveBeenCalledOnce();
    expect(onPrevious).toHaveBeenCalledOnce();
    expect(onToggleFullscreen).toHaveBeenCalledOnce();
    expect(onToggleNotes).toHaveBeenCalledOnce();
    expect(onShowShortcuts).toHaveBeenCalledOnce();
  });
});
