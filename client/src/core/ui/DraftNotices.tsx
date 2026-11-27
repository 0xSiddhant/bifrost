import type { DraftOffer } from '../draftCache';
import { Button } from './Button';
import { Toast } from './Toast';

/**
 * The draft banners every Ollivanders editor shows (PLAN-43), so their wording
 * cannot drift between pages:
 *
 * - an offer of another tab's draft, or the one saved before the update,
 *   shown only while the buffer is blank (typing hides it, emptying the
 *   editor brings it back);
 * - a saved document whose server copy changed after this tab's local edits,
 *   with an explicit choice and nothing overwritten until it is made;
 * - a draft that could not be kept or restored, which is never silent.
 */

interface Props {
  offer: DraftOffer<unknown> | null;
  blank: boolean;
  busy: boolean;
  onRestore: () => void;
  onDismiss: () => void;
  offerError: string | null;
  conflict: boolean;
  onKeepLocal: () => void;
  onUseServer: () => void;
  writeError: string | null;
}

export function DraftNotices({
  offer,
  blank,
  busy,
  onRestore,
  onDismiss,
  offerError,
  conflict,
  onKeepLocal,
  onUseServer,
  writeError,
}: Props) {
  return (
    <>
      {offer && blank && (
        <Toast kind="info">
          <span className="rune-restore">
            {offer.kind === 'tab'
              ? 'Restore draft from another tab?'
              : 'Restore draft saved before this update?'}
            <Button size="sm" onClick={onRestore} disabled={busy}>
              Restore
            </Button>
            <Button size="sm" variant="ghost" onClick={onDismiss} disabled={busy}>
              Dismiss
            </Button>
          </span>
        </Toast>
      )}
      {conflict && (
        <Toast kind="info">
          <span className="rune-restore">
            This document changed on the server after your local edits in this tab.
            <Button size="sm" onClick={onKeepLocal}>
              Keep local draft
            </Button>
            <Button size="sm" variant="ghost" onClick={onUseServer}>
              Use server version
            </Button>
          </span>
        </Toast>
      )}
      {offerError && <Toast kind="danger">{offerError}</Toast>}
      {writeError && (
        <Toast kind="danger">
          Unsaved edits are not being kept in this browser: {writeError}.
        </Toast>
      )}
    </>
  );
}
