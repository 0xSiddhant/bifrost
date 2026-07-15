import { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { bifrostEvents } from '../../core/sse';
import { matchesShortcut } from '../../core/shortcut';
import { heimdallGate } from '../../core/heimdallGate';
import { fetchAccess, type AccessConfig } from './api';

const DEFAULT: AccessConfig = { shortcut: 'shift+meta+comma', tapCount: 7 };
const TAP_WINDOW_MS = 3000;

/**
 * Wires the two entry gestures. The keyboard listener is global; `registerTap`
 * is attached to the server-identity marks — the footer `bifrost.local` on
 * desktop and the header wordmark on mobile (where the footer is hidden and
 * there's no keyboard). Both open Heimdall by revealing the gate and navigating
 * there. The current shortcut/tap-count come from /api/heimdall/access and
 * re-sync live on `settings.updated`.
 */
export function useHeimdallGesture(): {
  registerTap: (event?: { preventDefault: () => void }) => void;
} {
  const navigate = useNavigate();
  const configRef = useRef<AccessConfig>(DEFAULT);
  const tapRef = useRef<{ count: number; timer: number | null }>({ count: 0, timer: null });

  const open = useCallback(() => {
    heimdallGate.reveal();
    navigate('/heimdall');
  }, [navigate]);

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
      if (
        payload &&
        typeof payload === 'object' &&
        'shortcut' in payload &&
        'tapCount' in payload
      ) {
        const next = payload as AccessConfig;
        configRef.current = { shortcut: next.shortcut, tapCount: next.tapCount };
      }
    });

    const onKey = (event: KeyboardEvent) => {
      if (matchesShortcut(event, configRef.current.shortcut)) {
        event.preventDefault();
        open();
      }
    };
    window.addEventListener('keydown', onKey);

    return () => {
      cancelled = true;
      offSettings();
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const registerTap = useCallback(
    (event?: { preventDefault: () => void }) => {
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
        // When the target is the wordmark link, stop its home navigation on the
        // tap that actually opens Heimdall (react-router Link honors this).
        event?.preventDefault();
        open();
      }
    },
    [open],
  );

  return { registerTap };
}
