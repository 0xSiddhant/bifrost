import { useCallback, useEffect, useRef } from 'react';
import { bifrostEvents } from '../../core/sse';
import { matchesShortcut } from '../../core/shortcut';
import { fetchAccess, type AccessConfig } from './api';

const DEFAULT: AccessConfig = { shortcut: 'shift+meta+comma', tapCount: 7 };
const TAP_WINDOW_MS = 3000;

/** Entry is tablet/desktop only — gated on viewport width, not UA sniffing. */
export const HEIMDALL_MIN_WIDTH = 768;
const isWideViewport = (): boolean =>
  typeof window !== 'undefined' && window.innerWidth >= HEIMDALL_MIN_WIDTH;

/**
 * Wires the two entry gestures — header-wordmark taps and the configurable
 * keyboard shortcut — both of which open the Heimdall modal via `onOpen`.
 *
 * Both are gated on a ≥768px viewport (PLAN-10): below the threshold the
 * keyboard listener is never attached and `registerTap` is a no-op, so a phone
 * has no entry at all (the wordmark just navigates home). Listeners tear down
 * and re-attach when the viewport crosses the threshold on resize. The current
 * shortcut/tap-count come from /api/heimdall/access and re-sync on
 * `settings.updated`.
 */
export function useHeimdallGesture(onOpen: () => void): {
  registerTap: (event?: { preventDefault: () => void }) => void;
} {
  const openRef = useRef(onOpen);
  openRef.current = onOpen;
  const configRef = useRef<AccessConfig>(DEFAULT);
  const wideRef = useRef<boolean>(isWideViewport());
  const tapRef = useRef<{ count: number; timer: number | null }>({ count: 0, timer: null });

  useEffect(() => {
    let cancelled = false;
    fetchAccess()
      .then((config) => {
        if (!cancelled) configRef.current = config;
      })
      .catch(() => {
        // Keep the built-in defaults; the gesture still works.
      });

    const offSettings = bifrostEvents.on('settings.updated', (payload) => {
      if (payload && typeof payload === 'object' && 'shortcut' in payload && 'tapCount' in payload) {
        const next = payload as AccessConfig;
        configRef.current = { shortcut: next.shortcut, tapCount: next.tapCount };
      }
    });

    const onKey = (event: KeyboardEvent) => {
      if (matchesShortcut(event, configRef.current.shortcut)) {
        event.preventDefault();
        openRef.current();
      }
    };

    // Attach the keyboard listener only above the threshold; re-evaluate on
    // resize so crossing the line attaches/detaches it live.
    const syncKeyListener = () => {
      const wide = isWideViewport();
      wideRef.current = wide;
      window.removeEventListener('keydown', onKey);
      if (wide) window.addEventListener('keydown', onKey);
    };
    syncKeyListener();
    window.addEventListener('resize', syncKeyListener);

    return () => {
      cancelled = true;
      offSettings();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', syncKeyListener);
    };
  }, []);

  const registerTap = useCallback((event?: { preventDefault: () => void }) => {
    // Below the threshold the wordmark is just a home link — no entry exists.
    if (!wideRef.current) return;
    const tap = tapRef.current;
    tap.count += 1;
    if (tap.timer !== null) window.clearTimeout(tap.timer);
    tap.timer = window.setTimeout(() => {
      tap.count = 0;
      tap.timer = null;
    }, TAP_WINDOW_MS);
    if (tap.count >= configRef.current.tapCount) {
      tap.count = 0;
      window.clearTimeout(tap.timer);
      tap.timer = null;
      // On the trigger tap, stop the wordmark's home navigation (Link honors it).
      event?.preventDefault();
      openRef.current();
    }
  }, []);

  return { registerTap };
}
