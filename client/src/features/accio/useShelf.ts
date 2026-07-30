import { useEffect, useState } from 'react';
import { listLinks, type AccioLink } from '../../core/accio';
import { bifrostEvents } from '../../core/sse';

/**
 * The shelf, kept live. One fetch of the whole shelf, then SSE deltas — a save
 * from a phone shows up here without a refetch (acceptance criterion 1), and
 * `accio.updated` is what carries an enriched title in seconds after the row
 * first appeared.
 */
export function useShelf(): { links: AccioLink[]; ready: boolean; error: boolean } {
  const [links, setLinks] = useState<AccioLink[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    listLinks({ limit: 500 })
      .then((rows) => {
        if (cancelled) return;
        setLinks(rows);
        setReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
        setReady(true);
      });

    const upsert = (link: AccioLink) =>
      setLinks((rows) => {
        const index = rows.findIndex((row) => row.id === link.id);
        if (index === -1) return [link, ...rows];
        const next = [...rows];
        next[index] = link;
        return next;
      });

    const offs = [
      bifrostEvents.on('accio.saved', (payload) => {
        const link = (payload as { link?: AccioLink }).link;
        if (link) upsert(link);
      }),
      bifrostEvents.on('accio.updated', (payload) => {
        const link = (payload as { link?: AccioLink }).link;
        if (link) upsert(link);
      }),
      bifrostEvents.on('accio.deleted', (payload) => {
        const { id } = payload as { id?: string };
        if (id) setLinks((rows) => rows.filter((row) => row.id !== id));
      }),
    ];

    return () => {
      cancelled = true;
      for (const off of offs) off();
    };
  }, []);

  return { links, ready, error };
}
