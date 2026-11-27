import { useEffect, useMemo, useState } from 'react';
import { ApiError, downloadUrl, type DownloadEntry } from '../../core/api';
import { formatBytes, formatTimeAgo } from '../../core/format';
import { log } from '../../core/log';
import { notify } from '../../core/notify';
import { Button } from '../../core/ui/Button';
import { Card } from '../../core/ui/Card';
import { EmptyState } from '../../core/ui/EmptyState';
import { Input, Select } from '../../core/ui/Field';
import { FileRow } from '../../core/ui/FileRow';
import { DownloadIcon, EyeIcon, FolderIcon } from '../../core/ui/icons';
import { deleteDownload, fetchDownloads } from './api';

type DownloadSort = 'newest' | 'name' | 'size';

export function HeimdallDownloadsSection() {
  const [downloads, setDownloads] = useState<DownloadEntry[]>([]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<DownloadSort>('newest');
  const [expandedFolder, setExpandedFolder] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    fetchDownloads()
      .then((result) => {
        if (cancelled) return;
        setDownloads(result);
        notify.dismissKey('heimdall-downloads');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(true);
        log.reportError('Heimdall: could not load downloads', error, { module: 'heimdall' });
        notify.error('Could not load Downloads. Try again.', {
          title: 'Heimdall',
          dedupeKey: 'heimdall-downloads',
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const folders = useMemo(() => {
    const result = new Map<string, DownloadEntry[]>();
    for (const entry of downloads) {
      if (entry.type !== 'file' || entry.parent === null) continue;
      const current = result.get(entry.parent) ?? [];
      current.push(entry);
      result.set(entry.parent, current);
    }
    return result;
  }, [downloads]);

  const roots = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const visible = downloads.filter(
      (entry) =>
        entry.parent === null &&
        (needle === '' ||
          entry.name.toLowerCase().includes(needle) ||
          (entry.type === 'folder' &&
            (folders.get(entry.name) ?? []).some((file) => file.name.toLowerCase().includes(needle)))),
    );
    return visible.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'size') return downloadSize(b, folders) - downloadSize(a, folders);
      return b.mtime - a.mtime;
    });
  }, [downloads, folders, query, sort]);

  const fileCount = downloads.filter((entry) => entry.type === 'file').length;
  const folderCount = downloads.filter((entry) => entry.type === 'folder').length;
  const totalBytes = downloads.reduce(
    (total, entry) => total + (entry.type === 'file' ? entry.size : 0),
    0,
  );

  const removeFromList = (entry: DownloadEntry) => {
    setDownloads((current) =>
      current.filter(
        (item) => item.id !== entry.id && !(entry.type === 'folder' && item.parent === entry.name),
      ),
    );
    setConfirmingDelete(null);
    setExpandedFolder((current) => (current === entry.id ? null : current));
  };

  const removeDownload = async (entry: DownloadEntry) => {
    setBusyId(entry.id);
    const description =
      entry.type === 'folder'
        ? `${entry.name} and its contents`
        : entry.parent
          ? `${entry.parent}/${entry.name}`
          : entry.name;
    try {
      await deleteDownload(entry.id);
      removeFromList(entry);
      notify.dismissKey(`heimdall-download-delete:${entry.id}`);
      notify.ok(`Deleted ${description}`, { title: 'Heimdall' });
    } catch (error: unknown) {
      log.reportError(`Heimdall: could not delete download ${description}`, error, {
        module: 'heimdall',
      });
      if (error instanceof ApiError && error.status === 404) removeFromList(entry);
      notify.error(
        error instanceof ApiError && error.status === 404
          ? `${description} is no longer on the host and was removed from the list.`
          : `Could not delete ${description}.`,
        { title: 'Heimdall', dedupeKey: `heimdall-download-delete:${entry.id}` },
      );
    } finally {
      setBusyId(null);
    }
  };

  const fileActions = (entry: DownloadEntry) => {
    const label = entry.parent ? `${entry.parent}/${entry.name}` : entry.name;
    if (confirmingDelete === entry.id) {
      return (
        <span className="row">
          <span className="caption">Delete permanently?</span>
          <Button
            size="sm"
            variant="danger"
            disabled={busyId !== null}
            onClick={() => void removeDownload(entry)}
          >
            Delete
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busyId !== null}
            onClick={() => setConfirmingDelete(null)}
          >
            Keep
          </Button>
        </span>
      );
    }
    return (
      <span className="row">
        <a
          className="btn btn--ghost btn--icon tip"
          href={`/downloads/${entry.id}/preview`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Preview ${label}`}
          data-tip={`Preview ${label}`}
        >
          <EyeIcon size={18} />
        </a>
        <a
          className="btn btn--ghost btn--icon tip"
          href={downloadUrl(entry.id)}
          download={entry.name}
          aria-label={`Download ${label}`}
          data-tip={`Download ${label}`}
        >
          <DownloadIcon size={18} />
        </a>
        <Button
          size="sm"
          variant="ghost"
          disabled={busyId !== null}
          aria-label={`Delete ${label}`}
          onClick={() => setConfirmingDelete(entry.id)}
        >
          Delete
        </Button>
      </span>
    );
  };

  const renderFile = (entry: DownloadEntry) => (
    <FileRow
      key={entry.id}
      name={entry.name}
      size={formatBytes(entry.size)}
      time={formatTimeAgo(entry.mtime)}
      aside={fileActions(entry)}
    />
  );

  return (
    <div className="stack">
      <div className="heimdall-downloads__controls" id="heimdall-ctl-downloads-list">
        <Input
          label="Search Downloads"
          type="search"
          placeholder="Filter by name…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Select
          label="Sort downloads"
          value={sort}
          onChange={(event) => setSort(event.target.value as DownloadSort)}
        >
          <option value="newest">Newest first</option>
          <option value="name">Name</option>
          <option value="size">Size</option>
        </Select>
        <Button size="sm" variant="ghost" onClick={() => setRefreshKey((key) => key + 1)}>
          Refresh
        </Button>
      </div>
      <p className="caption" role="status">
        {fileCount} {fileCount === 1 ? 'file' : 'files'} · {folderCount}{' '}
        {folderCount === 1 ? 'folder' : 'folders'} · {formatBytes(totalBytes)} total
      </p>
      <Card>
        {loading ? (
          <p className="caption">Loading Downloads…</p>
        ) : loadError ? (
          <div className="row" role="alert">
            <p className="caption">Could not load Downloads.</p>
            <Button size="sm" variant="ghost" onClick={() => setRefreshKey((key) => key + 1)}>
              Retry
            </Button>
          </div>
        ) : roots.length === 0 ? (
          <EmptyState
            icon={<FolderIcon size={28} />}
            title={query ? 'Nothing matches your search' : 'Downloads is empty'}
            hint={query ? undefined : 'Files and folders on the host appear here.'}
          />
        ) : (
          roots.map((entry) => {
            if (entry.type === 'file') return renderFile(entry);
            const contents = folders.get(entry.name) ?? [];
            const bytes = contents.reduce((total, file) => total + file.size, 0);
            const needle = query.trim().toLowerCase();
            const expanded =
              expandedFolder === entry.id ||
              (needle !== '' && contents.some((file) => file.name.toLowerCase().includes(needle)));
            const isConfirming = confirmingDelete === entry.id;
            return (
              <div className="heimdall-downloads__folder" key={entry.id}>
                <FileRow
                  name={entry.name}
                  kind="folder"
                  size={`${contents.length} ${contents.length === 1 ? 'file' : 'files'} · ${formatBytes(bytes)}`}
                  time={formatTimeAgo(entry.mtime)}
                  aside={
                    isConfirming ? (
                      <span className="row">
                      <span className="caption">Delete folder and everything inside it?</span>
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={busyId !== null}
                          onClick={() => void removeDownload(entry)}
                        >
                          Delete
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busyId !== null}
                          onClick={() => setConfirmingDelete(null)}
                        >
                          Keep
                        </Button>
                      </span>
                    ) : (
                      <span className="row">
                        <a
                          className="btn btn--ghost btn--sm"
                          href={`/downloads/folder/${entry.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Browse ${entry.name}`}
                        >
                          Browse
                        </a>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busyId !== null}
                          aria-label={`Delete folder ${entry.name}`}
                          onClick={() => setConfirmingDelete(entry.id)}
                        >
                          Delete
                        </Button>
                      </span>
                    )
                  }
                />
                {expanded && contents.length > 0 && (
                  <div className="heimdall-downloads__contents">
                    {contents
                      .filter(
                        (file) =>
                          query.trim() === '' ||
                          file.name.toLowerCase().includes(query.trim().toLowerCase()),
                      )
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map(renderFile)}
                  </div>
                )}
                {!isConfirming && contents.length > 0 && (
                  <div className="heimdall-downloads__toggle">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-expanded={expanded}
                      onClick={() =>
                        setExpandedFolder((current) => (current === entry.id ? null : entry.id))
                      }
                    >
                      {expanded ? 'Hide files' : 'Show files'}
                    </Button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </Card>
    </div>
  );
}

function downloadSize(entry: DownloadEntry, folders: Map<string, DownloadEntry[]>): number {
  return entry.type === 'folder'
    ? (folders.get(entry.name) ?? []).reduce((total, file) => total + file.size, 0)
    : entry.size;
}
