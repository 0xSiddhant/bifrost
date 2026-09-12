import { useCallback, useState } from 'react';
import { log } from '../../core/log';

/**
 * Slide text size, as a multiplier on whichever base the current mode uses.
 *
 * Deliberately **not** `core/panelFont.ts`, though it mirrors that hook's shape
 * on purpose. Two reasons, both about the thing being sized rather than the
 * mechanism:
 *
 * - `--panel-font` is an absolute **px** value bounded to 11–22, which is the
 *   right range for an editor panel and far too small for a room. Saga's
 *   fullscreen base is `clamp(--text-lg, 2.2vw, 2rem)` — it scales with the
 *   projector — so a multiplier is what preserves that, where a fixed px would
 *   throw the viewport-relative sizing away.
 * - Sharing one value would mean sizing a deck for the back of a room silently
 *   resized Runestone's JSON on the same device.
 *
 * Persisted per device in localStorage, on the same reasoning `panelFont`
 * already logs for itself: a text-size preference is the allowed non-critical
 * class, beside the theme choice and draft buffers. Nothing about a *deck* is
 * stored — PLAN-28's "no browser storage" rule is about the dropped file, and
 * that still holds.
 */
export const SLIDE_SCALE_MIN = 0.6;
export const SLIDE_SCALE_MAX = 2.4;
export const SLIDE_SCALE_DEFAULT = 1;
export const SLIDE_SCALE_STEP = 0.1;

const KEY = 'bifrost.sagaSlideScale';

/** Two decimals: 0.1 steps otherwise drift into 1.2000000000000002. */
const round = (value: number): number => Math.round(value * 100) / 100;

const clamp = (value: number): number =>
  round(Math.min(SLIDE_SCALE_MAX, Math.max(SLIDE_SCALE_MIN, value)));

function load(): number {
  try {
    const stored = Number(localStorage.getItem(KEY));
    return Number.isFinite(stored) && stored > 0 ? clamp(stored) : SLIDE_SCALE_DEFAULT;
  } catch {
    // Private mode, or storage disabled entirely. The default size is a
    // perfectly good presentation; silence is correct because there is nothing
    // for anyone to act on — same posture as `core/theme`'s cached tokens.
    return SLIDE_SCALE_DEFAULT;
  }
}

export interface SlideScale {
  /** The multiplier itself, for the `--saga-scale` custom property. */
  value: number;
  /** For the footer's readout: 1.2 → "120%". */
  percent: number;
  dec: () => void;
  inc: () => void;
  reset: () => void;
  atMin: boolean;
  atMax: boolean;
}

export function useSlideScale(): SlideScale {
  const [value, setValue] = useState<number>(load);

  const apply = useCallback((next: number) => {
    const clamped = clamp(next);
    setValue(clamped);
    try {
      localStorage.setItem(KEY, String(clamped));
    } catch (error) {
      // Not silent: the size still changed on screen, so the only symptom of a
      // failed write is it quietly not being there next time.
      log.warn(`saga: could not remember the slide size: ${(error as Error).message}`, {
        module: 'saga',
      });
    }
  }, []);

  return {
    value,
    percent: Math.round(value * 100),
    dec: () => apply(value - SLIDE_SCALE_STEP),
    inc: () => apply(value + SLIDE_SCALE_STEP),
    reset: () => apply(SLIDE_SCALE_DEFAULT),
    atMin: value <= SLIDE_SCALE_MIN,
    atMax: value >= SLIDE_SCALE_MAX,
  };
}
