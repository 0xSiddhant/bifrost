import { useRef, useState } from 'react';
import { Button } from '../../core/ui/Button';
import { SlidesIcon } from '../../core/ui/icons';

/**
 * The bare `/saga` landing state (PLAN-28, PLAN-29): drop a markdown file or a
 * PDF, present it.
 *
 * Nothing is uploaded and nothing is stored — `SagaPage` turns the `File` this
 * reports into an object URL, which is an address for bytes already sitting in
 * browser memory. Losing an in-progress deck to an accidental refresh is
 * accepted, matching how Loki's execution state and Diagon Alley's tools
 * already behave: the drop is re-done, not recovered.
 *
 * The object URL's own lifecycle deliberately lives in `SagaPage` rather than
 * here, where the plan's checklist sketched it: this component unmounts the
 * moment a deck is showing, so revoking on *its* unmount would tear down the
 * URL a moment after handing it over.
 */
/**
 * Matched on the extension rather than the `File`'s own MIME type: browsers
 * disagree about markdown (`text/markdown`, `text/plain`, or empty depending on
 * the OS), and an empty type is common enough that typing alone would reject
 * real files. `loadSource` makes the same call for the opposite reason — it has
 * bytes and no reliable name, so it reads the content type and the file's own
 * `%PDF-` header.
 */
const ACCEPTED = ['.md', '.markdown', '.pdf'];

function isPresentable(file: File): boolean {
  const name = file.name.toLowerCase();
  return ACCEPTED.some((extension) => name.endsWith(extension));
}

export function Dropzone({ onFile }: { onFile: (file: File) => void }) {
  const [over, setOver] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const take = (file: File | undefined) => {
    if (!file) return;
    if (!isPresentable(file)) {
      setRejected(`Saga can't present “${file.name}” — it presents ${ACCEPTED.join(', ')} files.`);
      return;
    }
    setRejected(null);
    onFile(file);
  };

  return (
    <div className="saga-landing">
      <div className="page-head">
        <div>
          <span className="eyebrow">᛫ saga ᛫</span>
          <h2>Present a deck</h2>
          <p>
            Drop a markdown file to present it as slides — split on a <code>---</code> line — or a
            PDF, one page per slide. Never uploaded, never stored. Or open a saved manuscript from
            the <a href="/pensieve?type=edda">Pensieve</a>.
          </p>
        </div>
      </div>

      <div
        className={over ? 'saga-drop saga-drop--over' : 'saga-drop'}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          take(event.dataTransfer.files[0]);
        }}
      >
        <SlidesIcon size={32} />
        <p className="saga-drop__title">Drop a .md or .pdf file here</p>
        <p className="caption">or</p>
        <Button variant="ghost" onClick={() => input.current?.click()}>
          Choose a file
        </Button>
        <input
          ref={input}
          type="file"
          accept=".md,.markdown,.pdf,text/markdown,application/pdf"
          className="saga-drop__input"
          onChange={(event) => {
            take(event.target.files?.[0]);
            // Cleared so choosing the same file twice in a row still fires.
            event.target.value = '';
          }}
        />
      </div>

      {rejected && (
        <p className="saga-landing__error" role="alert">
          {rejected}
        </p>
      )}
    </div>
  );
}
