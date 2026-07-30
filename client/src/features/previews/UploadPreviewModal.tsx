import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { formatBytes } from '../../core/format';
import { Button } from '../../core/ui/Button';
import { CloseIcon } from '../../core/ui/icons';
import { fetchUploadPreviewMeta } from './api';
import { PreviewBody, usePreviewMeta } from './PreviewBody';

/**
 * Preview of a file still staged in uploads/ (PLAN-17b), at
 * `/upload/:name/preview`.
 *
 * It is a route rather than local state on the Send page for the same reason
 * the downloads preview is: back closes it, and the page it opens from keeps
 * no knowledge of this feature — `features/` may not import each other, so the
 * Send page only ever renders a `<Link>` and an `<Outlet/>`.
 *
 * There is no prev/next here on purpose: the staging queue is component state
 * that vanishes on refresh, so a deep link into it has no list to walk.
 */
export function UploadPreviewModal() {
  const { name = '' } = useParams();
  const navigate = useNavigate();
  const meta = usePreviewMeta(name, fetchUploadPreviewMeta);

  const close = () => navigate('/upload');
  const src = `/api/files/${encodeURIComponent(name)}/content?inline=1`;
  const href = `/api/files/${encodeURIComponent(name)}/content`;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

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
          <Button variant="ghost" size="icon" aria-label="Close preview" onClick={close}>
            <CloseIcon size={18} />
          </Button>
        </div>

        <div className="preview-body">
          <PreviewBody state={meta} src={src} href={href} />
        </div>

        <div className="preview-footer">
          <span className="caption">
            staged on the host
            {meta.state === 'ready' ? ` · ${formatBytes(meta.meta.size)}` : ''}
          </span>
        </div>
      </div>
    </div>
  );
}
