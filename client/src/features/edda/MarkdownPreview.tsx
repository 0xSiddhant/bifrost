import { forwardRef } from 'react';

/**
 * Renders already-sanitized HTML from `renderMarkdown` into the themed preview
 * surface. The caller owns the render (debounce/rAF/manual-mode budget lives in
 * EddaPage); this is purely the presentation shell, shared by the live preview
 * and the public preview page so they look identical.
 */
export const MarkdownPreview = forwardRef<HTMLDivElement, { html: string; className?: string }>(
  function MarkdownPreview({ html, className }, ref) {
    return (
      <div
        ref={ref}
        className={`md-preview${className ? ` ${className}` : ''}`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  },
);
