import { AppError } from './http/index.js';

/**
 * Shared list paging (PLAN-31). Six modules page their lists and may not import
 * one another, so the limit clamp, the cursor codec and the envelope shapes
 * live here. Not under `core/http/`: usecases call the codec and the clamp, and
 * a usecase depending on an HTTP-layer file would point the wrong way.
 *
 * Paging is **opt-in** (`paged=true`). A request without it gets the bare array
 * it always did, with the old defaults — an installed `bifrost portkey ls` and
 * anyone's `curl` script must not silently start seeing 30 rows.
 */

export interface PagingConfig {
  /** Rows per page when the request names no `limit` (LIST_PAGE_SIZE). */
  pageSize: number;
  /** The largest `limit` a paged request may ask for (LIST_PAGE_MAX). */
  maxPageSize: number;
}

export type SortOrder = 'asc' | 'desc';

/** The requested page size, defaulted and clamped into `[1, maxPageSize]`. */
export function pageLimit(requested: number | undefined, paging: PagingConfig): number {
  const limit = requested ?? paging.pageSize;
  return Math.min(Math.max(Math.trunc(limit), 1), paging.maxPageSize);
}

/** Offset pages — the documents, where the Pensieve needs random access to page k. */
export interface DocumentListPage<T> {
  items: T[];
  /** Rows matching the current filters, across every page. */
  total: number;
  /** The page size the server actually used — the client never hardcodes one. */
  limit: number;
  offset: number;
  /** Every author over the kind's whole table, unfiltered (the dropdown's options). */
  authors: string[];
}

/** Keyset pages — Accio and Portkey, whose infinite scroll only ever asks "what's next". */
export interface CursorListPage<T> {
  items: T[];
  total: number;
  limit: number;
  /** Opaque; null when there is nothing after the last row. */
  nextCursor: string | null;
}

/** One sort key value exactly as SQLite compared it: a number or a (lowered) string. */
export type CursorKey = string | number;

/** Where a keyset page ends: the last row's sort key and unique id. */
export interface CursorPosition {
  key: CursorKey;
  id: string;
}

interface CursorPayload extends CursorPosition {
  sort: string;
  order: SortOrder;
}

const badCursor = (): AppError =>
  new AppError('cursor is invalid or belongs to another sort', 400, 'BAD_CURSOR');

/**
 * base64url JSON, opaque to the client. The sort and order it was minted under
 * travel inside it, so a cursor reused with a different sort is refused rather
 * than silently comparing a title against a timestamp.
 */
export function encodeCursor(sort: string, order: SortOrder, position: CursorPosition): string {
  const payload: CursorPayload = { sort, order, key: position.key, id: position.id };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * The position a cursor names, or `400 BAD_CURSOR` — never a silent restart
 * from the top, which would re-append rows the client already shows.
 *
 * `keyType` is what the sort compares: SQLite orders every number before every
 * string, so a string key under a timestamp sort would not fail — it would
 * quietly return the wrong rows. Checking it here makes that a 400 too.
 */
export function decodeCursor(
  raw: string,
  sort: string,
  order: SortOrder,
  keyType: 'number' | 'string',
): CursorPosition {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    // Garbage in a query string is ordinary validation control flow; the 400
    // below is the whole report (the route's own access log carries the URL).
    throw badCursor();
  }
  if (!parsed || typeof parsed !== 'object') throw badCursor();
  const payload = parsed as Partial<CursorPayload>;
  const keyOk =
    keyType === 'string'
      ? typeof payload.key === 'string'
      : typeof payload.key === 'number' && Number.isFinite(payload.key);
  if (!keyOk || typeof payload.id !== 'string' || payload.id.length === 0) throw badCursor();
  if (payload.sort !== sort || payload.order !== order) throw badCursor();
  return { key: payload.key as CursorKey, id: payload.id };
}

/**
 * Query-string properties every paged route adds to its schema. Fastify's ajv
 * coerces `paged=true` to a boolean (proved by the routes' integration tests).
 * `cursor` is capped: a legitimate one is a short JSON object, and nothing
 * longer is worth decoding.
 */
export const pagedQueryProperties = {
  paged: { type: 'boolean' },
  cursor: { type: 'string', maxLength: 512 },
} as const;

/**
 * Response schema of a `DocumentListPage<T>` (PLAN-32). Properties are in the
 * order the usecases build the envelope — the serializer writes schema order,
 * and the contract guard holds it to the handler's bytes.
 */
export function documentListPageSchema<const Item extends object>(item: Item) {
  return {
    type: 'object',
    required: ['items', 'total', 'limit', 'offset', 'authors'],
    properties: {
      items: { type: 'array', items: item },
      total: { type: 'integer', description: 'Rows matching the filters, across every page' },
      limit: { type: 'integer', description: 'The page size the server used' },
      offset: { type: 'integer' },
      authors: {
        type: 'array',
        items: { type: 'string' },
        description: "Every author device id over the kind's whole table, unfiltered",
      },
    },
  } as const;
}

/**
 * Response schema of a `CursorListPage<T>`, plus a module's own extras
 * (Accio's `tags`), which its usecase appends after `nextCursor`.
 */
export function cursorListPageSchema<
  const Item extends object,
  const Extra extends Record<string, object> = Record<never, never>,
>(item: Item, extra: Extra = {} as Extra) {
  return {
    type: 'object',
    required: [
      'items',
      'total',
      'limit',
      'nextCursor',
      ...(Object.keys(extra) as Array<keyof Extra & string>),
    ],
    properties: {
      items: { type: 'array', items: item },
      total: { type: 'integer', description: 'Rows matching the filters, across every page' },
      limit: { type: 'integer', description: 'The page size the server used' },
      nextCursor: {
        type: ['string', 'null'],
        description: 'Opaque; null when there is nothing after the last row',
      },
      ...extra,
    },
  } as const;
}
