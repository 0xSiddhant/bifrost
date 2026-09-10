import { Button } from '../../core/ui/Button';
import { ChevronLeftIcon, ChevronRightIcon, DocFileIcon, MonitorIcon } from '../../core/ui/icons';

/**
 * The one footer, rendered in both modes (PLAN-28).
 *
 * Windowed it is a static bar beneath the slide that never hides; fullscreen it
 * is the same markup overlaid on a scrim, shown and hidden by the page's
 * `useIdleActivity`. There is deliberately no second, fullscreen-only chrome
 * tree to keep in sync with this one.
 *
 * Explicit prev/next buttons matter here specifically: not everyone discovers
 * the key bindings, and a touch user without a keyboard has no other way in.
 */
export interface SlideFooterProps {
  index: number;
  count: number;
  onPrevious: () => void;
  onNext: () => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  /** Fullscreen only. Windowed callers pass `true` and it never changes. */
  visible: boolean;
  /** Absent when the current slide carries no note — no dead toggle. */
  hasNotes: boolean;
  notesOpen: boolean;
  onToggleNotes: () => void;
  onShowShortcuts: () => void;
}

export function SlideFooter({
  index,
  count,
  onPrevious,
  onNext,
  fullscreen,
  onToggleFullscreen,
  visible,
  hasNotes,
  notesOpen,
  onToggleNotes,
  onShowShortcuts,
}: SlideFooterProps) {
  const classes = ['saga-footer'];
  // Overlaid rather than in flow: reserving layout space would make the slide
  // visibly shift every time the footer faded in or out, which reads as
  // unpolished in the middle of a real presentation.
  if (fullscreen) classes.push('saga-footer--overlay');
  if (fullscreen && !visible) classes.push('saga-footer--idle');

  return (
    <div className={classes.join(' ')} data-testid="saga-footer">
      <span className="saga-footer__position mono" aria-live="polite">
        {count === 0 ? '0 / 0' : `${index + 1} / ${count}`}
      </span>

      <div className="saga-footer__nav">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Previous slide"
          onClick={onPrevious}
          disabled={index === 0}
        >
          <ChevronLeftIcon size={16} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Next slide"
          onClick={onNext}
          disabled={index >= count - 1}
        >
          <ChevronRightIcon size={16} />
        </Button>
      </div>

      <span className="saga-footer__hint caption">← → navigate · F fullscreen · ? shortcuts</span>

      <div className="saga-footer__actions">
        {hasNotes && (
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={notesOpen}
            aria-label={notesOpen ? 'Hide presenter notes' : 'Show presenter notes'}
            onClick={onToggleNotes}
          >
            <DocFileIcon size={15} /> Notes
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={fullscreen}
          aria-label={fullscreen ? 'Leave fullscreen' : 'Enter fullscreen'}
          onClick={onToggleFullscreen}
        >
          <MonitorIcon size={15} /> {fullscreen ? 'Exit' : 'Fullscreen'}
        </Button>
        <Button variant="ghost" size="sm" aria-label="Keyboard shortcuts" onClick={onShowShortcuts}>
          ?
        </Button>
      </div>
    </div>
  );
}
