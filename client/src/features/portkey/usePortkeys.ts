import { useEffect, useState } from 'react';
import { bifrostEvents } from '../../core/sse';
import { listPortkeys, type Portkey } from './api';

/**
 * The go-links list, kept live. One fetch, then SSE deltas — a link created on
 * a phone shows up here without a refetch, and a redirect elsewhere bumps the
 * hit count/last-used within a heartbeat (acceptance criterion 4). Hit updates
 * ride the same `portkey.saved` event a create/edit does.
 */
export function usePortkeys(): { links: Portkey[]; ready: boolean; error: boolean } {
  const [links, setLinks] = useState<Portkey[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    listPortkeys()
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

    const upsert = (link: Portkey) =>
      setLinks((rows) => {
        const index = rows.findIndex((row) => row.slug === link.slug);
        if (index === -1) return [link, ...rows];
        const next = [...rows];
        next[index] = link;
        return next;
      });

    const offs = [
      bifrostEvents.on('portkey.saved', (payload) => {
        const link = (payload as { portkey?: Portkey }).portkey;
        if (link) upsert(link);
      }),
      // A redirect elsewhere bumped this row's hit count / last-used.
      bifrostEvents.on('portkey.hit', (payload) => {
        const link = (payload as { portkey?: Portkey }).portkey;
        if (link) upsert(link);
      }),
      bifrostEvents.on('portkey.deleted', (payload) => {
        const { slug } = payload as { slug?: string };
        if (slug) setLinks((rows) => rows.filter((row) => row.slug !== slug));
      }),
    ];

    return () => {
      cancelled = true;
      for (const off of offs) off();
    };
  }, []);

  return { links, ready, error };
}
