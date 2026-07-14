import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { downloadUrl, type DownloadEntry } from '../../core/api';
import { formatBytes } from '../../core/format';
import { Button } from '../../core/ui/Button';
import { EmptyState } from '../../core/ui/EmptyState';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  DownloadIcon,
  FileIcon,
} from '../../core/ui/icons';
import { fetchPreviewMeta, type PreviewMeta } from './api';
import {
  AudioViewer,
  ImageViewer,
  MarkdownViewer,
  PdfViewer,
  TextViewer,
  VideoViewer,
} from './viewers';

interface DownloadsContext {
  entries: DownloadEntry[];
}

type MetaState = { state: 'loading' } | { state: 'missing' } | { state: 'ready'; meta: PreviewMeta };

/**
 * Modal route (/downloads/:id/preview): deep links work, back closes, and
 * arrow keys walk the sibling list the downloads page passes via Outlet
 * context.
 */
export function PreviewModal() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { entries } = useOutletContext<DownloadsContext>();
  const [meta, setMeta] = useState<MetaState>({ state: 'loading' });

  const index = entries.findIndex((entry) => entry.id === id);
  const previous = index > 0 ? entries[index - 1] : undefined;
  const next = index >= 0 && index < entries.length - 1 ? entries[index + 1] : undefined;
  const fallbackName = index >= 0 ? entries[index]?.name : undefined;

  useEffect(() => {
    let disposed = false;
    setMeta({ state: 'loading' });
    fetchPreviewMeta(id)
      .then((loaded) => {
        if (!disposed) setMeta({ state: 'ready', meta: loaded });
      })
      .catch(() => {
        if (!disposed) setMeta({ state: 'missing' });
      });
    return () => {
      disposed = true;
    };
  }, [id]);

  const close = () => navigate('/downloads');
  const goTo = (entry: DownloadEntry | undefined) => {
    if (entry) navigate(`/downloads/${entry.id}/preview`, { replace: true });
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
      if (event.key === 'ArrowLeft') goTo(previous);
      if (event.key === 'ArrowRight') goTo(next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const name = meta.state === 'ready' ? meta.meta.name : (fallbackName ?? 'Preview');

  return (
    <div className="modal-scrim" onClick={close}>
      <div
        className="modal modal--preview"
        role="dialog"
        aria-modal="true"
        aria-label={`Preview of ${name}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal__head">
          <h3 className="preview-title">{name}</h3>
          <span className="row">
            <a
              className="btn btn--ghost btn--icon"
              href={downloadUrl(id)}
              download={name}
              aria-label={`Download ${name}`}
            >
              <DownloadIcon size={18} />
            </a>
            <Button variant="ghost" size="icon" aria-label="Close preview" onClick={close}>
              <CloseIcon size={18} />
            </Button>
          </span>
        </div>

        <div className="preview-body">
          <PreviewContent id={id} state={meta} />
        </div>

        <div className="preview-footer">
          <Button
            variant="ghost"
            size="sm"
            disabled={!previous}
            onClick={() => goTo(previous)}
            aria-label="Previous file"
          >
            <ChevronLeftIcon size={16} /> Prev
          </Button>
          <span className="caption">
            {index >= 0 ? `${index + 1} / ${entries.length}` : ''}
            {meta.state === 'ready' ? ` · ${formatBytes(meta.meta.size)}` : ''}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={!next}
            onClick={() => goTo(next)}
            aria-label="Next file"
          >
            Next <ChevronRightIcon size={16} />
          </Button>
        </div>
      </div>
    </div>
  );
}

function PreviewContent({ id, state }: { id: string; state: MetaState }) {
  if (state.state === 'loading') return <p className="caption">Divining the file kind…</p>;
  if (state.state === 'missing') {
    return (
      <EmptyState
        icon={<FileIcon size={28} />}
        title="This file is gone"
        hint="It may have been moved or deleted on the host."
      />
    );
  }
  const { meta } = state;
  if (!meta.previewable) {
    return (
      <EmptyState
        icon={<FileIcon size={28} />}
        title="No preview for this one"
        hint={
          meta.kind === 'none'
            ? 'This file type can only be downloaded.'
            : 'Too large to preview — download it instead.'
        }
        action={
          <a className="btn btn--primary" href={downloadUrl(id)} download={meta.name}>
            Download {formatBytes(meta.size)}
          </a>
        }
      />
    );
  }
  switch (meta.kind) {
    case 'image':
      return <ImageViewer id={id} name={meta.name} />;
    case 'video':
      return <VideoViewer id={id} />;
    case 'audio':
      return <AudioViewer id={id} />;
    case 'pdf':
      return <PdfViewer id={id} name={meta.name} />;
    case 'markdown':
      return <MarkdownViewer id={id} />;
    default:
      return <TextViewer id={id} />;
  }
}
