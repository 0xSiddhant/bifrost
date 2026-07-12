import { useState } from 'react';
import { Button } from '../../core/ui/Button';
import { Card } from '../../core/ui/Card';
import { EmptyState } from '../../core/ui/EmptyState';
import { FileRow } from '../../core/ui/FileRow';
import { Input, Select } from '../../core/ui/Field';
import { DownloadIcon, FolderIcon } from '../../core/ui/icons';

/** Static design shell — the live SSE-fed list arrives in PLAN-02. */

const MOCK_FILES = [
  { name: 'family-album-june.zip', size: '412.7 MB', time: '2m ago' },
  { name: 'flight-tickets.pdf', size: '184 KB', time: '18m ago' },
  { name: 'demo-cut-v3.mp4', size: '1.4 GB', time: '1h ago' },
  { name: 'IMG_3990.HEIC', size: '2.8 MB', time: '3h ago' },
  { name: 'podcast-episode-12.mp3', size: '58.1 MB', time: 'yesterday' },
  { name: 'tax-notes-2026.md', size: '12 KB', time: 'yesterday' },
];

export function DownloadsPage() {
  // Design-review helper only: shows the empty state. Removed in PLAN-02.
  const [empty, setEmpty] = useState(false);

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow eyebrow--violet">asgard → midgard</span>
          <h2>Receive files</h2>
          <p>
            Drop something into the downloads folder on the host — it appears here instantly.
          </p>
        </div>
        <div className="state-switch" aria-label="Design review states">
          <Button variant="ghost" size="sm" onClick={() => setEmpty(false)}>
            state: files
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setEmpty(true)}>
            state: empty
          </Button>
        </div>
      </div>

      <div className="toolbar">
        <Input label="Search" type="search" placeholder="Filter by name…" />
        <Select label="Sort">
          <option>Newest first</option>
          <option>Name</option>
          <option>Size</option>
        </Select>
        <span className="badge badge--ok">● live</span>
      </div>

      {empty ? (
        <Card>
          <EmptyState
            icon={<FolderIcon size={28} />}
            title="The bridge is quiet"
            hint="Files dropped into storage/downloads on the host will appear here, on every device, the moment they land."
          />
        </Card>
      ) : (
        <Card>
          {MOCK_FILES.map((file) => (
            <FileRow
              key={file.name}
              name={file.name}
              size={file.size}
              time={file.time}
              aside={
                <Button variant="ghost" size="icon" aria-label={`Download ${file.name}`}>
                  <DownloadIcon size={18} />
                </Button>
              }
            />
          ))}
        </Card>
      )}
    </>
  );
}
