import { useEffect, useState } from 'react';
import { bifrostEvents, type SseStatus } from '../../core/sse';
import { listDownloads, type DownloadEntry } from '../../core/api';
import { notify } from '../../core/notify';

/** One standing notification for a failing listing, however often it retries. */
const LISTING_ERROR = 'downloads-listing';

export interface DownloadsState {
  /** null while the first fetch is in flight. */
  entries: DownloadEntry[] | null;
  sseStatus: SseStatus;
}

/**
 * Live listing: one fetch for the snapshot, then SSE deltas keep it current.
 * Every reconnect refetches — events missed while offline are lost, so the
 * snapshot is the only way back to truth.
 */
export function useDownloads(): DownloadsState {
  const [entries, setEntries] = useState<DownloadEntry[] | null>(null);
  const [sseStatus, setSseStatus] = useState<SseStatus>(() => bifrostEvents.status);

  useEffect(() => {
    let disposed = false;

    const refresh = () => {
      listDownloads()
        .then((list) => {
          if (disposed) return;
          setEntries(list);
          // Errors never auto-dismiss, so the one thing that must clear this
          // is the listing working again — and having warned that the list was
          // stale, it owes the reader a word when it stops being stale.
          // Cleared by key, not by a captured id: the error outlives this
          // mount, so the page that recovers is often not the one that failed.
          if (notify.dismissKey(LISTING_ERROR)) notify.ok('Downloads list is back in sync');
        })
        .catch((error: Error) => {
          // The stale list stays on screen — but silently showing a listing
          // that may be minutes out of date is how "the file isn't there"
          // becomes a mystery. One entry, deduped, however often it retries.
          notify.error(`Could not refresh the downloads list — ${error.message}`, {
            title: 'Receive',
            dedupeKey: LISTING_ERROR,
          });
        });
    };
    refresh();

    const upsert = (payload: unknown) => {
      const entry = payload as DownloadEntry;
      setEntries((prev) => [entry, ...(prev ?? []).filter((e) => e.id !== entry.id)]);
    };
    const remove = (payload: unknown) => {
      const entry = payload as DownloadEntry;
      setEntries((prev) => (prev ?? []).filter((e) => e.id !== entry.id));
    };

    const unsubscribes = [
      bifrostEvents.on('download.added', upsert),
      bifrostEvents.on('download.changed', upsert),
      bifrostEvents.on('download.removed', remove),
      bifrostEvents.onStatus((status) => {
        setSseStatus(status);
        if (status === 'open') refresh();
      }),
    ];
    return () => {
      disposed = true;
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, []);

  return { entries, sseStatus };
}
