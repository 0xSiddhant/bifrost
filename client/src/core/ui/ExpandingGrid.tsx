import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Link } from 'react-router-dom';
import { CloseIcon } from './icons';
import { cardToneClass } from './cardTone';
import { columnCount, panelInsertIndex, scrollPlan } from './expandingGridMath';

/** Panel inner layout — see PLAN-18. `split` = controls | live output. */
export type PanelLayout = 'split' | 'full';

export interface ExpandingGridItem {
  id: string;
  title: string;
  /** One-line hint under the title. Tool cards are compact by design. */
  hint: string;
  icon: ReactNode;
  /** Set for a card that navigates instead of expanding (Nimbus, Portkey). */
  to?: string;
  /** How the open panel uses the full width. Ignored for `to` cards. */
  layout?: PanelLayout;
}

interface ExpandingGridProps {
  items: ExpandingGridItem[];
  /** Which item's panel is open — owned by the caller, which keeps it in the URL. */
  openId: string | null;
  onOpen: (id: string) => void;
  onClose: () => void;
  /** Panel contents for the open item. */
  children?: ReactNode;
  /** Accessible name for the grid itself. */
  label: string;
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION).matches;
}

/** Read a length token (`--header-h`) off the root element, in pixels. */
function readInsetPx(name: string): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!raw) return 0;
  if (raw.endsWith('rem')) {
    const rootFont = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    return Number.parseFloat(raw) * rootFont;
  }
  return Number.parseFloat(raw) || 0;
}

/**
 * ExpandingGrid — a grid of cards where one card can open a **full-width panel
 * at the end of its own row** (PLAN-18). Cards keep their column; nothing jumps
 * sideways; the panel inherits the source card's tone so the expansion visibly
 * belongs to the card that opened it.
 *
 * Lives in core/ui because it is page furniture, not a feature: the toolbox is
 * the first consumer and Ollivanders is the obvious next one. The caller owns
 * `openId` (Diagon Alley keeps it in the URL) and renders the panel body.
 */
export function ExpandingGrid({
  items,
  openId,
  onOpen,
  onClose,
  children,
  label,
}: ExpandingGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const cardRefs = useRef(new Map<string, HTMLButtonElement>());
  const [cols, setCols] = useState(1);
  const [caretX, setCaretX] = useState<number | null>(null);
  const panelId = useId();
  const headingId = useId();

  const openIndex = items.findIndex((item) => item.id === openId);
  const openItem = openIndex >= 0 ? items[openIndex] : null;

  const setCardRef = useCallback((id: string, node: HTMLButtonElement | null) => {
    if (node) cardRefs.current.set(id, node);
    else cardRefs.current.delete(id);
  }, []);

  /**
   * The live column count. `auto-fit` means the authored value says nothing —
   * only the *used* track list does. Measuring in a layout effect means the
   * first paint already has the panel in the right row: no visible jump.
   */
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const measure = () => setCols(columnCount(getComputedStyle(grid).gridTemplateColumns));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    return () => observer.disconnect();
  }, []);

  /**
   * Caret position: the source card's horizontal centre relative to the grid.
   * Recomputed whenever the layout could have moved it. If it cannot be
   * measured the caret is hidden — a caret pointing at the wrong card is worse
   * than no caret.
   */
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid || !openId) {
      setCaretX(null);
      return;
    }
    const measureCaret = () => {
      const card = cardRefs.current.get(openId);
      if (!card) {
        setCaretX(null);
        return;
      }
      const cardRect = card.getBoundingClientRect();
      const gridRect = grid.getBoundingClientRect();
      setCaretX(cardRect.left + cardRect.width / 2 - gridRect.left);
    };
    measureCaret();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measureCaret);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [openId, cols]);

  /**
   * Scroll the panel into view — on open and on tool-switch only. Deliberately
   * NOT on resize or on a column re-measure: yanking the page while someone
   * drags a window is the behaviour this dependency list exists to prevent.
   *
   * Two passes, not one. The first runs after a frame, which is enough when the
   * body is already in the bundle. But the first tool opened arrives as a lazy
   * chunk, so that frame holds the *skeleton* — measuring it plans against a
   * panel a third of its final height and picks the wrong branch entirely (a
   * tall tool then lands with its own controls above the fold, the exact bug
   * branch 3 exists to prevent). So a ResizeObserver watches the panel and
   * re-plans **once**, the first time its height actually changes, then
   * disconnects: at most two scrolls per open, and a window resize after the
   * panel has settled can no longer move the page.
   */
  useLayoutEffect(() => {
    if (!openId) return;
    let observer: ResizeObserver | null = null;
    let lastHeight = -1;

    const plan = () => {
      const panel = panelRef.current;
      const card = cardRefs.current.get(openId);
      if (!panel || !card) return;
      const scrollY = window.scrollY;
      const panelRect = panel.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      lastHeight = panelRect.height;
      const target = scrollPlan({
        cardTop: cardRect.top + scrollY,
        panelTop: panelRect.top + scrollY,
        panelHeight: panelRect.height,
        viewportH: window.innerHeight,
        headerH: readInsetPx('--header-h'),
        bottomNavH: readInsetPx('--bottomnav-h'),
        scrollY,
      });
      if (target === null) return;
      window.scrollTo({ top: target, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    };

    const frame = requestAnimationFrame(() => {
      plan();
      const panel = panelRef.current;
      if (!panel || typeof ResizeObserver === 'undefined') return;
      observer = new ResizeObserver(() => {
        // Ignore the observer's own first callback, which reports the height we
        // just planned against.
        if (Math.abs(panel.getBoundingClientRect().height - lastHeight) < 1) return;
        observer?.disconnect();
        observer = null;
        plan();
      });
      observer.observe(panel);
    });

    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [openId]);

  /** Focus moves into the panel on open, without the browser scrolling for us. */
  useEffect(() => {
    if (!openId) return;
    panelRef.current?.focus({ preventScroll: true });
  }, [openId]);

  const closeAndRestoreFocus = useCallback(() => {
    const card = openId ? cardRefs.current.get(openId) : null;
    onClose();
    card?.focus({ preventScroll: true });
  }, [onClose, openId]);

  const onPanelKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    closeAndRestoreFocus();
  };

  const cards = items.map((item, index) => {
    const tone = cardToneClass(index + 1);
    const className = `tone-surface tone-surface--interactive tool-card ${tone}`;
    const body = (
      <>
        <span className="tone-chip tool-card__icon">{item.icon}</span>
        <span className="tool-card__text">
          <span className="tool-card__title">{item.title}</span>
          <span className="tool-card__hint">{item.hint}</span>
        </span>
      </>
    );

    if (item.to) {
      return (
        <Link key={item.id} to={item.to} className={`${className} tool-card--route`}>
          {body}
        </Link>
      );
    }
    const isOpen = item.id === openId;
    return (
      <button
        key={item.id}
        type="button"
        ref={(node) => setCardRef(item.id, node)}
        className={isOpen ? `${className} tool-card--open` : className}
        aria-expanded={isOpen}
        aria-controls={isOpen ? panelId : undefined}
        onClick={() => (isOpen ? closeAndRestoreFocus() : onOpen(item.id))}
      >
        {body}
      </button>
    );
  });

  let rendered: ReactNode[] = cards;
  if (openItem) {
    const insertAt = panelInsertIndex(openIndex, cols, items.length);
    const panel = (
      <section
        key="__panel__"
        id={panelId}
        ref={panelRef}
        className={`tone-surface tool-panel ${cardToneClass(openIndex + 1)}`}
        style={caretX === null ? undefined : ({ '--caret-x': `${caretX}px` } as CSSProperties)}
        role="region"
        aria-labelledby={headingId}
        tabIndex={-1}
        onKeyDown={onPanelKeyDown}
      >
        {caretX !== null && <span className="tool-panel__caret" aria-hidden="true" />}
        <div className="tool-panel__head">
          <h3 className="tool-panel__title" id={headingId}>
            {openItem.title}
          </h3>
          <button
            type="button"
            className="btn btn--ghost btn--icon tool-panel__close"
            onClick={closeAndRestoreFocus}
            aria-label={`Close ${openItem.title}`}
          >
            <CloseIcon size={18} />
          </button>
        </div>
        <div className={`tool-panel__body tool-panel__body--${openItem.layout ?? 'full'}`}>
          {children}
        </div>
      </section>
    );
    rendered = [...cards.slice(0, insertAt), panel, ...cards.slice(insertAt)];
  }

  return (
    <div className="toolbox-grid" ref={gridRef} role="group" aria-label={label}>
      {rendered}
    </div>
  );
}
