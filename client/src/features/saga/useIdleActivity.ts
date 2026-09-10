import { useEffect, useRef, useState } from 'react';

/**
 * Active-or-idle chrome, on a timeout that real interaction resets (PLAN-28).
 *
 * Genuinely new interaction logic: nothing else in this codebase auto-hides its
 * own chrome. The screensaver's `useIdle` is the nearest thing and is not
 * reusable here — it fires a one-shot `onIdle` callback on a minutes-long timer
 * to raise an overlay, where the footer needs a *continuous* boolean that flips
 * back the instant a mouse moves, several times a minute.
 *
 * What is proven is the shape rather than the code: a native `<video controls>`
 * element already hides and shows its own controls on exactly this rule, so
 * nobody watching a presentation has to learn a new convention.
 *
 * **Touch toggles rather than wakes.** A phone has no hover or mouse-move
 * signal at all, so a tap is the only gesture available and has to do both
 * jobs: it reveals hidden chrome, and it dismisses visible chrome. Handling it
 * here rather than as a second tap handler on the page is what makes that
 * possible — an element-level toggle would be overruled a moment later by this
 * hook's own window listener, since the event bubbles on to `window` after
 * React's root container has already run the element's handler.
 */
export interface IdleActivity {
  /** True while within the timeout of the last interaction. */
  active: boolean;
}

export function useIdleActivity(enabled: boolean, timeoutMs = 3000): IdleActivity {
  // Starts active: entering fullscreen is itself an interaction, and a footer
  // that was never shown cannot teach anyone that it exists.
  const [active, setActive] = useState(true);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const clear = () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
    };

    if (!enabled) {
      // Windowed mode: the footer is static, so nothing may ever mark it idle.
      clear();
      setActive(true);
      return clear;
    }

    const arm = () => {
      clear();
      timer.current = window.setTimeout(() => setActive(false), timeoutMs);
    };
    const wake = () => {
      // Identical state is a React bail-out, so a mouse moving across the slide
      // re-arms the timer without re-rendering anything.
      setActive(true);
      arm();
    };
    const toggle = () => {
      setActive((current) => !current);
      arm();
    };

    window.addEventListener('mousemove', wake);
    window.addEventListener('keydown', wake);
    window.addEventListener('touchstart', toggle);
    setActive(true);
    arm();

    return () => {
      window.removeEventListener('mousemove', wake);
      window.removeEventListener('keydown', wake);
      window.removeEventListener('touchstart', toggle);
      clear();
    };
  }, [enabled, timeoutMs]);

  return { active };
}
