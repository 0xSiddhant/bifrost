/**
 * The maths behind ExpandingGrid (PLAN-18), kept pure and away from the DOM so
 * the row placement and the scroll decision can be unit-tested at every column
 * count instead of being eyeballed in a browser at one width.
 */

/** Breathing room left above/below a panel we scroll into view, on top of the
 *  sticky header and mobile bottom-nav insets. Flush against the header reads
 *  as clipped. */
export const SCROLL_GAP = 12;

/**
 * Count the live columns from a computed `grid-template-columns`.
 *
 * Browsers return the *used* track list ("246px 246px 246px"), which is the
 * only honest source for an `auto-fit` grid — the authored value is a repeat()
 * expression that says nothing about how many tracks it resolved to. Line names
 * are stripped because `[full-start] 246px` is one track, not two, and anything
 * unparseable (`none`, empty, a jsdom stub) falls back to a single column, which
 * degrades to "panel directly under the card" rather than to a crash.
 */
export function columnCount(gridTemplateColumns: string | null | undefined): number {
  const value = (gridTemplateColumns ?? '').trim();
  if (!value || value === 'none') return 1;
  const tracks = value
    .replace(/\[[^\]]*\]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return tracks.length || 1;
}

/**
 * Where the panel goes in the card array so it lands at the end of the open
 * card's row: the next row boundary, clamped to the end of the list (an open
 * card in a short final row puts the panel last, not past the end).
 */
export function panelInsertIndex(openIndex: number, cols: number, total: number): number {
  if (openIndex < 0) return total;
  const columns = Math.max(1, Math.trunc(cols));
  return Math.min(Math.ceil((openIndex + 1) / columns) * columns, total);
}

export interface ScrollPlanInput {
  /** Source card's top edge, in document coordinates. */
  cardTop: number;
  /** Panel's top edge, in document coordinates. */
  panelTop: number;
  panelHeight: number;
  viewportH: number;
  /** Sticky header height (`--header-h`). */
  headerH: number;
  /** Mobile bottom nav height (`--bottomnav-h`; 0 on desktop). */
  bottomNavH: number;
  scrollY: number;
}

/**
 * Decide where the page should scroll to when a panel opens, or `null` for
 * "leave the page alone" — scrolling when nothing needed to move is the most
 * annoying failure mode of an expanding grid.
 *
 * Three branches:
 *  1. Already fully visible between the insets → don't scroll.
 *  2. Fits in the available height → move the minimum that brings it inside.
 *  3. Taller than the viewport → align the *source card's* top under the header.
 *     Aligning on the panel's bottom here would strand the panel's own heading
 *     and first control above the fold, which is the whole point of this branch.
 */
export function scrollPlan({
  cardTop,
  panelTop,
  panelHeight,
  viewportH,
  headerH,
  bottomNavH,
  scrollY,
}: ScrollPlanInput): number | null {
  const topInset = headerH + SCROLL_GAP;
  const bottomInset = bottomNavH + SCROLL_GAP;
  const available = viewportH - topInset - bottomInset;
  const panelBottom = panelTop + panelHeight;
  const visibleTop = scrollY + topInset;
  const visibleBottom = scrollY + viewportH - bottomInset;

  if (panelTop >= visibleTop && panelBottom <= visibleBottom) return null;

  let target: number;
  if (panelHeight <= available) {
    target =
      panelBottom > visibleBottom
        ? panelBottom - viewportH + bottomInset // scroll down the minimum
        : panelTop - topInset; // scroll up the minimum
  } else {
    target = cardTop - topInset;
  }

  const clamped = Math.max(0, target);
  // Sub-pixel layout noise must not trigger a smooth-scroll animation to
  // where we already are.
  return Math.abs(clamped - scrollY) < 1 ? null : clamped;
}
