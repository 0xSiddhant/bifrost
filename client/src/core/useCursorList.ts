import { useCallback, useEffect, useRef, useState } from 'react';
import type { CursorListPage } from './api';
import { log } from './log';
import { bifrostEvents } from './sse';

export type CursorListStatus = 'loading' | 'idle' | 'loading-more' | 'error' | 'error-more';

export interface CursorListOptions<T, Q, P extends CursorListPage<T>> {
  /** The active filters. Must keep its identity while its content is unchanged. */
  query: Q;
  fetchPage: (
    query: Q,
    cursor: string | null,
    options: { signal: AbortSignal; limit?: number },
  ) => Promise<P>;
  keyOf: (item: T) => string;
  /** Does a live row pass the active filter? (Only ever used for SSE rows.) */
  matches: (item: T, query: Q) => boolean;
  /** The server's order for the active query: negative when `a` comes first. */
  compare: (a: T, b: T, query: Q) => number;
  /** Feature name for log lines. */
  module: string;
}

export interface CursorList<T, P> {
  items: T[];
  /** Rows matching the filters on the server, not just the ones loaded. */
  total: number;
  hasMore: boolean;
  status: CursorListStatus;
  /** The newest envelope — for facets like Accio's tags. */
  page: P | null;
  loadMore: () => void;
  /** Start over from the first batch (after a first-load failure). */
  reload: () => void;
  /**
   * A live row from SSE. `isNew` says the event can only mean a new row
   * (`accio.saved`); without it an unloaded row may be an edit, and its effect
   * on `total` is re-counted rather than guessed.
   */
  upsert: (item: T, isNew?: boolean) => void;
  remove: (key: string) => void;
}

const RECOUNT_DEBOUNCE_MS = 300;

/**
 * An infinitely scrolled, keyset-paged list kept live over SSE (PLAN-31) —
 * the shared engine behind Accio and Portkey.
 *
 * - One batch in flight at a time; a query change aborts it and starts over,
 *   so a slow answer for the old filter can never append into the new list.
 * - Rows are de-duplicated by key: a row whose sort key changed mid-scroll can
 *   cross the cursor and come back, and the copy already shown wins.
 * - A live insert is placed only where it provably belongs — it passes the
 *   filter and sorts inside the rows already loaded (or nothing is left to
 *   load). Anything else is left for the scroll to reach.
 * - When the effect on `total` cannot be derived locally (a delete of a row
 *   never loaded, an edit that may cross the filter), one debounced
 *   `limit=1` request re-counts it instead.
 * - An SSE reconnect re-counts and re-reads the first batch: rows added or
 *   changed while the stream was down appear. A row deleted during the outage
 *   stays until the next reload — closing that would mean refetching every
 *   loaded batch, which is stated rather than papered over.
 */
export function useCursorList<T, Q, P extends CursorListPage<T>>(
  options: CursorListOptions<T, Q, P>,
): CursorList<T, P> {
  const { query } = options;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<CursorListStatus>('loading');
  const [page, setPage] = useState<P | null>(null);
  const [generation, setGeneration] = useState(0);

  // Live state the callbacks read without re-subscribing.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const statusRef = useRef(status);
  statusRef.current = status;
  const controllerRef = useRef<AbortController | null>(null);
  const recountTimer = useRef<number | undefined>(undefined);

  const merge = useCallback((current: T[], incoming: readonly T[]): T[] => {
    const { keyOf } = optionsRef.current;
    const seen = new Set(current.map(keyOf));
    return [...current, ...incoming.filter((item) => !seen.has(keyOf(item)))];
  }, []);

  // First batch, whenever the query changes (or a reload is asked for).
  useEffect(() => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setStatus('loading');
    optionsRef.current
      .fetchPage(query, null, { signal: controller.signal })
      .then((first) => {
        if (controller.signal.aborted) return;
        setItems(merge([], first.items));
        setTotal(first.total);
        setCursor(first.nextCursor);
        setPage(first);
        setStatus('idle');
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setStatus('error');
        log.reportError(`${optionsRef.current.module}: first batch failed to load`, error, {
          module: optionsRef.current.module,
        });
      });
    return () => controller.abort();
  }, [query, generation, merge]);

  const loadMore = useCallback(() => {
    const next = cursorRef.current;
    // One batch in flight. After a failed batch only an explicit "Try again"
    // gets here (the sentinel stands down), so a dead server isn't hammered.
    const current = statusRef.current;
    if (!next || (current !== 'idle' && current !== 'error-more')) return;
    const controller = controllerRef.current ?? new AbortController();
    setStatus('loading-more');
    statusRef.current = 'loading-more';
    optionsRef.current
      .fetchPage(optionsRef.current.query, next, { signal: controller.signal })
      .then((batch) => {
        if (controller.signal.aborted) return;
        setItems((current) => merge(current, batch.items));
        setTotal(batch.total);
        setCursor(batch.nextCursor);
        setPage(batch);
        setStatus('idle');
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setStatus('error-more');
        log.reportError(`${optionsRef.current.module}: next batch failed to load`, error, {
          module: optionsRef.current.module,
        });
      });
  }, [merge]);

  const reload = useCallback(() => setGeneration((n) => n + 1), []);

  const recount = useCallback(() => {
    window.clearTimeout(recountTimer.current);
    recountTimer.current = window.setTimeout(() => {
      const controller = controllerRef.current;
      if (!controller) return;
      optionsRef.current
        .fetchPage(optionsRef.current.query, null, { signal: controller.signal, limit: 1 })
        .then((probe) => {
          if (!controller.signal.aborted) setTotal(probe.total);
        })
        .catch((error: unknown) => {
          // Cosmetic — the count reads one off until the next fetch — but a
          // count that silently stops updating is worth a line.
          if (!controller.signal.aborted) {
            log.warn(`${optionsRef.current.module}: re-count failed: ${String(error)}`, {
              module: optionsRef.current.module,
            });
          }
        });
    }, RECOUNT_DEBOUNCE_MS);
  }, []);

  /** Insert at the row's sorted position among the loaded rows, if it belongs there. */
  const place = useCallback((current: T[], item: T): T[] | null => {
    const { compare, query: active } = optionsRef.current;
    const index = current.findIndex((row) => compare(item, row, active) < 0);
    if (index !== -1) return [...current.slice(0, index), item, ...current.slice(index)];
    // Past the last loaded row: only certain when nothing is left to load.
    return cursorRef.current === null ? [...current, item] : null;
  }, []);

  const upsert = useCallback(
    (item: T, isNew = false) => {
      const { keyOf, matches, query: active } = optionsRef.current;
      const key = keyOf(item);
      const current = itemsRef.current;
      const index = current.findIndex((row) => keyOf(row) === key);
      const passes = matches(item, active);

      if (index !== -1) {
        // A loaded row keeps its position until the next fetch, even if its
        // sort key moved; one that left the filter goes.
        const next = passes
          ? current.map((row, at) => (at === index ? item : row))
          : current.filter((_, at) => at !== index);
        itemsRef.current = next;
        setItems(next);
        if (!passes) setTotal((n) => Math.max(0, n - 1));
        return;
      }

      if (!passes) {
        // A brand-new row outside the filter changes nothing; an edit might
        // have moved an unloaded row out of it.
        if (!isNew) recount();
        return;
      }
      const placed = place(current, item);
      if (placed) {
        itemsRef.current = placed;
        setItems(placed);
        setTotal((n) => n + 1);
      } else if (isNew) {
        setTotal((n) => n + 1);
      } else {
        recount();
      }
    },
    [place, recount],
  );

  const remove = useCallback(
    (key: string) => {
      const { keyOf } = optionsRef.current;
      const current = itemsRef.current;
      if (current.some((row) => keyOf(row) === key)) {
        const next = current.filter((row) => keyOf(row) !== key);
        itemsRef.current = next;
        setItems(next);
        setTotal((n) => Math.max(0, n - 1));
      } else {
        // A delete carries only a key: whether an unloaded row matched the
        // filter is unknowable here, so ask rather than guess.
        recount();
      }
    },
    [recount],
  );

  // An SSE reconnect is a change: re-read the first batch and upsert it.
  useEffect(() => {
    let dropped = false;
    const off = bifrostEvents.onStatus((next) => {
      if (next !== 'open') {
        dropped = true;
        return;
      }
      if (!dropped) return;
      dropped = false;
      const controller = controllerRef.current;
      if (!controller) return;
      optionsRef.current
        .fetchPage(optionsRef.current.query, null, { signal: controller.signal })
        .then((first) => {
          if (controller.signal.aborted) return;
          const { keyOf } = optionsRef.current;
          let next = itemsRef.current;
          for (const item of first.items) {
            const index = next.findIndex((row) => keyOf(row) === keyOf(item));
            if (index !== -1) next = next.map((row, at) => (at === index ? item : row));
            else next = place(next, item) ?? next;
          }
          itemsRef.current = next;
          setItems(next);
          setTotal(first.total);
          setPage(first);
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          log.warn(`${optionsRef.current.module}: reconnect re-read failed: ${String(error)}`, {
            module: optionsRef.current.module,
          });
        });
    });
    return () => {
      off();
      window.clearTimeout(recountTimer.current);
    };
  }, [place]);

  return {
    items,
    total,
    hasMore: cursor !== null,
    status,
    page,
    loadMore,
    reload,
    upsert,
    remove,
  };
}
