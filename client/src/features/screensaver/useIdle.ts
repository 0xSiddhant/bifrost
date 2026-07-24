import { useEffect, useRef } from 'react';

/** Activity that resets the idle countdown. mousemove is included: moving the
 *  mouse means the user is present, so the saver only appears after true stillness. */
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'wheel', 'scroll', 'touchstart'] as const;

export interface UseIdleOptions {
  /** When false, no listeners/timers are attached at all. */
  enabled: boolean;
  /** Inactivity before `onIdle` fires, in milliseconds. */
  idleMs: number;
  onIdle: () => void;
}

/**
 * Fire `onIdle` after `idleMs` of no user activity. Fully inert when
 * `enabled` is false (the caller passes the desktop gate + master switch), so
 * on a phone/tablet nothing is ever wired up. `onIdle` is read through a ref so
 * changing the callback doesn't re-attach the listeners.
 */
export function useIdle({ enabled, idleMs, onIdle }: UseIdleOptions): void {
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => onIdleRef.current(), idleMs);
    };
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, reset, { passive: true });
    }
    reset();
    return () => {
      clearTimeout(timer);
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, reset);
    };
  }, [enabled, idleMs]);
}
