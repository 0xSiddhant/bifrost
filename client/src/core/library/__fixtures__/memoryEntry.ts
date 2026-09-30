import { compareItems } from '../paging';
import type { LibraryEntry, LibraryItem, LibraryKind } from '../types';

/**
 * A registry entry that answers `listPage` from memory, the way the paged
 * servers do (PLAN-31): filter by `q`/`author`, order by `(key, id)` both in
 * the requested direction, slice `offset..offset+limit`, and report the total
 * and the unfiltered author facet. `pageSize` stands in for LIST_PAGE_SIZE.
 */
export function memoryEntry(
  kind: LibraryKind,
  rows: LibraryItem[],
  overrides: Partial<LibraryEntry> = {},
  pageSize = 3,
): LibraryEntry & { calls: Array<{ offset: number; limit?: number; order: string }> } {
  const calls: Array<{ offset: number; limit?: number; order: string }> = [];
  return {
    kind,
    label: kind.toUpperCase(),
    module: kind,
    tone: 1,
    icon: null,
    events: [`${kind}.saved`, `${kind}.deleted`],
    noun: 'document',
    newRoute: `/${kind}`,
    newLabel: 'New',
    calls,
    listPage: (query, request) => {
      calls.push({ offset: request.offset, limit: request.limit, order: query.order });
      const needle = query.q?.toLowerCase();
      const matching = rows
        .filter((row) => !needle || row.name.toLowerCase().includes(needle))
        .filter((row) => !query.author || row.authorDeviceId === query.author)
        .sort((a, b) => compareItems(a, b, query.sort, query.order));
      const limit = Math.min(request.limit ?? pageSize, 100);
      return Promise.resolve({
        items: matching.slice(request.offset, request.offset + limit),
        total: matching.length,
        limit,
        offset: request.offset,
        authors: [
          ...new Set(rows.flatMap((row) => (row.authorDeviceId ? [row.authorDeviceId] : []))),
        ],
      });
    },
    remove: () => Promise.resolve(null),
    editorRoute: (item) => `/${kind}/${item.slug}`,
    ...overrides,
  };
}

export function doc(
  kind: LibraryKind,
  id: string,
  modifiedAt: number,
  extra: Partial<LibraryItem> = {},
): LibraryItem {
  return {
    kind,
    id,
    name: `${kind}-${id}`,
    slug: `${kind}-${id}`,
    authorDeviceId: 'device-a',
    sizeBytes: 10,
    createdAt: modifiedAt,
    modifiedAt,
    ...extra,
  };
}
