import { useEffect, useMemo } from 'react';
import type { CursorListPage } from '../../core/api';
import { bifrostEvents } from '../../core/sse';
import { useCursorList, type CursorList } from '../../core/useCursorList';
import { listPortkeysPage, type Portkey } from './api';

interface PortkeyQuery {
  q: string;
}

/** Does a live row pass the search? Slug, target and note, case-insensitively. */
export function portkeyMatches(link: Portkey, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return (
    link.slug.includes(needle) ||
    link.url.toLowerCase().includes(needle) ||
    (link.note ?? '').toLowerCase().includes(needle)
  );
}

/** The server's paged order: newest first, then slug, both descending. */
export function comparePortkeys(a: Portkey, b: Portkey): number {
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
  if (a.slug === b.slug) return 0;
  return a.slug < b.slug ? 1 : -1;
}

/**
 * The go-links list, paged and kept live (PLAN-31). The server searches and
 * pages; SSE deltas still land without a refetch — a link created on a phone
 * appears at the top, and a redirect elsewhere bumps a loaded row's hit count
 * within a heartbeat. `portkey.saved` means create **or** edit, so an unloaded
 * slug is never assumed new: the hook re-counts rather than guess.
 */
export function usePortkeys(q: string): CursorList<Portkey, CursorListPage<Portkey>> {
  const query = useMemo<PortkeyQuery>(() => ({ q }), [q]);
  const list = useCursorList<Portkey, PortkeyQuery, CursorListPage<Portkey>>({
    query,
    fetchPage: (active, cursor, options) =>
      listPortkeysPage(active.q.trim() || undefined, cursor, options),
    keyOf: (link) => link.slug,
    matches: (link, active) => portkeyMatches(link, active.q),
    compare: (a, b) => comparePortkeys(a, b),
    module: 'portkey',
  });

  const { upsert, remove } = list;
  useEffect(() => {
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
        if (slug) remove(slug);
      }),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, [upsert, remove]);

  return list;
}
