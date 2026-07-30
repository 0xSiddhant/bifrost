import { useEffect, useState } from 'react';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import { marked } from 'marked';
import { EmptyState } from '../../core/ui/EmptyState';
import { FileIcon } from '../../core/ui/icons';

/**
 * Viewers take the inline content URL, not an id: since PLAN-17b the same
 * viewers render a staged upload (`/api/files/:name/content`) as well as a
 * download (`/api/downloads/:id/content`), and the modal is the only thing
 * that needs to know which is which.
 */
export function ImageViewer({ src, name }: { src: string; name: string }) {
  return <img className="preview-media" src={src} alt={name} />;
}

export function VideoViewer({ src }: { src: string }) {
  // Seeking works because the server answers Range requests with 206s.
  return (
    <video className="preview-media" controls playsInline preload="metadata">
      <source src={src} />
    </video>
  );
}

export function AudioViewer({ src }: { src: string }) {
  return <audio className="preview-audio" controls src={src} />;
}

export function PdfViewer({ src, name }: { src: string; name: string }) {
  return (
    <object className="preview-pdf" data={src} type="application/pdf" aria-label={name}>
      <EmptyState
        icon={<FileIcon size={28} />}
        title="This browser won't embed PDFs"
        action={
          <a className="btn btn--primary" href={src} target="_blank" rel="noreferrer">
            Open in a new tab
          </a>
        }
      />
    </object>
  );
}

type TextState = { state: 'loading' } | { state: 'error' } | { state: 'ready'; text: string };

function useTextContent(src: string): TextState {
  const [state, setState] = useState<TextState>({ state: 'loading' });
  useEffect(() => {
    let disposed = false;
    setState({ state: 'loading' });
    fetch(src)
      .then((response) => {
        if (!response.ok) throw new Error(`fetch failed: ${response.status}`);
        return response.text();
      })
      .then((text) => {
        if (!disposed) setState({ state: 'ready', text });
      })
      .catch(() => {
        if (!disposed) setState({ state: 'error' });
      });
    return () => {
      disposed = true;
    };
  }, [src]);
  return state;
}

function TextStates({ content }: { content: TextState }) {
  return (
    <p className="caption">
      {content.state === 'loading' ? 'Reading the file…' : 'Could not load this file.'}
    </p>
  );
}

export function MarkdownViewer({ src }: { src: string }) {
  const content = useTextContent(src);
  if (content.state !== 'ready') return <TextStates content={content} />;
  // Folder contents are the owner's own files, but sanitizing is free —
  // acceptance criterion: embedded <script> renders inert.
  const html = DOMPurify.sanitize(marked.parse(content.text, { async: false }));
  return <div className="preview-markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function TextViewer({ src }: { src: string }) {
  const content = useTextContent(src);
  if (content.state !== 'ready') return <TextStates content={content} />;
  // hljs escapes the source itself; its output is markup we generated.
  const { value } = hljs.highlightAuto(content.text);
  return (
    <pre className="preview-text">
      <code dangerouslySetInnerHTML={{ __html: value }} />
    </pre>
  );
}
