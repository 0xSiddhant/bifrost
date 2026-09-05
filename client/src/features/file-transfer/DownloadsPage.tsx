import { Suspense, useMemo, useState } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { downloadUrl, type DownloadEntry } from '../../core/api';
import { Card } from '../../core/ui/Card';
import { EmptyState } from '../../core/ui/EmptyState';
import { FileRow, kindOf } from '../../core/ui/FileRow';
import { Input, Select } from '../../core/ui/Field';
import { ArchiveFileIcon, DownloadIcon, EyeIcon, FolderIcon } from '../../core/ui/icons';
import { formatBytes, formatTimeAgo } from '../../core/format';
import { folderArchiveUrl } from './api';
import { useDownloads } from './useDownloads';

type SortKey = 'newest' | 'name' | 'size';

const SORTERS: Record<SortKey, (a: DownloadEntry, b: DownloadEntry) => number> = {
  newest: (a, b) => b.mtime - a.mtime,
  name: (a, b) => a.name.localeCompare(b.name),
  size: (a, b) => b.size - a.size,
};

/** Client-side hint only — the preview modal asks /meta for the truth. */
const mayPreview = (name: string): boolean => !['archive', 'other'].includes(kindOf(name));

export function DownloadsPage() {
  const { entries, sseStatus } = useDownloads();
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('newest');

  // One feed, two views (PLAN-24): the root shows what has no parent, and the
  // folder page filters the very same list by its own name.
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = (entries ?? []).filter(
      (entry) =>
        entry.parent === null && (needle === '' || entry.name.toLowerCase().includes(needle)),
    );
    return filtered.sort(SORTERS[sortKey]);
  }, [entries, query, sortKey]);

  // Folder totals are derived from the same entries rather than sent by the
  // server, so the figure cannot drift from the rows it is counting.
  const folderTotals = useMemo(() => {
    const totals = new Map<string, { files: number; bytes: number }>();
    for (const entry of entries ?? []) {
      if (entry.type !== 'file' || entry.parent === null) continue;
      const running = totals.get(entry.parent) ?? { files: 0, bytes: 0 };
      totals.set(entry.parent, { files: running.files + 1, bytes: running.bytes + entry.size });
    }
    return totals;
  }, [entries]);

  // Only files can be stepped through in the preview modal.
  const previewable = useMemo(() => visible.filter((entry) => entry.type === 'file'), [visible]);

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow eyebrow--violet">asgard → midgard</span>
          <h2>Receive files</h2>
          <p>Drop something into the downloads folder on the host — it appears here instantly.</p>
        </div>
      </div>

      <div className="toolbar">
        <Input
          label="Search"
          type="search"
          placeholder="Filter by name…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Select
          label="Sort"
          value={sortKey}
          onChange={(event) => setSortKey(event.target.value as SortKey)}
        >
          <option value="newest">Newest first</option>
          <option value="name">Name</option>
          <option value="size">Size</option>
        </Select>
        {sseStatus === 'open' ? (
          <span className="badge badge--ok">● live</span>
        ) : (
          <span className="badge">○ reconnecting…</span>
        )}
      </div>

      {entries === null ? (
        <Card>
          <EmptyState icon={<FolderIcon size={28} />} title="Summoning the listing…" />
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FolderIcon size={28} />}
            title={query ? 'Nothing matches your search' : 'The bridge is quiet'}
            hint={
              query
                ? undefined
                : 'Files dropped into storage/downloads on the host will appear here, on every device, the moment they land.'
            }
          />
        </Card>
      ) : (
        <Card>
          {visible.map((entry) =>
            entry.type === 'folder' ? (
              <FolderRow
                key={entry.id}
                entry={entry}
                totals={folderTotals.get(entry.name) ?? { files: 0, bytes: 0 }}
              />
            ) : (
              <FileRow
                key={entry.id}
                name={entry.name}
                size={formatBytes(entry.size)}
                time={formatTimeAgo(entry.mtime)}
                aside={
                  <span className="row">
                    {mayPreview(entry.name) && (
                      <Link
                        className="btn btn--ghost btn--icon"
                        to={`${entry.id}/preview`}
                        aria-label={`Preview ${entry.name}`}
                        title={`Preview ${entry.name}`}
                      >
                        <EyeIcon size={18} />
                      </Link>
                    )}
                    <a
                      className="btn btn--ghost btn--icon"
                      href={downloadUrl(entry.id)}
                      download={entry.name}
                      aria-label={`Download ${entry.name}`}
                      title={`Download ${entry.name}`}
                    >
                      <DownloadIcon size={18} />
                    </a>
                  </span>
                }
              />
            ),
          )}
        </Card>
      )}

      {/* Preview modal route (/downloads/:id/preview) renders here. */}
      <Suspense fallback={null}>
        <Outlet context={{ entries: previewable, basePath: '/downloads' }} />
      </Suspense>
    </>
  );
}

/**
 * Two unambiguous actions, not one icon doing double duty: the name opens the
 * folder, the icon downloads it as a zip without navigating anywhere.
 */
function FolderRow({
  entry,
  totals,
}: {
  entry: DownloadEntry;
  totals: { files: number; bytes: number };
}) {
  return (
    <FileRow
      name={entry.name}
      kind="folder"
      to={`/downloads/folder/${entry.id}`}
      size={`${totals.files} ${totals.files === 1 ? 'file' : 'files'} · ${formatBytes(totals.bytes)}`}
      time={formatTimeAgo(entry.mtime)}
      aside={
        <a
          className="btn btn--ghost btn--icon"
          href={folderArchiveUrl(entry.id)}
          download={`${entry.name}.zip`}
          aria-label={`Download ${entry.name} as a zip`}
          title={`Download ${entry.name} as a zip`}
        >
          <ArchiveFileIcon size={18} />
        </a>
      }
    />
  );
}
