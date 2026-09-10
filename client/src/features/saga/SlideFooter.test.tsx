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
  visible: true,
  hasNotes: false,
  notesOpen: false,
  onToggleNotes: () => {},
  onShowShortcuts: () => {},
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

  it('is static in windowed mode — never overlaid, never idle', () => {
    // Acceptance 5: windowed, the footer is visible at all times. `visible` is
    // ignored outside fullscreen, so an idle timer that fired anyway cannot
    // hide it.
    render({ fullscreen: false, visible: false });
    expect(footer()?.className).not.toContain('saga-footer--overlay');
    expect(footer()?.className).not.toContain('saga-footer--idle');
  });

  it('overlays in fullscreen and hides itself when idle', () => {
    render({ fullscreen: true, visible: true });
    expect(footer()?.className).toContain('saga-footer--overlay');
    expect(footer()?.className).not.toContain('saga-footer--idle');

    render({ fullscreen: true, visible: false });
    expect(footer()?.className).toContain('saga-footer--idle');
  });

  it('leaves the slide’s own box untouched across both footer states', () => {
    // Acceptance 8, as far as jsdom can carry it: the footer is the only node
    // that changes, and in fullscreen it is never in the slide's flow. jsdom
    // reports every box as zero, so the *measured* proof is the live-verify
    // pass; what is pinned here is that no sibling markup changes at all.
    render({ fullscreen: true, visible: true });
    const shown = container.querySelector('.saga-footer__actions')?.outerHTML;
    render({ fullscreen: true, visible: false });
    expect(container.querySelector('.saga-footer__actions')?.outerHTML).toBe(shown);
  });

  it('offers no notes toggle when the slide has no note', () => {
    render({ hasNotes: false });
    expect(button('Show presenter notes')).toBeNull();
    render({ hasNotes: true });
    expect(button('Show presenter notes')).not.toBeNull();
  });

  it('disables prev on the first slide and next on the last', () => {
    render({ index: 0 });
    expect(button('Previous slide')?.disabled).toBe(true);
    expect(button('Next slide')?.disabled).toBe(false);

    render({ index: 3 });
    expect(button('Previous slide')?.disabled).toBe(false);
    expect(button('Next slide')?.disabled).toBe(true);
  });

  it('wires every control to its callback', () => {
    const onNext = vi.fn();
    const onPrevious = vi.fn();
    const onToggleFullscreen = vi.fn();
    const onToggleNotes = vi.fn();
    const onShowShortcuts = vi.fn();
    render({ onNext, onPrevious, onToggleFullscreen, onToggleNotes, onShowShortcuts, hasNotes: true });

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
