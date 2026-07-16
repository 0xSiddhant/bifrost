import { useEffect, useState } from 'react';
import { bifrostEvents } from '../../core/sse';
import { onDevicesChange } from '../../core/devices';
import { listClipboard, type ClipboardChange, type ClipboardEntry } from './api';

/** Live clipboard board: initial fetch, then apply `clipboard.updated` deltas. */
export function useClipboard(): { entries: ClipboardEntry[]; ready: boolean } {
  const [entries, setEntries] = useState<ClipboardEntry[]>([]);
  const [ready, setReady] = useState(false);
  // Re-render when device names resolve so attributions fill in.
  const [, force] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listClipboard()
      .then((list) => {
        if (!cancelled) {
          setEntries(list);
          setReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) setReady(true);
      });

    const offSse = bifrostEvents.on('clipboard.updated', (payload) => {
      const change = payload as ClipboardChange;
      setEntries((prev) => {
        if (change.action === 'add') {
          return prev.some((e) => e.id === change.entry.id) ? prev : [change.entry, ...prev];
        }
        return prev.filter((e) => e.id !== change.id);
      });
    });
    const offDevices = onDevicesChange(() => force((n) => n + 1));

    return () => {
      cancelled = true;
      offSse();
      offDevices();
    };
  }, []);

  return { entries, ready };
}
