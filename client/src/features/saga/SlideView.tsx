import { useMemo, useRef } from 'react';
import { renderMarkdown, useMermaidDiagrams } from '../../core/markdown';

/**
 * One slide (PLAN-28).
 *
 * Saga is the fourth consumer of `core/markdown`'s one pipeline, so a slide is
 * rendered by exactly the function Edda's live preview, public page and export
 * already use — including its DOMPurify pass, which is what makes an arbitrary
 * `?source=` no worse than any other document this app renders.
 *
 * `features/edda/MarkdownPreview` does the same job and is deliberately *not*
 * reused: a feature may not import another feature. The one thing worth
 * carrying over from it is the memoized `__html` object — React compares that
 * prop by identity, so an inline literal re-sets `innerHTML` on every render
 * and throws away the mermaid diagrams the pass just swapped in.
 */
export function SlideView({ markdown }: { markdown: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(() => renderMarkdown(markdown), [markdown]);
  useMermaidDiagrams(ref, html, 'saga');
  const markup = useMemo(() => ({ __html: html }), [html]);

  return (
    <div className="saga-slide">
      <div ref={ref} className="md-preview saga-slide__body" dangerouslySetInnerHTML={markup} />
    </div>
  );
}
