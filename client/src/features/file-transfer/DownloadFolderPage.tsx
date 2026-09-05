import { Suspense, useMemo } from 'react';
import { Link, Outlet, useParams } from 'react-router-dom';
import { downloadUrl } from '../../core/api';
import { Card } from '../../core/ui/Card';
import { EmptyState } from '../../core/ui/EmptyState';
import { FileRow, kindOf } from '../../core/ui/FileRow';
import { ChevronLeftIcon, DownloadIcon, EyeIcon, FolderIcon } from '../../core/ui/icons';
import { formatBytes, formatTimeAgo } from '../../core/format';
import { folderArchiveUrl } from './api';
import { useDownloads } from './useDownloads';

/** Client-side hint only — the preview modal asks /meta for the truth. */
const mayPreview = (name: string): boolean => !['archive', 'other'].includes(kindOf(name));

/**
 * One folder's contents (PLAN-24). It reads the **same** live feed the root
 * listing does — one fetch, one SSE subscription — and filters it by name, so
 * a file landing in the folder appears here with no second sync mechanism.
 */
export function DownloadFolderPage() {
  const { folderId = '' } = useParams();
  const { entries, sseStatus } = useDownloads();

  const folder = useMemo(
    () => (entries ?? []).find((entry) => entry.id === folderId && entry.type === 'folder') ?? null,
    [entries, folderId],
  );

  const files = useMemo(() => {
    if (!folder) return [];
    return (entries ?? [])
      .filter((entry) => entry.type === 'file' && entry.parent === folder.name)
      .sort((a, b) => b.mtime - a.mtime);
  }, [entries, folder]);

  const totalBytes = files.reduce((sum, entry) => sum + entry.size, 0);

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow eyebrow--violet">asgard → midgard</span>
          <h2>{folder ? folder.name : 'Folder'}</h2>
          <p>
            {folder
              ? `${files.length} ${files.length === 1 ? 'file' : 'files'} · ${formatBytes(totalBytes)} — everything here is live for everyone on the bridge.`
              : 'Looking for this folder in the listing…'}
          </p>
        </div>
      </div>

      <div className="toolbar">
        <Link className="btn btn--ghost btn--sm" to="/downloads">
          <ChevronLeftIcon size={16} /> Back to Receive
        </Link>
        {folder && (
          <a
            className="btn btn--primary btn--sm"
            href={folderArchiveUrl(folder.id)}
            download={`${folder.name}.zip`}
          >
            <DownloadIcon size={16} /> Download folder as .zip
          </a>
        )}
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
      ) : !folder ? (
        <Card>
          <EmptyState
            icon={<FolderIcon size={28} />}
            title="That folder is not on the bridge"
            hint="It may have been removed on the host. Head back to Receive to see what is there now."
          />
        </Card>
      ) : files.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FolderIcon size={28} />}
            title="This folder is empty"
            hint="Send files into it from the Send page, or drop them into it on the host."
          />
        </Card>
      ) : (
        <Card>
          {files.map((entry) => (
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
          ))}
        </Card>
      )}

      {/* Preview modal route (/downloads/folder/:folderId/:id/preview). */}
      <Suspense fallback={null}>
        <Outlet context={{ entries: files, basePath: `/downloads/folder/${folderId}` }} />
      </Suspense>
    </>
  );
}
