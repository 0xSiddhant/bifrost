import { Button } from '../../core/ui/Button';
import { CloseIcon } from '../../core/ui/icons';

/**
 * The `?`/`H` shortcuts card (PLAN-28). One list, so a binding added to
 * `useSlideshowNav` and not added here is visible as a gap rather than silently
 * undocumented.
 */
const BINDINGS: readonly { keys: string; does: string }[] = [
  { keys: '→ · ↓ · Space · PageDown · S · D', does: 'Next slide' },
  { keys: '← · ↑ · Backspace · PageUp · W · A', does: 'Previous slide' },
  { keys: 'Home · End', does: 'First · last slide' },
  { keys: 'F', does: 'Enter or leave fullscreen' },
  { keys: 'N', does: 'Show or hide presenter notes' },
  { keys: '+ · −', does: 'Bigger · smaller slide text' },
  { keys: '0', does: 'Slide text back to 100%' },
  { keys: '? · H', does: 'This list' },
  { keys: 'Esc', does: 'Close this list, or leave fullscreen' },
  { keys: 'Swipe', does: 'Next or previous slide, on a touch screen' },
];

export function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
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
          {BINDINGS.map((binding) => (
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
