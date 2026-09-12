import { Button } from '../../core/ui/Button';
import { CloseIcon } from '../../core/ui/icons';

/**
 * The `?`/`H` shortcuts card (PLAN-28). One list, so a binding added to
 * `useSlideshowNav` and not added here is visible as a gap rather than silently
 * undocumented.
 */
const BINDINGS: readonly {
  keys: string;
  does: string;
  needsFullscreen?: true;
  /** Wording when fullscreen exists — Esc does two jobs there, one here. */
  fullscreenAlso?: string;
  /** Wording on a deck whose slides can carry no note — a PDF (PLAN-29). */
  withoutNotes?: string;
}[] = [
  { keys: '→ · ↓ · Space · PageDown · S · D', does: 'Next slide' },
  { keys: '← · ↑ · Backspace · PageUp · W · A', does: 'Previous slide' },
  { keys: 'Home · End', does: 'First · last slide' },
  { keys: 'F', does: 'Enter or leave fullscreen', needsFullscreen: true },
  {
    keys: 'N',
    does: 'Show or hide presenter notes',
    withoutNotes: 'Presenter notes — markdown decks only',
  },
  { keys: '+ · −', does: 'Bigger · smaller slide text' },
  { keys: '0', does: 'Slide text back to 100%' },
  { keys: '? · H', does: 'This list' },
  { keys: 'Esc', does: 'Close this list', fullscreenAlso: 'Close this list, or leave fullscreen' },
];

export function ShortcutsOverlay({
  canFullscreen,
  canNotes,
  onClose,
}: {
  /** Fullscreen rows are omitted where the browser has no element fullscreen. */
  canFullscreen: boolean;
  /**
   * False on a PDF deck. The row is **kept** rather than dropped, unlike the
   * fullscreen ones: `F` on an iPhone is a key the browser will never honour,
   * but `N` is a real Saga binding that this particular deck has nothing to
   * show for — so the list stays the same list and says why, instead of
   * leaving a presenter to wonder whether they misremembered the key.
   */
  canNotes: boolean;
  onClose: () => void;
}) {
  const wording = (binding: (typeof BINDINGS)[number]): string => {
    if (!canNotes && binding.withoutNotes) return binding.withoutNotes;
    if (canFullscreen && binding.fullscreenAlso) return binding.fullscreenAlso;
    return binding.does;
  };
  const bindings = BINDINGS.filter((binding) => canFullscreen || !binding.needsFullscreen).map(
    (binding) => ({ ...binding, does: wording(binding) }),
  );
  return (
    <div className="saga-shortcuts" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
      <div className="saga-shortcuts__card">
        <div className="saga-shortcuts__head">
          <h2>Shortcuts</h2>
          <Button variant="ghost" size="icon" aria-label="Close shortcuts" onClick={onClose}>
            <CloseIcon size={16} />
          </Button>
        </div>
        <dl className="saga-shortcuts__list">
          {bindings.map((binding) => (
            <div className="saga-shortcuts__row" key={binding.keys}>
              <dt className="mono">{binding.keys}</dt>
              <dd>{binding.does}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
