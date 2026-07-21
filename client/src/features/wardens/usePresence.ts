import { useEffect, useState } from 'react';
import { bifrostEvents } from '../../core/sse';
import { listPresence, prunePresence, type PresenceDevice } from './api';

/**
 * Live device list: an on-mount prune (drops devices offline > 7 days) seeds
 * the roster, which is then replaced on each `presence.changed`. The prune is
 * best-effort — if it's unavailable, fall back to the plain list so the roster
 * never blanks out.
 */
export function usePresence(): { devices: PresenceDevice[]; ready: boolean } {
  const [devices, setDevices] = useState<PresenceDevice[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const seed = (list: PresenceDevice[]) => {
      if (!cancelled) {
        setDevices(list);
        setReady(true);
      }
    };
    prunePresence()
      .then((res) => seed(res.devices))
      .catch(() =>
        listPresence()
          .then((res) => seed(res.devices))
          .catch(() => {
            if (!cancelled) setReady(true);
          }),
      );

    const off = bifrostEvents.on('presence.changed', (payload) => {
      if (payload && typeof payload === 'object' && 'devices' in payload) {
        setDevices((payload as { devices: PresenceDevice[] }).devices);
      }
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  return { devices, ready };
}
