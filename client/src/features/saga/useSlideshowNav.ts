import { useCallback, useEffect, useState } from 'react';

/**
 * Slide position, and every way of changing it (PLAN-28).
 *
 * Uses the same shape `features/previews/PreviewModal` already does — one
 * `window` listener registered in a `useEffect` and removed on cleanup — rather
 * than a second convention for the same job.
 *
 * **There is deliberately no swipe.** It was here, with deckrun's own 50px
 * threshold, and it measured horizontal distance without ever checking the
 * gesture was horizontal — so scrolling a long slide on a phone changed the
 * slide whenever a finger drifted. On a surface whose whole job is to scroll,
 * a drag belongs to the content; the footer's prev/next buttons are the touch
 * affordance, and they are always there.
 */

export interface SlideshowNav {
  index: number;
  next: () => void;
  previous: () => void;
  goTo: (index: number) => void;
}

export interface SlideshowNavOptions {
  /**
   * Suspend the key bindings — the shortcuts overlay is open, or a text input
   * has focus. Arrow keys inside a field must move the caret, not the deck.
   */
  disabled?: boolean;
}

export function useSlideshowNav(count: number, options: SlideshowNavOptions = {}): SlideshowNav {
  const { disabled = false } = options;
  const [index, setIndex] = useState(0);

  const goTo = useCallback(
    (target: number) => {
      // Clamped rather than wrapped: running off the end of a deck mid-sentence
      // and landing back on the title slide is startling in front of a room.
      setIndex(() => Math.max(0, Math.min(target, Math.max(0, count - 1))));
    },
    [count],
  );

  const next = useCallback(() => setIndex((i) => Math.min(i + 1, Math.max(0, count - 1))), [count]);
  const previous = useCallback(() => setIndex((i) => Math.max(i - 1, 0)), []);

  // A shorter deck must not leave the position past its last slide.
  useEffect(() => {
    setIndex((i) => Math.max(0, Math.min(i, Math.max(0, count - 1))));
  }, [count]);

  useEffect(() => {
    if (disabled) return;
    const onKey = (event: KeyboardEvent) => {
      // A modifier means the keypress belongs to the browser (⌘→ is Forward),
      // never to the deck.
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown':
        case 'PageDown':
        case ' ':
        case 'd':
        case 'D':
        case 's':
        case 'S':
          event.preventDefault();
          next();
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'PageUp':
        case 'Backspace':
        case 'a':
        case 'A':
        case 'w':
        case 'W':
          event.preventDefault();
          previous();
          break;
        case 'Home':
          event.preventDefault();
          goTo(0);
          break;
        case 'End':
          event.preventDefault();
          goTo(count - 1);
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [disabled, next, previous, goTo, count]);

  return { index, next, previous, goTo };
}
