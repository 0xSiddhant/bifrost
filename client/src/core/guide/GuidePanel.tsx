import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { renderMarkdown } from '../markdown';
import { log } from '../log';
import { Button } from '../ui/Button';
import { MarkdownPreview } from '../ui/MarkdownPreview';
import { CloseIcon } from '../ui/icons';
import type { Guide } from './registry';

/**
 * The slide-out reference for the format the current page works with (PLAN-30).
 *
 * Two shapes, one component: a wide right-edge drawer on a desktop, and a
 * bottom sheet on a phone, which is the shape a thumb expects and can throw
 * away without reaching for a small × in a far corner. Which one is showing is
 * a pure CSS decision at the same 640px breakpoint the bottom nav uses; the
 * only thing JavaScript needs to know is whether the swipe-down gesture
 * applies, since a drawer has nothing to swipe.
 *
 * It renders through a portal into `document.body` rather than in place. The
 * button that owns it sits inside the sticky header, which is its own stacking
 * context at `z-index: 10` — a sheet rendered there would sit *under* the
 * mobile bottom nav, which is exactly where a bottom sheet must not be.
 *
 * The scrim behind it dims the page and closes on a click. That is a
 * deliberate reversal of the plan's "does not block interaction with the rest
 * of the page", made at the owner's request: the dimming is what tells you the
 * sheet is on top of your work rather than part of it, and tapping away is the
 * dismissal people try first.
 *
 * Content is loaded here rather than by the button so the button holds no
 * state it does not need: mounting the panel *is* opening it, and the module
 * system caches the import, so re-opening costs no second fetch.
 */

/** Past this much downward travel, letting go dismisses instead of snapping back. */
const DISMISS_AFTER_PX = 96;

/** The bottom-sheet breakpoint — the same one that puts the nav at the bottom. */
const SHEET_QUERY = '(max-width: 640px)';

export function GuidePanel({ guide, onClose }: { guide: Guide; onClose: () => void }) {
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [dragY, setDragY] = useState(0);
  const dragFrom = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    setFailed(false);
    guide
      .load()
      .then((markdown) => {
        if (!cancelled) setHtml(renderMarkdown(markdown));
      })
      .catch((err: unknown) => {
        // A guide is a bundled chunk, so this is the same class of failure
        // RouteBoundary exists for: the host went away mid-session.
        log.error(`guide: failed to load the ${guide.id} guide: ${(err as Error).message}`, {
          module: 'guide',
        });
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [guide]);

  // Swipe down to dismiss, on the sheet's header only: dragging from the body
  // would fight the scroll of the very text the sheet exists to show.
  const startDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (!window.matchMedia(SHEET_QUERY).matches) return;
    dragFrom.current = event.clientY;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (dragFrom.current === null) return;
    // Downward only — an upward drag on a sheet already at its stop is a no-op.
    setDragY(Math.max(0, event.clientY - dragFrom.current));
  };

  const endDrag = () => {
    if (dragFrom.current === null) return;
    dragFrom.current = null;
    const travelled = dragY;
    setDragY(0);
    if (travelled > DISMISS_AFTER_PX) onClose();
  };

  const dragging = dragFrom.current !== null;

  return createPortal(
    <>
      <div className="guide-scrim" onClick={onClose} aria-hidden="true" />
      <aside
        className={`guide-panel${dragging ? ' guide-panel--dragging' : ''}`}
        role="complementary"
        aria-label={`${guide.title} guide`}
        style={dragY ? { transform: `translateY(${dragY}px)` } : undefined}
      >
        <header
          className="guide-panel__head"
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {/* Shown only in sheet mode, where it is the thing you drag. */}
          <span className="guide-panel__grab" aria-hidden="true" />
          <h2 className="guide-panel__title">{guide.title}</h2>
          <Button variant="ghost" size="icon" aria-label="Close guide" onClick={onClose}>
            <CloseIcon size={18} />
          </Button>
        </header>

        {html !== null && (
          <MarkdownPreview html={html} className="guide-panel__body" module="guide" />
        )}
        {html === null && !failed && (
          <p className="guide-panel__status caption">Loading the {guide.title} guide…</p>
        )}
        {failed && (
          <p className="guide-panel__status caption">
            The {guide.title} guide could not be loaded. It ships with the app, so this usually
            means the connection to the bridge dropped — try again once it is back.
          </p>
        )}
      </aside>
    </>,
    document.body,
  );
}
