import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { bifrostEvents } from '../../core/sse';
import { copyText } from '../../core/copy';
import { deviceName, onDevicesChange } from '../../core/devices';
import { formatBytes, formatTimeAgo } from '../../core/format';
import { useCapabilities } from '../../core/useCapabilities';
import { Button } from '../../core/ui/Button';
import { Card } from '../../core/ui/Card';
import { EmptyState } from '../../core/ui/EmptyState';
import { cardToneClass } from '../../core/ui/cardTone';
import { BookmarkIcon, CheckIcon, ClipboardIcon, CloseIcon, EyeIcon, SearchIcon } from '../../core/ui/icons';
import {
  LIBRARY_REGISTRY,
  availableKinds,
  buildCurlCommand,
  entryFor,
  filterItems,
  loadLibrary,
  sortItems,
  type LibraryEntry,
  type LibraryItem,
  type LibraryKind,
  type LibraryOrder,
  type LibrarySort,
} from '../../core/library';

/** The device that saved it, by PLAN-06 display rules (alias-first). */
function authorDisplay(deviceId: string | null): string {
  if (!deviceId) return 'unknown device';
  return deviceName(deviceId) ?? 'departed device';
}

const REFRESH_DEBOUNCE_MS = 200;

/**
 * The Pensieve — one library over every saved document (PLAN-21).
 *
 * It lives in `app/pages/` rather than a feature because it is a shell across
 * several features and may not import any of them; everything worth testing
 * (the registry, the merge, the sort, the filters) is in `core/library/`, where
 * it runs without a DOM. It needs no capability of its own: it renders when at
 * least one document kind is present, and the registry decides which.
 */
export function PensievePage() {
  const navigate = useNavigate();
  const { capabilities } = useCapabilities();
  const [searchParams, setSearchParams] = useSearchParams();

  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [failed, setFailed] = useState<LibraryKind[]>([]);
  const [q, setQ] = useState('');
  const [author, setAuthor] = useState('');
  const [sort, setSort] = useState<LibrarySort>('modified');
  const [order, setOrder] = useState<LibraryOrder>('desc');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Author options survive filtering: the union of every device seen.
  const authorsRef = useRef(new Map<string, true>());
  const [, forceRender] = useState(0);
  // Which row's curl command was just copied — same shape as Portkey's own
  // copy-link feedback (an icon swap, not a global toast: this is a routine,
  // per-row affordance, not an event worth a notification).
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copyCurl = async (entry: LibraryEntry, item: LibraryItem) => {
    const command = buildCurlCommand(entry, item, window.location.origin);
    if (!command) return;
    const key = `${item.kind}:${item.id}`;
    if (await copyText(command)) {
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1500);
    }
  };

  // Capabilities arrive a tick after mount; until then we know of no kinds, so
  // the first load waits rather than firing a fan-out over an empty registry.
  //
  // Keyed on the module list's *contents*, not the capabilities object: `kinds`
  // is what the load effect and the SSE subscriptions both depend on, so a
  // fresh-but-equal object would re-fetch and re-subscribe on every render.
  const moduleKey = capabilities ? capabilities.modules.join(' ') : null;
  const kinds = useMemo(() => {
    if (moduleKey === null) return null;
    const modules = new Set(moduleKey.split(' '));
    return availableKinds(LIBRARY_REGISTRY, (module) => modules.has(module));
  }, [moduleKey]);

  // The open filter lives in the URL, so a chip is linkable and Back restores
  // the previous one (criterion 2). An unknown or disabled kind reads as All.
  const typeParam = searchParams.get('type');
  const activeKind =
    kinds?.some((entry) => entry.kind === typeParam) ? (typeParam as LibraryKind) : null;

  const query = useMemo(
    () => ({
      q: q.trim() || undefined,
      author: author || undefined,
      sort,
      order,
    }),
    [q, author, sort, order],
  );
  // The SSE effect must not resubscribe on every keystroke, so it reads the
  // live query through a ref instead of depending on it.
  const queryRef = useRef(query);
  queryRef.current = query;

  const applyLoad = useCallback((entries: LibraryEntry[], loaded: LibraryItem[], failedKinds: LibraryKind[]) => {
    const touched = new Set(entries.map((entry) => entry.kind));
    setItems((current) => {
      const kept = (current ?? []).filter((item) => !touched.has(item.kind));
      return sortItems([...kept, ...loaded], queryRef.current.sort, queryRef.current.order);
    });
    setFailed((current) => [
      ...current.filter((kind) => !touched.has(kind)),
      ...failedKinds,
    ]);
  }, []);

  /** Load one or more kinds. Retry is the same call with a single entry. */
  const load = useCallback(
    async (entries: LibraryEntry[]) => {
      if (entries.length === 0) {
        setItems([]);
        setFailed([]);
        return;
      }
      const { items: loaded, failed: failedKinds } = await loadLibrary(entries, queryRef.current);
      applyLoad(entries, loaded, failedKinds);
      if (!queryRef.current.q && !queryRef.current.author) {
        for (const item of loaded) {
          if (item.authorDeviceId) authorsRef.current.set(item.authorDeviceId, true);
        }
      }
    },
    [applyLoad],
  );

  // Debounced so typing in the search box is one request, not one per letter.
  useEffect(() => {
    if (!kinds) return;
    const timer = window.setTimeout(() => void load(kinds), REFRESH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [kinds, load, query]);

  // Live updates: a save or delete on any device, for any enabled kind. A kind
  // that is not enabled is never subscribed to (criterion 7).
  useEffect(() => {
    if (!kinds) return;
    const offs = kinds.flatMap((entry) =>
      entry.events.map((event) => bifrostEvents.on(event, () => void load([entry]))),
    );
    const offDevices = onDevicesChange(() => forceRender((n) => n + 1));
    return () => {
      for (const off of offs) off();
      offDevices();
    };
  }, [kinds, load]);

  const setKind = (kind: LibraryKind | null) => {
    const next = new URLSearchParams(searchParams);
    if (kind) next.set('type', kind);
    else next.delete('type');
    setSearchParams(next);
  };

  const remove = async (item: LibraryItem, entry: LibraryEntry) => {
    if (!window.confirm(`Delete "${item.name}"? This cannot be undone.`)) return;
    try {
      await entry.remove(item.id);
      setItems(
        (current) =>
          current?.filter((row) => !(row.kind === item.kind && row.id === item.id)) ?? null,
      );
      setDeleteError(null);
    } catch {
      setDeleteError(`Could not delete that ${entry.noun} — it may already be gone.`);
    }
  };

  const visible = items === null ? null : filterItems(items, { kind: activeKind });
  const authorOptions = [...authorsRef.current.keys()];
  const filtering = Boolean(q || author || activeKind);
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
                onChange={(event) => setQ(event.target.value)}
              />
            </label>
            <select
              className="field__input lib-select"
              value={author}
              aria-label="Filter by device"
              onChange={(event) => setAuthor(event.target.value)}
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
              onChange={(event) => setSort(event.target.value as LibrarySort)}
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
              onClick={() => setOrder((current) => (current === 'asc' ? 'desc' : 'asc'))}
            >
              {order === 'asc' ? '↑' : '↓'}
            </Button>
          </div>

          {/* Type chips. One kind means no chips at all — a filter with a single
              option is decoration. They are absent until capabilities land. */}
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
                <Button variant="ghost" size="sm" onClick={() => void load([entry])}>
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

          {visible === null ? (
            <p className="rune-tree-empty caption">Surfacing memories…</p>
          ) : visible.length === 0 ? (
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
            <div className="lib-rows">
              {visible.map((item) => {
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
                    {entry.readRoute && (
                      <Link
                        className="btn btn--ghost btn--sm lib-row__link"
                        to={entry.readRoute(item)}
                        aria-label={`Read ${item.name}`}
                      >
                        <EyeIcon size={15} /> Read
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
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
