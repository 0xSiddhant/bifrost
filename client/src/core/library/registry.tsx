import { deleteAtlas, listAtlases } from '../atlas';
import { deleteEdda, listEddas } from '../edda';
import { deleteGroot, listGroots } from '../groot';
import { deleteRunestone, listRunestones } from '../runestone';
import { BracesIcon, DocFileIcon, GlobeIcon, TreeIcon } from '../ui/icons';
import type { LibraryEntry, LibraryItem, LibraryKind, LibraryQuery } from './types';

/**
 * The document-kind registry behind the Pensieve (PLAN-21).
 *
 * Before this existed, Runestone and Edda each had their own library page with
 * the same six pieces of state, the same SSE effect, the same four sorts and
 * the same rows — and `EddaLibraryPage` reused Runestone's `rune-lib-*` CSS,
 * which is the codebase admitting they were one page twice. A third document
 * type would have been a third copy. Now it is one element of this array.
 *
 * The per-tool API clients (`core/runestone.ts`, `core/edda.ts`, and later
 * `core/groot.ts`) are untouched — each owns its own endpoints and is used by
 * its own editor. This adapts them; it does not replace them.
 */

/** Both clients return the shared summary shape; only `kind` has to be added. */
function tag<T extends Omit<LibraryItem, 'kind'>>(kind: LibraryKind, rows: T[]): LibraryItem[] {
  return rows.map((row) => ({
    kind,
    id: row.id,
    name: row.name,
    slug: row.slug,
    authorDeviceId: row.authorDeviceId,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt,
    modifiedAt: row.modifiedAt,
  }));
}

const runestoneEntry: LibraryEntry = {
  kind: 'runestone',
  label: 'JSON',
  module: 'runestone',
  tone: 1,
  icon: <BracesIcon size={14} />,
  events: ['runestone.saved', 'runestone.deleted'],
  noun: 'stone',
  newRoute: '/runestone',
  newLabel: 'Carve a new one',
  list: (query: LibraryQuery) => listRunestones(query).then((rows) => tag('runestone', rows)),
  remove: (id: string) => deleteRunestone(id),
  editorRoute: (item) => `/runestone/${item.slug}`,
  apiRoute: (item) => `/runestone/api/${item.slug}`,
};

const eddaEntry: LibraryEntry = {
  kind: 'edda',
  label: 'Markdown',
  module: 'edda',
  tone: 2,
  icon: <DocFileIcon size={14} />,
  events: ['edda.saved', 'edda.deleted'],
  noun: 'manuscript',
  newRoute: '/edda',
  newLabel: 'Write a new one',
  list: (query: LibraryQuery) => listEddas(query).then((rows) => tag('edda', rows)),
  remove: (id: string) => deleteEdda(id),
  editorRoute: (item) => `/edda/${item.slug}`,
  apiRoute: (item) => `/edda/api/${item.slug}`,
  readRoute: (item) => `/edda/preview/${item.slug}`,
};

const grootEntry: LibraryEntry = {
  kind: 'groot',
  label: 'YAML',
  module: 'groot',
  tone: 3,
  icon: <TreeIcon size={14} />,
  events: ['groot.saved', 'groot.deleted'],
  noun: 'document',
  newRoute: '/groot',
  newLabel: 'Grow a new one',
  list: (query: LibraryQuery) => listGroots(query).then((rows) => tag('groot', rows)),
  remove: (id: string) => deleteGroot(id),
  editorRoute: (item) => `/groot/${item.slug}`,
  apiRoute: (item) => `/groot/api/${item.slug}`,
};

const atlasEntry: LibraryEntry = {
  kind: 'atlas',
  label: 'XML',
  module: 'atlas',
  // Fixed per kind, not per position (see `LibraryEntry.tone`). Picked after
  // reading what the other three already hold — 1, 2 and 3 — so the badge is
  // visibly its own colour beside them.
  tone: 4,
  icon: <GlobeIcon size={14} />,
  events: ['atlas.saved', 'atlas.deleted'],
  noun: 'chart',
  newRoute: '/atlas',
  newLabel: 'Chart a new one',
  list: (query: LibraryQuery) => listAtlases(query).then((rows) => tag('atlas', rows)),
  remove: (id: string) => deleteAtlas(id),
  editorRoute: (item) => `/atlas/${item.slug}`,
  apiRoute: (item) => `/atlas/api/${item.slug}`,
};

/**
 * Order decides the chip order and the pre-sort merge order, nothing else —
 * badge colour comes from each entry's own `tone`, deliberately not from
 * position (see `LibraryEntry.tone`).
 *
 * **Groot's arrival (PLAN-19) was the return on this registry**: it is the one
 * element below, and the page, the chips, the filters, the SSE subscriptions
 * and the delete flow needed no change at all — which is what the fake-kind
 * test in `load.test.ts` had been pinning all along. **Atlas (PLAN-23) is the
 * second time it paid**, on the same terms.
 */
export const LIBRARY_REGISTRY: readonly LibraryEntry[] = [
  runestoneEntry,
  eddaEntry,
  grootEntry,
  atlasEntry,
];

/** The kinds this deploy profile actually serves. */
export function availableKinds(
  registry: readonly LibraryEntry[],
  hasModule: (module: string) => boolean,
): LibraryEntry[] {
  return registry.filter((entry) => hasModule(entry.module));
}

/** Look one up — rows carry a kind, and the row needs its entry to render. */
export function entryFor(
  registry: readonly LibraryEntry[],
  kind: LibraryKind,
): LibraryEntry | undefined {
  return registry.find((entry) => entry.kind === kind);
}
