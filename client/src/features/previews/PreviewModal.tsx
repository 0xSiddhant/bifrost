import { useEffect } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { downloadUrl, type DownloadEntry } from '../../core/api';
import { formatBytes } from '../../core/format';
import { Button } from '../../core/ui/Button';
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, DownloadIcon } from '../../core/ui/icons';
import { fetchPreviewMeta } from './api';
import { PreviewBody, usePreviewMeta } from './PreviewBody';

interface DownloadsContext {
  entries: DownloadEntry[];
}

/**
 * Modal route (/downloads/:id/preview): deep links work, back closes, and
 * arrow keys walk the sibling list the downloads page passes via Outlet
 * context.
 */
export function PreviewModal() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { entries } = useOutletContext<DownloadsContext>();
  const meta = usePreviewMeta(id, fetchPreviewMeta);

  const index = entries.findIndex((entry) => entry.id === id);
  const previous = index > 0 ? entries[index - 1] : undefined;
  const next = index >= 0 && index < entries.length - 1 ? entries[index + 1] : undefined;
  const fallbackName = index >= 0 ? entries[index]?.name : undefined;

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
          <PreviewBody
            state={meta}
            src={downloadUrl(id, { inline: true })}
            href={downloadUrl(id)}
          />
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
