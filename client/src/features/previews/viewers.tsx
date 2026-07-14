import { useEffect, useState } from 'react';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import { marked } from 'marked';
import { downloadUrl } from '../../core/api';
import { EmptyState } from '../../core/ui/EmptyState';
import { FileIcon } from '../../core/ui/icons';

export function ImageViewer({ id, name }: { id: string; name: string }) {
  return <img className="preview-media" src={downloadUrl(id, { inline: true })} alt={name} />;
}

export function VideoViewer({ id }: { id: string }) {
  // Seeking works because the server answers Range requests with 206s.
  return (
    <video className="preview-media" controls playsInline preload="metadata">
      <source src={downloadUrl(id, { inline: true })} />
    </video>
  );
}

export function AudioViewer({ id }: { id: string }) {
  return <audio className="preview-audio" controls src={downloadUrl(id, { inline: true })} />;
}

export function PdfViewer({ id, name }: { id: string; name: string }) {
  const src = downloadUrl(id, { inline: true });
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

function useTextContent(id: string): TextState {
  const [state, setState] = useState<TextState>({ state: 'loading' });
  useEffect(() => {
    let disposed = false;
    setState({ state: 'loading' });
    fetch(downloadUrl(id, { inline: true }))
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
  }, [id]);
  return state;
}

function TextStates({ content }: { content: TextState }) {
  return (
    <p className="caption">
      {content.state === 'loading' ? 'Reading the file…' : 'Could not load this file.'}
    </p>
  );
}

export function MarkdownViewer({ id }: { id: string }) {
  const content = useTextContent(id);
  if (content.state !== 'ready') return <TextStates content={content} />;
  // Folder contents are the owner's own files, but sanitizing is free —
  // acceptance criterion: embedded <script> renders inert.
  const html = DOMPurify.sanitize(marked.parse(content.text, { async: false }));
  return <div className="preview-markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function TextViewer({ id }: { id: string }) {
  const content = useTextContent(id);
  if (content.state !== 'ready') return <TextStates content={content} />;
  // hljs escapes the source itself; its output is markup we generated.
  const { value } = hljs.highlightAuto(content.text);
  return (
    <pre className="preview-text">
      <code dangerouslySetInnerHTML={{ __html: value }} />
    </pre>
  );
}
