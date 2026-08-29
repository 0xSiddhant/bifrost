import type { ReactNode } from 'react';

/**
 * The document kinds the Pensieve can list (PLAN-21). `groot` was named here
 * before PLAN-19 shipped it: the type is the contract the registry is written
 * against, and naming it ahead is what made Groot's arrival one array entry
 * rather than a type change plus a page. `atlas` (PLAN-23) is the fourth, and
 * cost exactly that — this line and one registry element.
 */
export type LibraryKind = 'runestone' | 'edda' | 'groot' | 'atlas';

/**
 * One saved document, whatever tool wrote it. The per-tool summaries
 * (`RunestoneSummary`, `EddaSummary`) are field-for-field identical, so this is
 * their shape plus the one thing they cannot carry: which tool owns the row.
 *
 * `id` is only unique **within a kind** — each tool mints its own 6-char handle
 * from its own table — so anything keyed on a document must use `kind` too.
 */
export interface LibraryItem {
  kind: LibraryKind;
  id: string;
  name: string;
  slug: string;
  authorDeviceId: string | null;
  sizeBytes: number;
  createdAt: number;
  modifiedAt: number;
}

export type LibrarySort = 'name' | 'created' | 'modified' | 'size';
export type LibraryOrder = 'asc' | 'desc';

/** What the page asks for; every kind's `list()` receives the same object. */
export interface LibraryQuery {
  q?: string;
  /** Exact deviceId — the UI maps a picked device name back to its id. */
  author?: string;
  sort: LibrarySort;
  order: LibraryOrder;
}

/**
 * A document type's entry in the registry. Everything the shell needs to list,
 * filter, sort, link and delete one kind lives here — so a fourth kind is one
 * more element of `LIBRARY_REGISTRY` and no change to the page at all.
 */
export interface LibraryEntry {
  kind: LibraryKind;
  /** Chip label. The **format**, not the tool: a person scanning the list is
   *  looking for "the YAML one", and the tool's name is on the row's link. */
  label: string;
  /** Capability module that must be loaded for this kind to exist at all. */
  module: string;
  /**
   * Card-palette slot for the badge, 1-based. Fixed per kind — a **scoped
   * exception** to the positional-colour rule in `rules/coding.md`, on the same
   * reasoning logged for Accio's hostname tile: the badge exists to make a type
   * recognisable while rows are being searched, filtered and re-sorted, which
   * only works if JSON keeps one colour as it moves up and down the list.
   */
  tone: number;
  icon: ReactNode;
  /** SSE events that mean "this kind's rows changed". */
  events: readonly string[];
  /** Noun for one document of this kind, used in the delete confirmation. */
  noun: string;
  /** Where "new one" goes, and what the button says. */
  newRoute: string;
  newLabel: string;
  list(query: LibraryQuery): Promise<LibraryItem[]>;
  remove(id: string): Promise<unknown>;
  /** The editor, opened by the row's name. */
  editorRoute(item: LibraryItem): string;
  /** The tool's public raw-data URL, if it publishes one (it opens in a tab). */
  apiRoute?(item: LibraryItem): string;
  /** A rendered read-only view, if the tool has one (Edda's preview page). */
  readRoute?(item: LibraryItem): string;
}
