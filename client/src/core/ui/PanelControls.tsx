import type { PanelFont } from '../panelFont';
import type { JsonEditorHandle } from './JsonEditor';
import { RedoIcon, UndoIcon } from './icons';

/**
 * The shared editor-panel control cluster (PLAN-12): undo / redo icon buttons
 * and the A− / A / A+ per-device text-size trio. Mounted by Loki, Runestone,
 * and Variant so every editor panel offers the same affordances.
 */

export function PanelFontControl({ font }: { font: PanelFont }) {
  return (
    <span className="panel-fontctl" role="group" aria-label="Panel text size">
      <button type="button" aria-label="Smaller text" onClick={font.dec}>
        A−
      </button>
      <button type="button" aria-label="Reset text size" onClick={font.reset}>
        A
      </button>
      <button type="button" aria-label="Larger text" onClick={font.inc}>
        A+
      </button>
    </span>
  );
}

export function UndoRedoControl({
  editor,
  disabled = false,
}: {
  editor: React.RefObject<JsonEditorHandle | null>;
  disabled?: boolean;
}) {
  return (
    <span className="panel-undoredo" role="group" aria-label="Undo and redo">
      <button
        type="button"
        className="panel-iconbtn"
        aria-label="Undo"
        title="Undo (⌘/Ctrl-Z)"
        disabled={disabled}
        onClick={() => editor.current?.undo()}
      >
        <UndoIcon size={15} />
      </button>
      <button
        type="button"
        className="panel-iconbtn"
        aria-label="Redo"
        title="Redo (⌘/Ctrl-Shift-Z)"
        disabled={disabled}
        onClick={() => editor.current?.redo()}
      >
        <RedoIcon size={15} />
      </button>
    </span>
  );
}
