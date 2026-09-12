import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';

/**
 * The two-panel split behind Edda's editor/preview and Atlas's code/table
 * (PLAN-23): a draggable divider, a persisted ratio, and viewport breakpoints.
 *
 * Extracted from `EddaPage`'s inline implementation at its **second** consumer,
 * which is the point in this codebase's history where a shared piece moves into
 * `core/` rather than being copied — `JsonEditor` and `TreeView` both made the
 * same trip. The numbers below are Edda's own, unchanged: Atlas was asked for
 * "the same as the other editor", not for a new set.
 */

export type SplitLayout = 'split' | 'stacked' | 'single';

/** Either pane can shrink to 30% of the panes box; past that a pane is unusable. */
export const SPLIT_MIN_RATIO = 0.3;
export const SPLIT_MAX_RATIO = 0.7;

/** Viewport → layout: full split ≥1024, stacked ≥768, single toggle below. */
export function splitLayoutFor(width: number): SplitLayout {
  if (width >= 1024) return 'split';
  if (width >= 768) return 'stacked';
  return 'single';
}

export function clampSplitRatio(value: number): number {
  return Math.min(SPLIT_MAX_RATIO, Math.max(SPLIT_MIN_RATIO, value));
}

/**
 * A stored ratio is trusted only inside the clamp range: `sessionStorage` is
 * user-writable and `Number(null)` is 0, so anything outside falls back to an
 * even split rather than opening the page with one pane collapsed.
 */
export function readStoredRatio(raw: string | null): number {
  const stored = Number(raw);
  return stored >= SPLIT_MIN_RATIO && stored <= SPLIT_MAX_RATIO ? stored : 0.5;
}

export interface SplitPanel {
  layout: SplitLayout;
  /** Editor-side share of the panes box, 0.3–0.7. */
  ratio: number;
  /** Attach to the flex container holding both panes — the drag measures it. */
  panesRef: RefObject<HTMLDivElement | null>;
  /** Spread onto the divider element. */
  dividerProps: {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  };
}

/**
 * `storageKey` is the `sessionStorage` slot for the ratio — one per consumer,
 * so resizing Atlas never moves Edda's divider.
 */
export function useSplitPanel(storageKey: string): SplitPanel {
  const [layout, setLayout] = useState<SplitLayout>(() =>
    typeof window === 'undefined' ? 'split' : splitLayoutFor(window.innerWidth),
  );
  useEffect(() => {
    const onResize = () => setLayout(splitLayoutFor(window.innerWidth));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const [ratio, setRatio] = useState<number>(() =>
    readStoredRatio(sessionStorage.getItem(storageKey)),
  );
  useEffect(() => {
    sessionStorage.setItem(storageKey, String(ratio));
  }, [storageKey, ratio]);

  const panesRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);

  // Pointer-capture drag: without capture the 6px divider only sees pointermove
  // while the cursor is over it, so the drag "runs out" after a few pixels.
  // Capturing routes every move here until release, so the full range is usable.
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = true;
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const box = panesRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    setRatio(clampSplitRatio((event.clientX - box.left) / box.width));
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return {
    layout,
    ratio,
    panesRef,
    dividerProps: { onPointerDown, onPointerMove, onPointerUp },
  };
}
