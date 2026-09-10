/**
 * Presenter notes (PLAN-28).
 *
 * The same "an optional side panel beside the main content" shape Loki's output
 * drawer and Edda's outline rail already use — a familiar layout, not a shared
 * component being reused.
 *
 * Notes are rendered as plain text rather than through `renderMarkdown`: a note
 * is a prompt to the person speaking, and the one thing it must never do is
 * differ from what was typed.
 */
export function NotesPanel({ notes }: { notes: string | null }) {
  // Never an empty box: a slide without a note renders no panel at all, and the
  // footer hides its toggle for the same reason.
  if (!notes) return null;

  return (
    <aside className="saga-notes" aria-label="Presenter notes">
      <p className="caption saga-notes__label">Presenter notes</p>
      <p className="saga-notes__body">{notes}</p>
    </aside>
  );
}
