import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { bifrostEvents } from '../../core/sse';
import { deviceName, onDevicesChange } from '../../core/devices';
import { formatBytes, formatTimeAgo } from '../../core/format';
import { Button } from '../../core/ui/Button';
import { Card } from '../../core/ui/Card';
import { EmptyState } from '../../core/ui/EmptyState';
import { BracesIcon, CloseIcon, SearchIcon } from '../../core/ui/icons';
import {
  deleteRunestone,
  listRunestones,
  type RunestoneSort,
  type RunestoneSummary,
} from '../../core/runestone';

/** The device that carved it, by PLAN-06 display rules (alias-first). */
function authorDisplay(deviceId: string | null): string {
  if (!deviceId) return 'unknown carver';
  return deviceName(deviceId) ?? 'departed device';
}

/** Mímir keeps the well of remembered knowledge — the saved-runestone library. */
export function MimirPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<RunestoneSummary[] | null>(null);
  const [q, setQ] = useState('');
  const [author, setAuthor] = useState('');
  const [sort, setSort] = useState<RunestoneSort>('modified');
  const [order, setOrder] = useState<'asc' | 'desc' | ''>('');
  const [error, setError] = useState<string | null>(null);
  // Author options survive filtering: the union of every carver seen.
  const authorsRef = useRef(new Map<string, true>());
  const [, forceRender] = useState(0);

  const refresh = useMemo(() => {
    let timer: number | null = null;
    return (input: { q: string; author: string; sort: RunestoneSort; order: string }) => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        listRunestones({
          q: input.q || undefined,
          author: input.author || undefined,
          sort: input.sort,
          order: input.order === 'asc' || input.order === 'desc' ? input.order : undefined,
        })
          .then((list) => {
            setRows(list);
            setError(null);
            if (!input.author && !input.q) {
              for (const row of list) {
                if (row.authorDeviceId) authorsRef.current.set(row.authorDeviceId, true);
              }
            }
          })
          .catch(() => setError('Could not reach the well.'));
      }, 200);
    };
  }, []);

  useEffect(() => {
    refresh({ q, author, sort, order });
  }, [refresh, q, author, sort, order]);

  // Live updates: any save/delete anywhere refreshes this listing.
  useEffect(() => {
    const offSaved = bifrostEvents.on('runestone.saved', () =>
      refresh({ q, author, sort, order }),
    );
    const offDeleted = bifrostEvents.on('runestone.deleted', () =>
      refresh({ q, author, sort, order }),
    );
    const offDevices = onDevicesChange(() => forceRender((n) => n + 1));
    return () => {
      offSaved();
      offDeleted();
      offDevices();
    };
  }, [refresh, q, author, sort, order]);

  const remove = async (row: RunestoneSummary) => {
    if (!window.confirm(`Shatter "${row.name}"? This cannot be undone.`)) return;
    try {
      await deleteRunestone(row.id);
      setRows((current) => current?.filter((item) => item.id !== row.id) ?? null);
    } catch {
      setError('Delete failed — it may already be gone.');
    }
  };

  const authorOptions = [...authorsRef.current.keys()];

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow eyebrow--violet">mímir&apos;s well · every stone remembered</span>
          <h2>Mímir</h2>
          <p>The well keeps every carved stone, from every device on the bridge.</p>
        </div>
        <div className="rune-head-actions">
          <Button onClick={() => void navigate('/runestone')}>Carve a new one</Button>
        </div>
      </div>

      <div className="stack">
        <Card>
          <div className="rune-lib-filters">
            <label className="rune-lib-search">
              <SearchIcon size={16} />
              <input
                className="field__input"
                placeholder="Search by name…"
                value={q}
                onChange={(event) => setQ(event.target.value)}
              />
            </label>
            <select
              className="field__input rune-lib-select"
              value={author}
              aria-label="Filter by carver"
              onChange={(event) => setAuthor(event.target.value)}
            >
              <option value="">Every carver</option>
              {authorOptions.map((id) => (
                <option key={id} value={id}>
                  {authorDisplay(id)}
                </option>
              ))}
            </select>
            <select
              className="field__input rune-lib-select"
              value={sort}
              aria-label="Sort by"
              onChange={(event) => setSort(event.target.value as RunestoneSort)}
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
              {order === 'asc' ? '↑' : order === 'desc' ? '↓' : '↕'}
            </Button>
          </div>

          {error && (
            <p className="caption" role="alert" style={{ color: 'var(--danger)' }}>
              {error}
            </p>
          )}

          {rows === null ? (
            <p className="rune-tree-empty caption">Drawing from the well…</p>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<BracesIcon size={28} />}
              title={q || author ? 'No stones match' : 'Nothing carved yet'}
              hint={
                q || author
                  ? 'Loosen the search or pick another carver.'
                  : 'Save a document from the editor and it appears here for every device.'
              }
            />
          ) : (
            <div className="rune-lib-rows">
              {rows.map((row) => (
                <div className="rune-lib-row" key={row.id}>
                  <div className="rune-lib-row__body">
                    <Link className="rune-lib-row__name" to={`/runestone/${row.slug}`}>
                      {row.name}
                    </Link>
                    <div className="rune-lib-row__meta">
                      <span>{authorDisplay(row.authorDeviceId)}</span>
                      <span>{formatBytes(row.sizeBytes)}</span>
                      <span>carved {formatTimeAgo(row.createdAt)}</span>
                      {row.modifiedAt !== row.createdAt && (
                        <span>edited {formatTimeAgo(row.modifiedAt)}</span>
                      )}
                    </div>
                  </div>
                  {/* the same document as a raw-JSON data URL (PLAN-07 addendum) */}
                  <a
                    className="btn btn--ghost btn--sm rune-lib-row__api mono"
                    href={`/runestone/api/${row.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Open ${row.name} as JSON API`}
                  >
                    API
                  </a>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${row.name}`}
                    onClick={() => void remove(row)}
                  >
                    <CloseIcon size={15} />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
