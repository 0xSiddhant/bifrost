import { useCallback, useState } from 'react';

/**
 * Per-device editor text size (Loki/Runestone/Variant panels, PLAN-12). A
 * shared comfort setting: pick it once and every editor honours it. Persisted
 * in localStorage (the allowed non-critical class — same as the theme choice
 * and draft buffers), applied as the `--panel-font` custom property scoped to
 * `.panel-scope` (see ui.css). On mobile a 16px floor still wins (iOS zooms
 * smaller inputs on focus).
 */
export const PANEL_FONT_MIN = 11;
export const PANEL_FONT_MAX = 22;
export const PANEL_FONT_DEFAULT = 14;
const KEY = 'bifrost.editorFontPx';

function load(): number {
  const n = Number(localStorage.getItem(KEY));
  return Number.isFinite(n) && n >= PANEL_FONT_MIN && n <= PANEL_FONT_MAX ? n : PANEL_FONT_DEFAULT;
}

export interface PanelFont {
  px: number;
  dec: () => void;
  inc: () => void;
  reset: () => void;
}

export function usePanelFont(): PanelFont {
  const [px, setPx] = useState<number>(load);
  const apply = useCallback((value: number) => {
    const clamped = Math.min(PANEL_FONT_MAX, Math.max(PANEL_FONT_MIN, value));
    setPx(clamped);
    localStorage.setItem(KEY, String(clamped));
  }, []);
  return {
    px,
    dec: () => apply(px - 1),
    inc: () => apply(px + 1),
    reset: () => apply(PANEL_FONT_DEFAULT),
  };
}
