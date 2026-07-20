import { formatJsonPath } from '../../core/json';
import type { DiffRecord } from '../../core/json/diff';
import { ChevronRightIcon } from '../../core/ui/icons';
import type { DiffStats, TextChunkRow } from './compare';

/**
 * Post-compare results (PLAN-08): stats chip + grouped, navigable change
 * list. Collapsed by default on desktop; the primary results view on phones,
 * where stacked panes are unreadable but a tappable list is not.
 */

interface ResultsDrawerProps {
  mode: 'json' | 'text';
  open: boolean;
  onToggle: () => void;
  stale: boolean;
  stats: DiffStats | null;
  records: readonly DiffRecord[] | null;
  chunks: readonly TextChunkRow[] | null;
  onJumpRecord: (record: DiffRecord) => void;
  onJumpChunk: (row: TextChunkRow) => void;
}

const OP_LABEL: Record<DiffRecord['op'], string> = {
  add: 'Added',
  remove: 'Removed',
  change: 'Changed',
  'type-change': 'Type changed',
};

const OP_KIND: Record<DiffRecord['op'], 'add' | 'remove' | 'change'> = {
  add: 'add',
  remove: 'remove',
  change: 'change',
  'type-change': 'change',
};

/** Row budget per group — a 10k-row DOM list is a freeze, not a feature. */
const MAX_ROWS_PER_GROUP = 100;
const MAX_CHUNK_ROWS = 200;

function preview(value: unknown): string {
  const text = JSON.stringify(value);
  if (text === undefined) return '';
  return text.length > 42 ? `${text.slice(0, 42)}…` : text;
}

function recordDetail(record: DiffRecord): string {
  if (record.aspect === 'key-order') return 'key order differs';
  switch (record.op) {
    case 'add':
      return preview(record.after);
    case 'remove':
      return preview(record.before);
    default:
      return `${preview(record.before)} → ${preview(record.after)}`;
  }
}

export function ResultsDrawer({
  mode,
  open,
  onToggle,
  stale,
  stats,
  records,
  chunks,
  onJumpRecord,
  onJumpChunk,
}: ResultsDrawerProps) {
  if (!stats) return null;
  const total = stats.adds + stats.removes + stats.changes;

  const groups =
    mode === 'json' && records
      ? (['add', 'remove', 'change', 'type-change'] as const)
          .map((op) => ({ op, rows: records.filter((record) => record.op === op) }))
          .filter((group) => group.rows.length > 0)
      : [];

  return (
    <section className={`variant-drawer${stale ? ' variant-drawer--stale' : ''}`}>
      <button
        type="button"
        className="variant-drawer__head"
        aria-expanded={open}
        onClick={onToggle}
      >
        <ChevronRightIcon size={14} className={open ? 'variant-drawer__chev variant-drawer__chev--open' : 'variant-drawer__chev'} />
        <span className="variant-drawer__title">
          {total === 0 ? 'No differences' : 'Differences'}
        </span>
        <span className="variant-stats mono" aria-label="Diff stats">
          <span className="variant-stats__add">+{stats.adds}</span>
          <span className="variant-stats__remove">−{stats.removes}</span>
          <span className="variant-stats__change">~{stats.changes}</span>
        </span>
        {stale && <span className="variant-drawer__stale caption">edited — compare again</span>}
      </button>

      {open && total > 0 && mode === 'json' && (
        <div className="variant-drawer__body">
          {groups.map((group) => (
            <div key={group.op} className="variant-drawer__group">
              <h4 className={`variant-drawer__op variant-drawer__op--${OP_KIND[group.op]}`}>
                {OP_LABEL[group.op]} · {group.rows.length}
              </h4>
              <ul>
                {group.rows.slice(0, MAX_ROWS_PER_GROUP).map((record, index) => (
                  <li key={`${group.op}-${index}`}>
                    <button type="button" onClick={() => onJumpRecord(record)}>
                      <span className="mono variant-drawer__path">
                        {formatJsonPath(record.path)}
                      </span>
                      <span className="caption variant-drawer__preview">
                        {recordDetail(record)}
                      </span>
                    </button>
                  </li>
                ))}
                {group.rows.length > MAX_ROWS_PER_GROUP && (
                  <li className="caption variant-drawer__more">
                    …and {group.rows.length - MAX_ROWS_PER_GROUP} more
                  </li>
                )}
              </ul>
            </div>
          ))}
        </div>
      )}

      {open && total > 0 && mode === 'text' && chunks && (
        <div className="variant-drawer__body">
          <ul>
            {chunks.slice(0, MAX_CHUNK_ROWS).map((row, index) => (
              <li key={index}>
                <button type="button" onClick={() => onJumpChunk(row)}>
                  <span className={`variant-drawer__op variant-drawer__op--${row.kind}`}>
                    {row.kind === 'add' ? 'Added' : row.kind === 'remove' ? 'Removed' : 'Changed'}
                  </span>
                  <span className="mono variant-drawer__path">{row.label}</span>
                </button>
              </li>
            ))}
            {chunks.length > MAX_CHUNK_ROWS && (
              <li className="caption variant-drawer__more">
                …and {chunks.length - MAX_CHUNK_ROWS} more
              </li>
            )}
          </ul>
        </div>
      )}
    </section>
  );
}
