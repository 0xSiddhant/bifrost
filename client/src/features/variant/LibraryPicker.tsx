import { useEffect, useMemo, useState } from 'react';
import { deviceName, onDevicesChange } from '../../core/devices';
import { formatBytes, formatTimeAgo } from '../../core/format';
import {
  fetchRunestone,
  listRunestones,
  type RunestoneDoc,
  type RunestoneSummary,
} from '../../core/runestone';
import { Modal } from '../../core/ui/Modal';
import { EmptyState } from '../../core/ui/EmptyState';
import { BracesIcon, SearchIcon } from '../../core/ui/icons';

/**
 * Per-pane runestone picker (PLAN-08): load a saved document from the Pensieve into
 * a compare pane. Read-only against the runestone API — saving stays on the
 * Runestone page.
 */

interface LibraryPickerProps {
  open: boolean;
  side: 'left' | 'right';
  onPick: (doc: RunestoneDoc) => void;
  onClose: () => void;
}

export function LibraryPicker({ open, side, onPick, onClose }: LibraryPickerProps) {
  const [docs, setDocs] = useState<RunestoneSummary[] | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [, setDevicesTick] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setDocs(null);
    setError(null);
    listRunestones({ sort: 'modified', order: 'desc' })
      .then((list) => {
        if (!cancelled) setDocs(list);
      })
      .catch(() => {
        if (!cancelled) setError('Could not reach the Pensieve — is the bridge up?');
      });
    const unsubscribe = onDevicesChange(() => setDevicesTick((tick) => tick + 1));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [open]);

  const filtered = useMemo(() => {
    if (!docs) return null;
    const needle = query.trim().toLowerCase();
    if (needle === '') return docs;
    return docs.filter((doc) => doc.name.toLowerCase().includes(needle));
  }, [docs, query]);

  const pick = async (summary: RunestoneSummary) => {
    setBusySlug(summary.slug);
    try {
      const doc = await fetchRunestone(summary.slug);
      if (doc) onPick(doc);
      else setError(`“${summary.name}” has crumbled — refresh and try again.`);
    } catch {
      setError('Could not load that runestone.');
    } finally {
      setBusySlug(null);
    }
  };

  return (
    <Modal
      open={open}
      title={`Load into the ${side === 'left' ? 'left' : 'right'} pane`}
      onClose={onClose}
    >
      <div className="variant-picker">
        <label className="variant-picker__search">
          <SearchIcon size={16} />
          <input
            type="search"
            placeholder="Search by name…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search runestones"
          />
        </label>
        {error && <p className="variant-picker__error">{error}</p>}
        {filtered === null && !error && <p className="caption">Reading the stones…</p>}
        {filtered !== null && filtered.length === 0 && (
          <EmptyState
            icon={<BracesIcon size={28} />}
            title="Nothing carved yet"
            hint="Save a document on the Runestone page and it appears here."
          />
        )}
        {filtered !== null && filtered.length > 0 && (
          <ul className="variant-picker__list">
            {filtered.map((doc) => (
              <li key={doc.id}>
                <button
                  type="button"
                  disabled={busySlug !== null}
                  onClick={() => void pick(doc)}
                >
                  <span className="variant-picker__name">{doc.name}</span>
                  <span className="variant-picker__meta caption">
                    {doc.authorDeviceId ? (deviceName(doc.authorDeviceId) ?? 'departed device') : 'unknown carver'}
                    {' · '}
                    {formatBytes(doc.sizeBytes)} · {formatTimeAgo(doc.modifiedAt)}
                    {busySlug === doc.slug && ' · loading…'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
