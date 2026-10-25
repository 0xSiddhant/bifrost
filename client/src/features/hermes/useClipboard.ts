import { useEffect, useState } from 'react';
import { bifrostEvents } from '../../core/sse';
import { onDevicesChange } from '../../core/devices';
import { LiveListSync } from '../../core/liveList';
import { listClipboard, type ClipboardChange, type ClipboardEntry } from './api';

/** Live clipboard board: initial fetch, then apply `clipboard.updated` deltas. */
export function useClipboard(): { entries: ClipboardEntry[]; ready: boolean } {
  const [entries, setEntries] = useState<ClipboardEntry[]>([]);
  const [ready, setReady] = useState(false);
  // Re-render when device names resolve so attributions fill in.
  const [, force] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // The first fetch's answer must not wipe a clip posted while it was in
    // flight — see core/liveList.
    const sync = new LiveListSync<ClipboardEntry>();
    const fetchId = sync.begin();
    listClipboard()
      .then((list) => {
        if (cancelled) return;
        const merged = sync.settle(fetchId, list);
        if (merged) setEntries(merged);
        setReady(true);
      })
      .catch(() => {
        // The board shows what live events bring, and says it is empty
        // otherwise — the same as before this fetch existed.
        sync.abandon(fetchId);
        if (!cancelled) setReady(true);
      });

    const offSse = bifrostEvents.on('clipboard.updated', (payload) => {
      const change = payload as ClipboardChange;
      const apply = sync.record((list) => {
        if (change.action === 'add') {
          return list.some((e) => e.id === change.entry.id) ? list : [change.entry, ...list];
        }
        return list.filter((e) => e.id !== change.id);
      });
      setEntries(apply);
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
