import { useEffect, useMemo } from 'react';
import { listLinksPage, type AccioLink, type AccioListPage } from '../../core/accio';
import { bifrostEvents } from '../../core/sse';
import { useCursorList, type CursorList } from '../../core/useCursorList';
import { SHELF_SORTS, compareLinks, linkMatches, unionTags, type ShelfSort } from './shelf';

export interface ShelfQuery {
  q: string;
  tag: string | null;
  sort: ShelfSort;
}

interface PagedShelfQuery {
  q?: string;
  tag?: string;
  sort: 'created' | 'title';
  order: 'asc' | 'desc';
  shelf: ShelfQuery;
}

export interface Shelf extends CursorList<AccioLink, AccioListPage> {
  /** Every tag on the shelf — the server's facet plus any a live save added. */
  tags: string[];
}

/**
 * The shelf, paged and kept live (PLAN-31). Search, tag filter and sort run on
 * the server — a link past row 500 used to be unfindable, because the browser
 * only ever held 500 — and batches arrive as the reader scrolls. SSE deltas
 * still land without a refetch: a save from a phone appears at the top, and
 * `accio.updated` fills an enriched title in seconds after the row appeared.
 */
export function useShelf(filter: ShelfQuery): Shelf {
  const { q, tag, sort } = filter;
  const query = useMemo<PagedShelfQuery>(
    () => ({
      q: q.trim() || undefined,
      tag: tag ?? undefined,
      ...SHELF_SORTS[sort],
      shelf: { q, tag, sort },
    }),
    [q, tag, sort],
  );

  const list = useCursorList<AccioLink, PagedShelfQuery, AccioListPage>({
    query,
    fetchPage: (active, cursor, options) => listLinksPage(active, cursor, options),
    keyOf: (link) => link.id,
    matches: (link, active) => linkMatches(link, active.shelf),
    compare: (a, b, active) => compareLinks(a, b, active.shelf.sort),
    module: 'accio',
  });

  const { upsert, remove } = list;
  useEffect(() => {
    const offs = [
      // `accio.saved` only ever means a new row.
      bifrostEvents.on('accio.saved', (payload) => {
        const link = (payload as { link?: AccioLink }).link;
        if (link) upsert(link, true);
      }),
      bifrostEvents.on('accio.updated', (payload) => {
        const link = (payload as { link?: AccioLink }).link;
        if (link) upsert(link);
      }),
      bifrostEvents.on('accio.deleted', (payload) => {
        const { id } = payload as { id?: string };
        if (id) remove(id);
      }),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, [upsert, remove]);

  const facet = list.page?.tags;
  const tags = useMemo(() => unionTags(facet ?? [], list.items), [facet, list.items]);
  return { ...list, tags };
}
