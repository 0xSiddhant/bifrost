import { useEffect, useState } from 'react';
import { LiveListSync } from '../../core/liveList';
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
    // A refresh's answer must not wipe a live row that landed while it was in
    // flight (mount and every SSE reconnect both refresh) — see core/liveList.
    const sync = new LiveListSync<DownloadEntry>();

    const refresh = () => {
      const fetchId = sync.begin();
      listDownloads()
        .then((list) => {
          if (disposed) return;
          const merged = sync.settle(fetchId, list);
          if (merged) setEntries(merged);
          // Errors never auto-dismiss, so the one thing that must clear this
          // is the listing working again — and having warned that the list was
          // stale, it owes the reader a word when it stops being stale.
          // Cleared by key, not by a captured id: the error outlives this
          // mount, so the page that recovers is often not the one that failed.
          if (notify.dismissKey(LISTING_ERROR)) notify.ok('Downloads list is back in sync');
        })
        .catch((error: Error) => {
          sync.abandon(fetchId);
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
      const change = sync.record((list) => [entry, ...list.filter((e) => e.id !== entry.id)]);
      setEntries((prev) => change(prev ?? []));
    };
    const remove = (payload: unknown) => {
      const entry = payload as DownloadEntry;
      const change = sync.record((list) => list.filter((e) => e.id !== entry.id));
      setEntries((prev) => change(prev ?? []));
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
