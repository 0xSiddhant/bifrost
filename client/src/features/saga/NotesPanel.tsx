import type { SagaSlide } from './loadSource';

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
 *
 * **A PDF page is the one slide that renders no panel at all** (PLAN-29), and
 * that is branched on here rather than left to fall through the `notes === null`
 * path above. The two are different facts: a markdown slide with no note is a
 * deck the author has not annotated *yet*, and the panel's empty state says how
 * to. A rasterized page has no source to add a note to, so the same message
 * there would be an instruction that cannot be followed. Nothing else in Saga
 * reaches this state, because `SagaPage` withholds the toggle too.
 */
export function NotesPanel({ slide }: { slide: SagaSlide | undefined }) {
  if (slide?.kind === 'pdf') return null;
  const notes = slide?.notes ?? null;

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
