import { useState } from 'react';
import { Button } from '../../core/ui/Button';
import { Card } from '../../core/ui/Card';
import { FileRow } from '../../core/ui/FileRow';
import { ProgressBar } from '../../core/ui/ProgressBar';
import { Toast } from '../../core/ui/Toast';
import { CheckIcon, UploadIcon } from '../../core/ui/icons';

/** Static design shell — mocked queue, no real uploads (PLAN-02 wires it). */

type QueueState = 'uploading' | 'error';

const MOCK_DONE = { name: 'vacation-photos_2026.zip', size: '184.2 MB', time: 'just now' };
const MOCK_ACTIVE = { name: 'IMG_4021.HEIC', size: '3.1 MB', time: 'just now' };
const MOCK_SLOW = { name: 'talk-recording.mov', size: '1.2 GB', time: 'just now' };

export function UploadPage() {
  // Design-review helper only: lets the reviewer see both states. Removed in PLAN-02.
  const [state, setState] = useState<QueueState>('uploading');

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">midgard → asgard</span>
          <h2>Send files</h2>
          <p>Files land in a write-only vault on the host — nothing here can be read back.</p>
        </div>
        <div className="state-switch" aria-label="Design review states">
          <Button variant="ghost" size="sm" onClick={() => setState('uploading')}>
            state: uploading
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setState('error')}>
            state: error
          </Button>
        </div>
      </div>

      <div className="stack">
        <div className="dropzone" role="button" tabIndex={0}>
          <UploadIcon size={32} />
          <strong>Drop files here or tap to browse</strong>
          <span className="caption">Up to 20 files · 2 GB each · straight over your Wi-Fi</span>
        </div>

        {state === 'error' && (
          <Toast kind="danger">
            talk-recording.mov failed — connection interrupted. The vault kept nothing partial.
          </Toast>
        )}

        <Card>
          <FileRow
            name={MOCK_DONE.name}
            size={MOCK_DONE.size}
            time={MOCK_DONE.time}
            aside={
              <span className="badge badge--ok">
                <CheckIcon size={12} /> done
              </span>
            }
          />
          <FileRow
            name={MOCK_ACTIVE.name}
            size={MOCK_ACTIVE.size}
            time={MOCK_ACTIVE.time}
            aside={<span className="badge">62%</span>}
          >
            <ProgressBar value={62} label="IMG_4021.HEIC upload progress" />
          </FileRow>
          <FileRow
            name={MOCK_SLOW.name}
            size={MOCK_SLOW.size}
            time={MOCK_SLOW.time}
            aside={
              state === 'error' ? (
                <Button variant="ghost" size="sm">
                  Retry
                </Button>
              ) : (
                <span className="badge">28%</span>
              )
            }
          >
            <ProgressBar value={state === 'error' ? 41 : 28} error={state === 'error'} />
          </FileRow>
        </Card>

        <div className="row">
          <Button variant="ghost">Add more files</Button>
          <Button variant="ghost">Clear finished</Button>
        </div>
      </div>
    </>
  );
}
