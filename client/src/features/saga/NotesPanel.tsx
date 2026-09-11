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
 *
 * **Showing notes is a mode, not a per-slide state.** It used to render nothing
 * at all on a slide without a note, which made pressing `N` look broken on
 * every slide the author had not annotated — the panel, the footer toggle and
 * any sign the key had been read all vanished together. Now the panel stays and
 * says there is nothing here, so the binding always has a visible answer.
 */
export function NotesPanel({ notes }: { notes: string | null }) {
  return (
    <aside className="saga-notes" aria-label="Presenter notes">
      <p className="caption saga-notes__label">Presenter notes</p>
      {notes ? (
        <p className="saga-notes__body">{notes}</p>
      ) : (
        <p className="saga-notes__empty caption">
          Nothing written for this slide. Add <code>{'<!-- notes: … -->'}</code> to the source.
        </p>
      )}
    </aside>
  );
}
