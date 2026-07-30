import { useEffect, useState } from 'react';
import { formatBytes } from '../../core/format';
import { EmptyState } from '../../core/ui/EmptyState';
import { FileIcon } from '../../core/ui/icons';
import type { PreviewMeta } from './api';
import {
  AudioViewer,
  ImageViewer,
  MarkdownViewer,
  PdfViewer,
  TextViewer,
  VideoViewer,
} from './viewers';

export type MetaState =
  | { state: 'loading' }
  | { state: 'missing' }
  | { state: 'ready'; meta: PreviewMeta };

/**
 * Fetch preview metadata for whatever `key` addresses — a download id or a
 * staged upload's name. The fetcher is passed in so this file needs to know
 * nothing about which folder the file lives in.
 */
export function usePreviewMeta(key: string, fetcher: (key: string) => Promise<PreviewMeta>) {
  const [meta, setMeta] = useState<MetaState>({ state: 'loading' });
  useEffect(() => {
    let disposed = false;
    setMeta({ state: 'loading' });
    fetcher(key)
      .then((loaded) => {
        if (!disposed) setMeta({ state: 'ready', meta: loaded });
      })
      .catch(() => {
        // Deleted, moved, or never there — the empty state says so, and the
        // server has already logged which of the three it was.
        if (!disposed) setMeta({ state: 'missing' });
      });
    return () => {
      disposed = true;
    };
    // Callers pass a module-level function, so `fetcher` is stable and this
    // re-runs only when the file being previewed changes.
  }, [key, fetcher]);
  return meta;
}

/**
 * The rendered file itself. Shared by the downloads modal and the staged-upload
 * modal (PLAN-17b) — the two differ only in which URLs they hand over.
 */
export function PreviewBody({
  state,
  src,
  href,
}: {
  state: MetaState;
  /** Inline content URL, for the viewers. */
  src: string;
  /** Attachment URL, for the download fallback. */
  href: string;
}) {
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
          <a className="btn btn--primary" href={href} download={meta.name}>
            Download {formatBytes(meta.size)}
          </a>
        }
      />
    );
  }

  switch (meta.kind) {
    case 'image':
      return <ImageViewer src={src} name={meta.name} />;
    case 'video':
      return <VideoViewer src={src} />;
    case 'audio':
      return <AudioViewer src={src} />;
    case 'pdf':
      return <PdfViewer src={src} name={meta.name} />;
    case 'markdown':
      return <MarkdownViewer src={src} />;
    case 'text':
      return <TextViewer src={src} />;
    case 'none':
      return null;
  }
}
