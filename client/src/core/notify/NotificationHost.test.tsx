// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NotificationHost } from './NotificationHost';
import { notifications, notify } from './notify';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

/** The stack portals to <body>, so queries run against the document. */
const cards = () => [...document.querySelectorAll('.notify')];
const cardWith = (text: string) =>
  cards().find((card) => card.textContent?.includes(text)) as HTMLElement | undefined;

describe('NotificationHost', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<NotificationHost />));
  });

  afterEach(() => {
    act(() => notifications.clear());
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('renders nothing until something is notified', () => {
    expect(document.querySelector('.notify-host')).toBeNull();

    act(() => {
      notify.ok('file published');
    });
    expect(cards()).toHaveLength(1);
  });

  it('marks errors assertive and everything else polite', () => {
    act(() => {
      notify.ok('published');
      notify.error('upload failed');
    });

    expect(cardWith('published')?.getAttribute('role')).toBe('status');
    expect(cardWith('published')?.getAttribute('aria-live')).toBe('polite');
    expect(cardWith('upload failed')?.getAttribute('role')).toBe('alert');
    expect(cardWith('upload failed')?.getAttribute('aria-live')).toBe('assertive');
  });

  it('dismisses early from the cross, which is a labelled button', () => {
    act(() => {
      notify.error('upload failed');
    });
    const close = cardWith('upload failed')?.querySelector('.notify__close');

    expect(close?.tagName).toBe('BUTTON');
    expect(close?.getAttribute('aria-label')).toContain('upload failed');

    act(() => (close as HTMLButtonElement).click());
    expect(cards()).toHaveLength(0);
  });

  it('pauses the countdown while the pointer is over the card', () => {
    act(() => {
      notify.info('copied', { timeout: 1000 });
    });
    const card = cardWith('copied');

    act(() => vi.advanceTimersByTime(500));
    act(() => card?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    expect(card?.querySelector<HTMLElement>('.notify__progress span')?.style.animationPlayState).toBe(
      'paused',
    );

    act(() => vi.advanceTimersByTime(10_000));
    expect(cards()).toHaveLength(1);

    act(() => card?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })));
    act(() => vi.advanceTimersByTime(500));
    expect(cards()).toHaveLength(0);
  });

  it('shows no progress bar on an error, because it never runs out', () => {
    act(() => {
      notify.error('upload failed');
    });
    expect(cardWith('upload failed')?.querySelector('.notify__progress')).toBeNull();
  });

  it('offers "dismiss all" only once more than one error is stacked', () => {
    act(() => {
      notify.error('first');
    });
    expect(document.querySelector('.notify-host__bulk')).toBeNull();

    act(() => {
      notify.error('second');
    });
    const bulk = document.querySelector<HTMLButtonElement>('.notify-host__bulk button');
    expect(bulk?.textContent).toContain('Dismiss all errors (2)');

    act(() => bulk?.click());
    expect(cards()).toHaveLength(0);
  });

  it('shows the repeat counter and the overflow count', () => {
    act(() => {
      for (let index = 0; index < 6; index += 1) notify.info(`note ${index}`);
      notify.ok('twice', { dedupeKey: 'k' });
      notify.ok('twice', { dedupeKey: 'k' });
    });

    expect(cards()).toHaveLength(4);
    expect(cardWith('twice')?.querySelector('.notify__count')?.textContent).toBe('×2');
    expect(document.querySelector('.notify-host__overflow')?.textContent).toBe('+3 more');
  });
});
