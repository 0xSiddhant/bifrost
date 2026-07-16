import { useEffect, useState } from 'react';
import { bifrostEvents } from '../../core/sse';
import { listPresence, type PresenceDevice } from './api';

/** Live device list: initial fetch, then replaced on each `presence.changed`. */
export function usePresence(): { devices: PresenceDevice[]; ready: boolean } {
  const [devices, setDevices] = useState<PresenceDevice[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listPresence()
      .then((res) => {
        if (!cancelled) {
          setDevices(res.devices);
          setReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) setReady(true);
      });

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
