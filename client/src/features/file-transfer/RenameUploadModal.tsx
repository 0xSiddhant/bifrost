import { useState } from 'react';
import { ApiError } from '../../core/api';
import { Button } from '../../core/ui/Button';
import { Input } from '../../core/ui/Field';
import { Modal } from '../../core/ui/Modal';
import { renameUpload } from './api';

interface RenameUploadModalProps {
  storedName: string;
  onClose: () => void;
  onRenamed: (finalName: string, renamed: boolean) => void;
}

/**
 * Rename a staged file (PLAN-17b).
 *
 * The server never quietly cleans up a name: a name its sanitizer would change
 * comes back 422 carrying the name it *would* have used, and that becomes a
 * one-click offer here. Duplicating the sanitizer in the browser would have
 * saved a round trip and guaranteed the two copies drift.
 */
export function RenameUploadModal({ storedName, onClose, onRenamed }: RenameUploadModalProps) {
  const [name, setName] = useState(storedName);
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = (candidate: string) => {
    if (saving || candidate.trim() === '') return;
    setSaving(true);
    setError(null);
    renameUpload(storedName, candidate)
      .then(({ finalName, renamed }) => onRenamed(finalName, renamed))
      .catch((failure: unknown) => {
        if (failure instanceof ApiError && failure.status === 422) {
          const clean = failure.details?.suggestion;
          setSuggestion(typeof clean === 'string' ? clean : null);
          setError(failure.message);
        } else if (failure instanceof ApiError && failure.status === 404) {
          setError('that file is no longer staged');
        } else {
          setError(failure instanceof Error ? failure.message : 'rename failed');
        }
      })
      .finally(() => setSaving(false));
  };

  return (
    <Modal open title="Rename file" onClose={onClose}>
      <div className="stack">
        <Input
          label="New name"
          value={name}
          autoFocus
          onChange={(event) => {
            setName(event.target.value);
            // The message described the previous text; once that changes it is
            // stale, and a stuck red line reads as an unfixable failure.
            setError(null);
            setSuggestion(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') save(name);
          }}
        />

        {error && (
          <p className="caption form-error" role="alert">
            {error}
          </p>
        )}

        <div className="row">
          {suggestion ? (
            <Button
              onClick={() => {
                setName(suggestion);
                save(suggestion);
              }}
            >
              Use “{suggestion}”
            </Button>
          ) : (
            <Button onClick={() => save(name)} disabled={saving || name === storedName}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}
