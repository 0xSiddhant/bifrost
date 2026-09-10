import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Slide position, and every way of changing it (PLAN-28).
 *
 * The keyboard half uses the same shape `features/previews/PreviewModal` already
 * does — one `window` listener registered in a `useEffect` and removed on
 * cleanup — rather than a second convention for the same job.
 */

/** Deckrun's own swipe threshold. Below it, a tap is a tap, not a drag. */
const SWIPE_PX = 50;

export interface SlideshowNav {
  index: number;
  next: () => void;
  previous: () => void;
  goTo: (index: number) => void;
  /** Spread onto the slide surface to arm swipe navigation. */
  touchHandlers: {
    onTouchStart: (event: React.TouchEvent) => void;
    onTouchEnd: (event: React.TouchEvent) => void;
  };
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

  const startX = useRef<number | null>(null);

  const onTouchStart = useCallback((event: React.TouchEvent) => {
    startX.current = event.touches[0]?.clientX ?? null;
  }, []);

  const onTouchEnd = useCallback(
    (event: React.TouchEvent) => {
      const from = startX.current;
      startX.current = null;
      if (from === null) return;
      const to = event.changedTouches[0]?.clientX;
      if (to === undefined) return;
      const delta = to - from;
      if (Math.abs(delta) < SWIPE_PX) return;
      // Swiping left drags the deck forward, matching every paged surface a
      // phone already has.
      if (delta < 0) next();
      else previous();
    },
    [next, previous],
  );

  return { index, next, previous, goTo, touchHandlers: { onTouchStart, onTouchEnd } };
}
