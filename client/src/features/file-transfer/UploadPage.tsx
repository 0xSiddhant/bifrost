import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, KeyboardEvent } from 'react';
import { Button } from '../../core/ui/Button';
import { Card } from '../../core/ui/Card';
import { FileRow } from '../../core/ui/FileRow';
import { ProgressBar } from '../../core/ui/ProgressBar';
import { Toast } from '../../core/ui/Toast';
import { CheckIcon, UploadIcon } from '../../core/ui/icons';
import { formatBytes } from '../../core/format';
import {
  fetchUploadConfig,
  uploadFile,
  UploadCancelledError,
  type UploadConfig,
  type UploadTask,
} from './api';

type ItemStatus = 'queued' | 'uploading' | 'done' | 'error' | 'cancelled';

interface QueueItem {
  key: number;
  file: File;
  status: ItemStatus;
  progress: number;
  error?: string;
}

const MAX_CONCURRENT_UPLOADS = 3;

const STATUS_LABEL: Record<ItemStatus, string> = {
  queued: 'waiting…',
  uploading: 'crossing the bridge…',
  done: 'landed in the vault',
  error: 'failed',
  cancelled: 'cancelled',
};

export function UploadPage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [config, setConfig] = useState<UploadConfig | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const tasksRef = useRef(new Map<number, UploadTask>());
  const startedRef = useRef(new Set<number>());
  const nextKeyRef = useRef(1);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let disposed = false;
    fetchUploadConfig()
      .then((cfg) => {
        if (!disposed) setConfig(cfg);
      })
      .catch(() => {
        // Server-side enforcement still applies; the UI just loses pre-checks.
      });
    return () => {
      disposed = true;
    };
  }, []);

  const patch = (key: number, partial: Partial<QueueItem>) => {
    setItems((prev) => prev.map((item) => (item.key === key ? { ...item, ...partial } : item)));
  };

  const begin = (item: QueueItem) => {
    patch(item.key, { status: 'uploading', progress: 0, error: undefined });
    const task = uploadFile(item.file, (percent) => patch(item.key, { progress: percent }));
    tasksRef.current.set(item.key, task);
    task.promise
      .then(() => patch(item.key, { status: 'done', progress: 100 }))
      .catch((error: Error) => {
        if (error instanceof UploadCancelledError) {
          patch(item.key, { status: 'cancelled' });
        } else {
          patch(item.key, { status: 'error', error: error.message });
        }
      })
      .finally(() => tasksRef.current.delete(item.key));
  };

  // Upload pump: whenever the queue changes, fill free slots with waiting files.
  useEffect(() => {
    const uploading = items.filter((item) => item.status === 'uploading').length;
    const waiting = items.filter(
      (item) => item.status === 'queued' && !startedRef.current.has(item.key),
    );
    for (const item of waiting.slice(0, Math.max(0, MAX_CONCURRENT_UPLOADS - uploading))) {
      startedRef.current.add(item.key);
      begin(item);
    }
  });

  const addFiles = (files: FileList | File[]) => {
    const maxBytes = config ? config.maxUploadSizeMb * 1024 * 1024 : null;
    const additions: QueueItem[] = [...files].map((file) => {
      const key = nextKeyRef.current++;
      const ext = `.${file.name.toLowerCase().split('.').pop() ?? ''}`;
      if (maxBytes !== null && file.size > maxBytes) {
        return {
          key,
          file,
          status: 'error',
          progress: 0,
          error: `larger than the ${formatBytes(maxBytes)} limit — not sent`,
        };
      }
      if (config?.blockedExtensions.includes(ext)) {
        return { key, file, status: 'error', progress: 0, error: 'this file type is blocked' };
      }
      return { key, file, status: 'queued', progress: 0 };
    });
    if (additions.length > 0) setItems((prev) => [...prev, ...additions]);
  };

  const cancel = (item: QueueItem) => {
    const task = tasksRef.current.get(item.key);
    if (task) {
      task.cancel(); // status flips via the promise rejection
    } else {
      patch(item.key, { status: 'cancelled' });
    }
  };

  const retry = (item: QueueItem) => {
    startedRef.current.delete(item.key);
    patch(item.key, { status: 'queued', progress: 0, error: undefined });
  };

  const clearSettled = () => {
    setItems((prev) =>
      prev.filter((item) => item.status === 'queued' || item.status === 'uploading'),
    );
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragActive(false);
    addFiles(event.dataTransfer.files);
  };

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) addFiles(event.target.files);
    event.target.value = '';
  };

  const onDropzoneKey = (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      inputRef.current?.click();
    }
  };

  const firstError = items.find((item) => item.status === 'error');
  const hasSettled = items.some(
    (item) => item.status === 'done' || item.status === 'error' || item.status === 'cancelled',
  );

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">midgard → asgard</span>
          <h2>Send files</h2>
          <p>Files land in a write-only vault on the host — nothing here can be read back.</p>
        </div>
      </div>

      <div className="stack">
        <div
          className={dragActive ? 'dropzone dropzone--active' : 'dropzone'}
          role="button"
          tabIndex={0}
          aria-label="Choose files to upload"
          onClick={() => inputRef.current?.click()}
          onKeyDown={onDropzoneKey}
          onDragOver={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={onDrop}
        >
          <UploadIcon size={32} />
          <strong>Drop files here or tap to browse</strong>
          <span className="caption">
            {config
              ? `Up to ${config.maxFilesPerUpload} files · ${formatBytes(config.maxUploadSizeMb * 1024 * 1024)} each · straight over your Wi-Fi`
              : 'Straight over your Wi-Fi — no cloud in between'}
          </span>
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            onChange={onPick}
            aria-hidden="true"
            tabIndex={-1}
          />
        </div>

        {firstError && (
          <Toast kind="danger">
            {firstError.file.name} failed — {firstError.error ?? 'unknown error'}
          </Toast>
        )}

        {items.length > 0 && (
          <Card>
            {items.map((item) => (
              <FileRow
                key={item.key}
                name={item.file.name}
                size={formatBytes(item.file.size)}
                time={STATUS_LABEL[item.status]}
                aside={<ItemAside item={item} onCancel={cancel} onRetry={retry} />}
              >
                {(item.status === 'uploading' || item.status === 'error') && (
                  <ProgressBar
                    value={item.progress}
                    error={item.status === 'error'}
                    label={`${item.file.name} upload progress`}
                  />
                )}
              </FileRow>
            ))}
          </Card>
        )}

        <div className="row">
          <Button variant="ghost" onClick={() => inputRef.current?.click()}>
            Add more files
          </Button>
          {hasSettled && (
            <Button variant="ghost" onClick={clearSettled}>
              Clear finished
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

function ItemAside({
  item,
  onCancel,
  onRetry,
}: {
  item: QueueItem;
  onCancel: (item: QueueItem) => void;
  onRetry: (item: QueueItem) => void;
}) {
  switch (item.status) {
    case 'done':
      return (
        <span className="badge badge--ok">
          <CheckIcon size={12} /> done
        </span>
      );
    case 'uploading':
      return (
        <span className="row">
          <span className="badge">{Math.floor(item.progress)}%</span>
          <Button variant="ghost" size="sm" onClick={() => onCancel(item)}>
            Cancel
          </Button>
        </span>
      );
    case 'queued':
      return (
        <Button variant="ghost" size="sm" onClick={() => onCancel(item)}>
          Cancel
        </Button>
      );
    case 'error':
    case 'cancelled':
      return (
        <span className="row">
          {item.status === 'error' && <span className="badge badge--danger">failed</span>}
          <Button variant="ghost" size="sm" onClick={() => onRetry(item)}>
            Retry
          </Button>
        </span>
      );
  }
}
