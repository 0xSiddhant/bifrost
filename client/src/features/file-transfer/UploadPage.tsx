import { Suspense, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, KeyboardEvent } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { Button } from '../../core/ui/Button';
import { Card } from '../../core/ui/Card';
import { FileRow } from '../../core/ui/FileRow';
import { ProgressBar } from '../../core/ui/ProgressBar';
import { CheckIcon, CloseIcon, DownloadIcon, EyeIcon, PencilIcon, UploadIcon } from '../../core/ui/icons';
import { formatBytes } from '../../core/format';
import { notify } from '../../core/notify';
import { ApiError } from '../../core/api';
import {
  deleteUpload,
  fetchUploadConfig,
  publishUpload,
  uploadFile,
  UploadCancelledError,
  type UploadConfig,
  type UploadTask,
} from './api';
import { RenameUploadModal } from './RenameUploadModal';

/**
 * Staging states (PLAN-17b) continue where the transfer states stop:
 * `done` → Move → `moving` → `moved`. There is no `dismissing` state, and no
 * `setTimeout` anywhere in the exit: the confirmation dwell *and* the swipe are
 * one CSS animation, and the card is removed on its `animationend`. A timer
 * would keep counting while the tab is backgrounded and the animation would
 * not — which is precisely how a card disappears before anyone read it, or
 * lingers after the animation finished.
 */
type ItemStatus =
  | 'queued'
  | 'uploading'
  | 'done'
  | 'error'
  | 'cancelled'
  | 'moving'
  | 'moved';

interface QueueItem {
  key: number;
  file: File;
  status: ItemStatus;
  progress: number;
  error?: string;
  /** When the confirmation went up — read only by the returning-tab sweep. */
  movedAt?: number;
  /** Name in uploads/ — the handle every staging action uses. May differ from file.name. */
  storedName?: string;
  /** Where it landed in downloads/, when that differs from the name we sent. */
  publishedAs?: string;
}

const MAX_CONCURRENT_UPLOADS = 3;

/**
 * Must match `.staged--leaving`'s animation in app.css. It is not a timer —
 * the animation drives the exit — it is how the visibility sweep below knows
 * a confirmation has already had its time on screen.
 */
const EXIT_ANIMATION_MS = 2400;

/** What this file is called on the host right now. */
const displayName = (item: QueueItem): string =>
  item.publishedAs ?? item.storedName ?? item.file.name;

const STATUS_LABEL: Record<ItemStatus, string> = {
  queued: 'waiting…',
  uploading: 'crossing the bridge…',
  done: 'staged on the host',
  error: 'failed',
  cancelled: 'cancelled',
  moving: 'crossing to Downloads…',
  moved: 'you will find this in Receive',
};

/**
 * One notification per file, not per attempt: a retry that fails again
 * collapses into the same entry with a counter instead of stacking.
 */
const failed = (name: string, reason: string): void => {
  notify.error(`${name} — ${reason}`, { title: 'Upload failed', dedupeKey: `upload:${name}` });
};

export function UploadPage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [config, setConfig] = useState<UploadConfig | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [renaming, setRenaming] = useState<QueueItem | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<number | null>(null);
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
  const drop = (key: number) => setItems((prev) => prev.filter((item) => item.key !== key));

  const begin = (item: QueueItem) => {
    patch(item.key, { status: 'uploading', progress: 0, error: undefined });
    const task = uploadFile(item.file, (percent) => patch(item.key, { progress: percent }));
    tasksRef.current.set(item.key, task);
    task.promise
      .then((storedName) => patch(item.key, { status: 'done', progress: 100, storedName }))
      .catch((error: Error) => {
        if (error instanceof UploadCancelledError) {
          patch(item.key, { status: 'cancelled' });
        } else {
          patch(item.key, { status: 'error', error: error.message });
          // The row carries the retry; the banner is what reaches someone who
          // has already scrolled away or moved to another page.
          failed(item.file.name, error.message);
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

  /**
   * A *frozen* tab — Chrome's memory saver, or a phone putting the browser to
   * sleep — does not resume a paused CSS animation when it comes back, so
   * `animationend` may never arrive (found in live verification: the file was
   * safely published and the card sat there indefinitely). Coming back to the
   * page therefore sweeps any confirmation that has already outlived its
   * animation. It is a repair on return, not a timer racing the animation:
   * nothing here fires while the page is visible and the animation is running.
   */
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      const cutoff = Date.now() - EXIT_ANIMATION_MS;
      setItems((prev) =>
        prev.filter((item) => !(item.status === 'moved' && (item.movedAt ?? 0) <= cutoff)),
      );
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const addFiles = (files: FileList | File[]) => {
    const maxBytes = config ? config.maxUploadSizeMb * 1024 * 1024 : null;
    const additions: QueueItem[] = [...files].map((file) => {
      const key = nextKeyRef.current++;
      const ext = `.${file.name.toLowerCase().split('.').pop() ?? ''}`;
      if (maxBytes !== null && file.size > maxBytes) {
        const reason = `larger than the ${formatBytes(maxBytes)} limit — not sent`;
        failed(file.name, reason);
        return { key, file, status: 'error', progress: 0, error: reason };
      }
      if (config?.blockedExtensions.includes(ext)) {
        const reason = 'this file type is blocked';
        failed(file.name, reason);
        return { key, file, status: 'error', progress: 0, error: reason };
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

  /**
   * Every staging action can lose a race with another tab, a double tap, or the
   * back button. 404 and 409 are answers, not crashes: the card says what
   * happened and the queue stops lying about a file that is no longer there.
   */
  const staleCard = (item: QueueItem, error: unknown, action: string): void => {
    const name = displayName(item);
    if (error instanceof ApiError && error.status === 404) {
      notify.info(`${name} is no longer staged — it was already moved or deleted`);
      drop(item.key);
      return;
    }
    if (error instanceof ApiError && error.status === 409) {
      notify.info(`${name} is already on its way to Downloads`);
      return;
    }
    const reason = error instanceof Error ? error.message : 'unknown error';
    notify.error(`Could not ${action} ${name} — ${reason}`, {
      dedupeKey: `staging:${action}:${name}`,
    });
  };

  const move = (item: QueueItem) => {
    if (!item.storedName) return;
    patch(item.key, { status: 'moving' });
    publishUpload(item.storedName)
      .then(({ finalName, renamed }) => {
        patch(item.key, {
          status: 'moved',
          publishedAs: renamed ? finalName : undefined,
          storedName: undefined,
          movedAt: Date.now(),
        });
      })
      .catch((error: unknown) => {
        patch(item.key, { status: 'done' });
        staleCard(item, error, 'move');
      });
  };

  const remove = (item: QueueItem) => {
    if (!item.storedName) return;
    setConfirmingDelete(null);
    deleteUpload(item.storedName)
      .then(() => drop(item.key))
      .catch((error: unknown) => staleCard(item, error, 'delete'));
  };

  const hasSettled = items.some((item) =>
    ['done', 'error', 'cancelled'].includes(item.status),
  );

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">midgard → asgard</span>
          <h2>Send files</h2>
          <p>
            Files land in a staging area on the host. Move one to Downloads and everyone on the
            bridge can take it; rename or delete it while it is still yours.
          </p>
        </div>
      </div>

      <div className="stack">
        <div
          className={dragActive ? 'dropzone dropzone--active' : 'dropzone'}
          role="button"
          tabIndex={0}
          aria-label="Choose files to upload"
          onClick={() => inputRef.current?.click()}
          onKeyDown={(event: KeyboardEvent) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragOver={(event: DragEvent) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(event: DragEvent) => {
            event.preventDefault();
            setDragActive(false);
            addFiles(event.dataTransfer.files);
          }}
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
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              if (event.target.files) addFiles(event.target.files);
              event.target.value = '';
            }}
            aria-hidden="true"
            tabIndex={-1}
          />
        </div>

        {items.length > 0 && (
          <Card>
            {items.map((item) => (
              <div
                key={item.key}
                className={item.status === 'moved' ? 'staged staged--leaving' : 'staged'}
                // The whole exit — hold the confirmation, then swipe — is this
                // one animation, so removal cannot desync from what is on
                // screen. Reduced motion swaps in a still animation of the same
                // length: it must remain *an* animation, or this never fires.
                onAnimationEnd={() => {
                  if (item.status === 'moved') drop(item.key);
                }}
              >
                <FileRow
                  // The host's name, not the one the browser picked it up
                  // under: a rename (or a collision suffix) changes what this
                  // card is about, and a stale label makes the next action
                  // look like it is acting on a different file.
                  name={displayName(item)}
                  size={formatBytes(item.file.size)}
                  time={
                    item.status === 'moved' && item.publishedAs
                      ? `saved as ${item.publishedAs}`
                      : STATUS_LABEL[item.status]
                  }
                  aside={
                    <ItemAside
                      item={item}
                      confirming={confirmingDelete === item.key}
                      onCancel={cancel}
                      onRetry={retry}
                      onMove={move}
                      onRename={setRenaming}
                      onAskDelete={() => setConfirmingDelete(item.key)}
                      onConfirmDelete={remove}
                      onDismissDelete={() => setConfirmingDelete(null)}
                    />
                  }
                >
                  {(item.status === 'uploading' || item.status === 'error') && (
                    <ProgressBar
                      value={item.progress}
                      error={item.status === 'error'}
                      label={`${item.file.name} upload progress`}
                    />
                  )}
                  {confirmingDelete === item.key && (
                    <p className="caption staged__confirm">
                      Delete <strong>{displayName(item)}</strong> from the host? This cannot be
                      undone.
                    </p>
                  )}
                </FileRow>
              </div>
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

      {renaming?.storedName && (
        <RenameUploadModal
          storedName={renaming.storedName}
          onClose={() => setRenaming(null)}
          onRenamed={(finalName, renamed) => {
            patch(renaming.key, { storedName: finalName });
            if (renamed) {
              // Only the person who renamed it hears about the collision.
              notify.info(`That name was taken — saved as ${finalName}`);
            }
            setRenaming(null);
          }}
        />
      )}

      {/* Preview modal route (/upload/:name/preview) renders here. */}
      <Suspense fallback={null}>
        <Outlet />
      </Suspense>
    </>
  );
}

function ItemAside({
  item,
  confirming,
  onCancel,
  onRetry,
  onMove,
  onRename,
  onAskDelete,
  onConfirmDelete,
  onDismissDelete,
}: {
  item: QueueItem;
  confirming: boolean;
  onCancel: (item: QueueItem) => void;
  onRetry: (item: QueueItem) => void;
  onMove: (item: QueueItem) => void;
  onRename: (item: QueueItem) => void;
  onAskDelete: () => void;
  onConfirmDelete: (item: QueueItem) => void;
  onDismissDelete: () => void;
}) {
  switch (item.status) {
    case 'done':
      if (confirming) {
        return (
          <span className="row">
            <Button variant="danger" size="sm" onClick={() => onConfirmDelete(item)}>
              Delete
            </Button>
            <Button variant="ghost" size="sm" onClick={onDismissDelete}>
              Keep
            </Button>
          </span>
        );
      }
      return (
        <span className="row staged__actions">
          <Button variant="ghost" size="sm" onClick={() => onMove(item)}>
            <DownloadIcon size={14} /> Move
          </Button>
          <Link
            className="btn btn--ghost btn--icon"
            to={`${encodeURIComponent(displayName(item))}/preview`}
            aria-label={`Preview ${displayName(item)}`}
          >
            <EyeIcon size={16} />
          </Link>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Rename ${displayName(item)}`}
            onClick={() => onRename(item)}
          >
            <PencilIcon size={16} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Delete ${displayName(item)}`}
            onClick={onAskDelete}
          >
            <CloseIcon size={16} />
          </Button>
        </span>
      );
    // Every action is gone while the move is in flight, so delete-during-move
    // cannot race it.
    case 'moving':
      return <span className="badge">moving…</span>;
    case 'moved':
      return (
        <span className="badge badge--ok">
          <CheckIcon size={12} /> moved
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
