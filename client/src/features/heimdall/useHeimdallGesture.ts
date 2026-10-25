import { useCallback, useEffect, useRef } from 'react';
import { accessSettings, type AccessConfig } from '../../core/settings';
import { matchesShortcut } from '../../core/shortcut';

/** The build's `.env` defaults (PLAN-35), until the real values load. */
const DEFAULT: AccessConfig = { ...__BIFROST_DEFAULTS__.heimdall };
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
 * shortcut/tap-count come from the access settings (the hub's, or this
 * browser's own on the standalone site) and re-sync live when they change.
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
    accessSettings
      .load()
      .then((config) => {
        if (!cancelled) configRef.current = config;
      })
      .catch(() => {
        // Keep the built-in defaults; the gesture still works.
      });

    const offSettings = accessSettings.subscribe((next) => {
      configRef.current = next;
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
