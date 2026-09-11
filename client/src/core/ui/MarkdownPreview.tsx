import { forwardRef, useCallback, useMemo, useRef } from 'react';
import { useMermaidDiagrams } from '../markdown';

/**
 * Renders already-sanitized HTML from `renderMarkdown` into the themed preview
 * surface. The caller owns the render (debounce/rAF/manual-mode budget lives in
 * EddaPage); this is purely the presentation shell, shared by the live preview
 * and the public preview page so they look identical.
 *
 * It also owns the mermaid pass (PLAN-20) — every surface that mounts this
 * gets it, which is what keeps them from drifting apart on diagrams the way
 * they never have on anything else.
 *
 * It lives in `core/ui/` since PLAN-30 rather than in `features/edda/`, where
 * it started: the guide panel is a third consumer, and `core/` reaching into a
 * feature to render its own drawer would have the dependency backwards.
 */
export const MarkdownPreview = forwardRef<
  HTMLDivElement,
  { html: string; className?: string; module?: string }
>(function MarkdownPreview({ html, className, module = 'edda' }, ref) {
  const innerRef = useRef<HTMLDivElement>(null);
  // The pass needs the node; the parent needs it too (scroll sync, anchors).
  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      innerRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );
  useMermaidDiagrams(innerRef, html, module);

  // Memoized, and it is load-bearing rather than a micro-optimisation: React
  // compares this prop **by object identity**, so an inline `{ __html }`
  // literal makes it re-set innerHTML on every re-render of EddaPage — which
  // is once per keystroke, via the stats/outline/byte-count state. That
  // silently threw away the rendered diagrams a moment after the pass swapped
  // them in, and it was re-parsing the whole document each time anyway.
  const markup = useMemo(() => ({ __html: html }), [html]);

  return (
    <div
      ref={setRefs}
      className={`md-preview${className ? ` ${className}` : ''}`}
      dangerouslySetInnerHTML={markup}
    />
  );
});
