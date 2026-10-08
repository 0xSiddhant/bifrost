import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { bifrostEvents } from '../../core/sse';
import { copyText } from '../../core/copy';
import { deviceName, onDevicesChange } from '../../core/devices';
import { formatBytes, formatTimeAgo } from '../../core/format';
import { log } from '../../core/log';
import { hasFeature } from '../../core/features';
import { Button } from '../../core/ui/Button';
import { Card } from '../../core/ui/Card';
import { EmptyState } from '../../core/ui/EmptyState';
import { Pager, usePagerFloats } from '../../core/ui/Pager';
import { cardToneClass } from '../../core/ui/cardTone';
import {
  BookmarkIcon,
  CheckIcon,
  ClipboardIcon,
  CloseIcon,
  EyeIcon,
  SearchIcon,
  SlidesIcon,
} from '../../core/ui/icons';
import {
  LIBRARY_REGISTRY,
  LibraryPager,
  availableKinds,
  buildCurlCommand,
  entryFor,
  parsePageParam,
  type LibraryEntry,
  type LibraryItem,
  type LibraryKind,
  type LibraryOrder,
  type LibraryPageView,
  type LibraryQuery,
  type LibrarySort,
} from '../../core/library';

/** The device that saved it, by PLAN-06 display rules (alias-first). */
function authorDisplay(deviceId: string | null): string {
  if (!deviceId) return 'unknown device';
  return deviceName(deviceId) ?? 'departed device';
}

const REFRESH_DEBOUNCE_MS = 200;

/** The rows' top edge, brought into view after a page change. */
function scrollListIntoView(node: HTMLElement | null): void {
  const reduced =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  node?.scrollIntoView?.({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
}

/**
 * The Pensieve — one library over every saved document (PLAN-21), paged
 * (PLAN-31).
 *
 * It lives in `app/pages/` rather than a feature because it is a shell across
 * several features and may not import any of them; everything worth testing
 * (the registry, the merge, the page walk) is in `core/library/`, where it runs
 * without a DOM. It needs no capability of its own: it renders when at least
 * one document kind is present, and the registry decides which.
 *
 * The page number lives in `?page=` beside `?type=`, so a page is linkable and
 * Back returns to the previous one. Changing a filter drops it.
 */
export function PensievePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const [view, setView] = useState<LibraryPageView | null>(null);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [q, setQ] = useState('');
  const [author, setAuthor] = useState('');
  const [sort, setSort] = useState<LibrarySort>('modified');
  const [order, setOrder] = useState<LibraryOrder>('desc');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Bumped by Retry: a fresh pager over every kind, the failed one included.
  const [attempt, setAttempt] = useState(0);
  const [, forceRender] = useState(0);
  // Which row's curl command was just copied — same shape as Portkey's own
  // copy-link feedback (an icon swap, not a global toast: this is a routine,
  // per-row affordance, not an event worth a notification).
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const floats = usePagerFloats();
  const listTopRef = useRef<HTMLDivElement>(null);

  const copyCurl = async (entry: LibraryEntry, item: LibraryItem) => {
    const command = buildCurlCommand(entry, item, window.location.origin);
    if (!command) return;
    const key = `${item.kind}:${item.id}`;
    if (await copyText(command)) {
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1500);
    }
  };

  // The "Present" action is gated on Saga's own feature, not on the row's kind:
  // an entry carries a `presentRoute` because its documents *can* be presented,
  // and whether the viewer can is a separate question (PLAN-28).
  const canPresent = hasFeature('saga');
  // The build's feature list is fixed (PLAN-35), so the kinds never change.
  const kinds = useMemo(() => availableKinds(LIBRARY_REGISTRY, hasFeature), []);

  // The open filter lives in the URL, so a chip is linkable and Back restores
  // the previous one. An unknown or disabled kind reads as All.
  const typeParam = searchParams.get('type');
  const activeKind = kinds?.some((entry) => entry.kind === typeParam)
    ? (typeParam as LibraryKind)
    : null;
  const pageParam = parsePageParam(searchParams.get('page'));

  // The type chip decides which kinds are *fetched* (PLAN-31). Applying it
  // client-side would turn a page of 30 into however many of those 30 matched.
  const fetched = useMemo(
    () => (kinds ? kinds.filter((entry) => !activeKind || entry.kind === activeKind) : null),
    [kinds, activeKind],
  );

  // Debounced so typing in the search box is one walk, not one per letter.
  // An equal query keeps the same object, so the pager (and the page it has
  // already built) survives a debounce that changed nothing.
  const [query, setQuery] = useState<LibraryQuery>({
    q: undefined,
    author: undefined,
    sort,
    order,
  });
  useEffect(() => {
    const next: LibraryQuery = {
      q: q.trim() || undefined,
      author: author || undefined,
      sort,
      order,
    };
    const timer = window.setTimeout(
      () =>
        setQuery((current) =>
          current.q === next.q &&
          current.author === next.author &&
          current.sort === next.sort &&
          current.order === next.order
            ? current
            : next,
        ),
      REFRESH_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [q, author, sort, order]);

  // One pager per kind set and query: it owns the boundary cache for exactly
  // that list, so a new filter can never reuse another list's offsets.
  // `attempt` is read so Retry — "the same list, again" — builds a fresh pager
  // over every kind, the one that failed included.
  const pager = useMemo(
    () => (fetched && attempt >= 0 ? new LibraryPager(fetched, query) : null),
    [fetched, query, attempt],
  );

  /** Write `?page=` (page 1 is the bare URL); a clamp or an invalid value replaces. */
  // `setSearchParams` changes identity with every location change; read
  // through a ref, `setPageParam` (and `show`, and the SSE subscriptions that
  // depend on it) stay put across page changes instead of re-subscribing — and
  // cancelling a pending page-1 refresh — on every click.
  const setSearchParamsRef = useRef(setSearchParams);
  setSearchParamsRef.current = setSearchParams;
  const setPageParam = useCallback((page: number, replace: boolean) => {
    setSearchParamsRef.current(
      (current) => {
        const next = new URLSearchParams(current);
        if (page > 1) next.set('page', String(page));
        else next.delete('page');
        return next;
      },
      { replace },
    );
  }, []);

  // Read by `show`, which outlives the render it was created in.
  const searchRef = useRef(searchParams);
  searchRef.current = searchParams;

  // Only the newest request may paint; a slow answer for an old page is dropped.
  const sequence = useRef(0);
  const shown = useRef<{ pager: LibraryPager | null; page: number }>({ pager: null, page: 0 });
  const show = useCallback(
    async (target: LibraryPager, build: () => Promise<LibraryPageView>) => {
      const token = ++sequence.current;
      setBusy(true);
      try {
        const next = await build();
        if (token !== sequence.current) return;
        shown.current = { pager: target, page: next.page };
        setView(next);
        setBusy(false);
        const raw = searchRef.current.get('page');
        const canonical = next.page > 1 ? String(next.page) : null;
        if (raw !== canonical) setPageParam(next.page, true);
      } catch (error) {
        // `LibraryPager` already turns a failed kind into a Retry strip; this
        // is anything else going wrong mid-walk, which must not be silent.
        if (token === sequence.current) setBusy(false);
        log.reportError('pensieve page failed to build', error, { module: 'pensieve' });
      }
    },
    [setPageParam],
  );

  // Build whichever page the URL names, whenever the list or the page changes.
  const firstPaint = useRef(true);
  useEffect(() => {
    if (!pager) return;
    if (shown.current.pager === pager && shown.current.page === pageParam) return;
    setStale(false);
    void show(pager, () => pager.page(pageParam));
    if (firstPaint.current) firstPaint.current = false;
    else scrollListIntoView(listTopRef.current);
  }, [pager, pageParam, show]);

  // Live updates (PLAN-31). Page 1 starts at zero in every kind, so it can
  // always be refetched exactly. Any other page cannot place a change without
  // knowing where it landed, so the rows stay put and a chip offers Refresh.
  const pageRef = useRef(pageParam);
  pageRef.current = view?.page ?? pageParam;
  // The page the reader *asked for*, which leads the one shown while a walk is
  // in flight: a change arriving just after a click to page 2 must not refetch
  // page 1 over it (and bounce the URL back).
  const requestedRef = useRef(pageParam);
  requestedRef.current = pageParam;
  // Our own delete comes back over SSE too; its echo must not raise the chip.
  const ownDeletes = useRef(new Set<string>());
  useEffect(() => {
    if (!fetched || !pager) return;
    let timer: number | undefined;
    const changed = () => {
      pager.invalidate();
      if (requestedRef.current === 1 && pageRef.current === 1) {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => void show(pager, () => pager.page(1)), REFRESH_DEBOUNCE_MS);
      } else {
        setStale(true);
      }
    };
    const offs = fetched.flatMap((entry) =>
      entry.events.map((event) =>
        bifrostEvents.on(event, (payload) => {
          const id = (payload as { id?: unknown } | null)?.id;
          const key = `${entry.kind}:${String(id)}`;
          if (event.endsWith('.deleted') && ownDeletes.current.delete(key)) return;
          changed();
        }),
      ),
    );
    // A reconnect is a change: events may have been missed while it was down.
    let dropped = false;
    const offStatus = bifrostEvents.onStatus((status) => {
      if (status !== 'open') {
        dropped = true;
        return;
      }
      if (dropped) changed();
      dropped = false;
    });
    const offDevices = onDevicesChange(() => forceRender((n) => n + 1));
    return () => {
      window.clearTimeout(timer);
      for (const off of offs) off();
      offStatus();
      offDevices();
    };
  }, [fetched, pager, show]);

  /** A filter change starts over at page 1 — replacing, not pushing, history. */
  const dropPage = () => {
    if (searchParams.has('page')) setPageParam(1, true);
  };

  const setKind = (kind: LibraryKind | null) => {
    const next = new URLSearchParams(searchParams);
    if (kind) next.set('type', kind);
    else next.delete('type');
    next.delete('page');
    setSearchParams(next);
  };

  const refresh = () => {
    if (!pager) return;
    pager.invalidate();
    setStale(false);
    void show(pager, () => pager.page(pageRef.current));
  };

  const remove = async (item: LibraryItem, entry: LibraryEntry) => {
    if (!window.confirm(`Delete "${item.name}"? This cannot be undone.`)) return;
    const key = `${item.kind}:${item.id}`;
    ownDeletes.current.add(key);
    try {
      await entry.remove(item.id);
      setDeleteError(null);
    } catch {
      ownDeletes.current.delete(key);
      setDeleteError(`Could not delete that ${entry.noun} — it may already be gone.`);
      return;
    }
    // This page's own start is still exact (the deleted row sat after it), so
    // it refetches in place and the next row is pulled up.
    if (pager) await show(pager, () => pager.refreshAfterDelete(pageRef.current));
  };

  const hrefFor = (page: number) => {
    const next = new URLSearchParams(searchParams);
    if (page > 1) next.set('page', String(page));
    else next.delete('page');
    const search = next.toString();
    return `${location.pathname}${search ? `?${search}` : ''}`;
  };

  const rows = view?.rows ?? null;
  const failed = view?.failed ?? [];
  // The facet is unfiltered, and the current selection always stays an option,
  // so the control never shows a value it does not list.
  const authorOptions = [...new Set([...(view?.authors ?? []), ...(author ? [author] : [])])];
  const filtering = Boolean(q || author || activeKind);
  const hasPages = (view?.pageCount ?? 1) > 1;
  // With one kind the "new one" button can be that kind's; with several the
  // page will not guess, and each editor is a click away from its own card.
  const soleKind = kinds?.length === 1 ? kinds[0] : undefined;

  return (
    <>
      <div className="page-head lib-head">
        <div>
          <span className="eyebrow eyebrow--violet">the pensieve · every thought kept</span>
          <h2>Pensieve</h2>
          <p>The basin keeps every saved document, from every device on the bridge.</p>
        </div>
        {soleKind && (
          <div className="rune-head-actions">
            <Button onClick={() => void navigate(soleKind.newRoute)}>{soleKind.newLabel}</Button>
          </div>
        )}
      </div>

      <div className="stack lib-wrap">
        <Card>
          <div className="lib-filters">
            <label className="lib-search">
              <SearchIcon size={16} />
              <input
                className="field__input"
                placeholder="Search by name…"
                value={q}
                onChange={(event) => {
                  setQ(event.target.value);
                  dropPage();
                }}
              />
            </label>
            <select
              className="field__input lib-select"
              value={author}
              aria-label="Filter by device"
              onChange={(event) => {
                setAuthor(event.target.value);
                dropPage();
              }}
            >
              <option value="">Every device</option>
              {authorOptions.map((id) => (
                <option key={id} value={id}>
                  {authorDisplay(id)}
                </option>
              ))}
            </select>
            <select
              className="field__input lib-select"
              value={sort}
              aria-label="Sort by"
              onChange={(event) => {
                setSort(event.target.value as LibrarySort);
                dropPage();
              }}
            >
              <option value="modified">Last modified</option>
              <option value="created">Created</option>
              <option value="name">Name</option>
              <option value="size">Size</option>
            </select>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Flip sort order"
              onClick={() => {
                setOrder((current) => (current === 'asc' ? 'desc' : 'asc'));
                dropPage();
              }}
            >
              {order === 'asc' ? '↑' : '↓'}
            </Button>
          </div>

          {/* Type chips. One kind means no chips at all — a filter with a single
              option is decoration. */}
          {kinds && kinds.length > 1 && (
            <div className="lib-chips" role="group" aria-label="Filter by type">
              <button
                type="button"
                className={activeKind === null ? 'lib-chip lib-chip--on' : 'lib-chip'}
                aria-pressed={activeKind === null}
                onClick={() => setKind(null)}
              >
                All
              </button>
              {kinds.map((entry) => (
                <button
                  key={entry.kind}
                  type="button"
                  className={
                    activeKind === entry.kind
                      ? `lib-chip lib-chip--on ${cardToneClass(entry.tone)}`
                      : `lib-chip ${cardToneClass(entry.tone)}`
                  }
                  aria-pressed={activeKind === entry.kind}
                  disabled={failed.includes(entry.kind)}
                  onClick={() => setKind(entry.kind)}
                >
                  {entry.icon}
                  {entry.label}
                </button>
              ))}
            </div>
          )}

          {/* One strip per kind that is down. Non-blocking on purpose: the
              kinds that answered are already rendered below it (criterion 6). */}
          {failed.map((kind) => {
            const entry = entryFor(LIBRARY_REGISTRY, kind);
            if (!entry) return null;
            return (
              <div className="lib-failed" role="status" key={kind}>
                <span>{entry.label} documents couldn’t be loaded.</span>
                <Button variant="ghost" size="sm" onClick={() => setAttempt((n) => n + 1)}>
                  Retry
                </Button>
              </div>
            );
          })}

          {deleteError && (
            <p className="caption" role="alert" style={{ color: 'var(--danger)' }}>
              {deleteError}
            </p>
          )}

          <div className="lib-status" ref={listTopRef}>
            {view && view.total > 0 && (
              <span aria-live="polite">
                Showing {view.from}–{view.to} of {view.total}
              </span>
            )}
            {stale && (
              <span className="lib-stale" role="status">
                The library changed
                <Button variant="ghost" size="sm" onClick={refresh}>
                  Refresh
                </Button>
              </span>
            )}
          </div>

          {rows === null ? (
            <p className="rune-tree-empty caption">Surfacing memories…</p>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<BookmarkIcon size={28} />}
              title={filtering ? 'Nothing matches' : 'Nothing kept yet'}
              hint={
                filtering
                  ? 'Loosen the search, pick another device, or show every type.'
                  : 'Save a document from any editor and it appears here for every device.'
              }
            />
          ) : (
            <div
              className={floats && hasPages ? 'lib-rows lib-rows--pager-gutter' : 'lib-rows'}
              aria-busy={busy}
            >
              {rows.map((item) => {
                const entry = entryFor(LIBRARY_REGISTRY, item.kind);
                if (!entry) return null;
                return (
                  <div className="lib-row" key={`${item.kind}:${item.id}`}>
                    <span
                      className={`lib-badge ${cardToneClass(entry.tone)}`}
                      title={`${entry.label} document`}
                    >
                      {entry.icon}
                      <span className="lib-badge__label">{entry.label}</span>
                    </span>
                    <div className="lib-row__body">
                      <Link className="lib-row__name" to={entry.editorRoute(item)}>
                        {item.name}
                      </Link>
                      <div className="lib-row__meta">
                        <span>{authorDisplay(item.authorDeviceId)}</span>
                        <span>{formatBytes(item.sizeBytes)}</span>
                        <span>saved {formatTimeAgo(item.createdAt)}</span>
                        {item.modifiedAt !== item.createdAt && (
                          <span>edited {formatTimeAgo(item.modifiedAt)}</span>
                        )}
                      </div>
                    </div>
                    {/* One wrapper, so the grid can move every action as a unit:
                        beside the name when there is room, under it when not. */}
                    <div className="lib-row__actions">
                      {entry.readRoute && (
                        <Link
                          className="btn btn--ghost btn--sm lib-row__link"
                          to={entry.readRoute(item)}
                          aria-label={`Read ${item.name}`}
                        >
                          <EyeIcon size={15} /> Read
                        </Link>
                      )}
                      {entry.presentRoute && canPresent && (
                        <Link
                          className="btn btn--ghost btn--sm lib-row__link"
                          to={entry.presentRoute(item)}
                          aria-label={`Present ${item.name}`}
                        >
                          <SlidesIcon size={15} /> Present
                        </Link>
                      )}
                      {entry.apiRoute && entry.mimeType && (
                        /* A ready-to-run curl for the same raw data URL the API
                           link opens — so it can be tested outside the browser
                           (a terminal, Postman) without assembling the URL and
                           the right Accept header by hand. */
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm lib-row__link mono"
                          onClick={() => void copyCurl(entry, item)}
                          aria-label={
                            copiedKey === `${item.kind}:${item.id}`
                              ? 'Copied'
                              : `Copy curl command for ${item.name}`
                          }
                        >
                          {copiedKey === `${item.kind}:${item.id}` ? (
                            <CheckIcon size={15} />
                          ) : (
                            <ClipboardIcon size={15} />
                          )}{' '}
                          curl
                        </button>
                      )}
                      {entry.apiRoute && (
                        /* the same document as its tool's raw data URL */
                        <a
                          className="btn btn--ghost btn--sm lib-row__link mono"
                          href={entry.apiRoute(item)}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Open ${item.name} as raw data`}
                        >
                          API
                        </a>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete ${item.name}`}
                        onClick={() => void remove(item, entry)}
                      >
                        <CloseIcon size={15} />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {view && (
            <Pager
              page={view.page}
              pageCount={view.pageCount}
              hrefFor={hrefFor}
              floating={floats}
            />
          )}
        </Card>
      </div>
    </>
  );
}
