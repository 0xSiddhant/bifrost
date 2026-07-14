import { useEffect, useState } from 'react';
import { bifrostEvents, type SseStatus } from '../../core/sse';
import { listDownloads, type DownloadEntry } from './api';

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
          if (!disposed) setEntries(list);
        })
        .catch(() => {
          // Offline banner already tells the story; keep the stale list visible.
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
