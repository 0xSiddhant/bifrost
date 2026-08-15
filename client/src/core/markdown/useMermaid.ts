import { useEffect, useState, type RefObject } from 'react';
import { renderMermaidIn } from './mermaid';

/**
 * Run the mermaid pass over a rendered-markdown container after every commit,
 * and again whenever the theme changes (PLAN-20).
 *
 * Every markdown surface needs exactly this, and they live in two different
 * features, so it belongs beside the pass rather than in either of them.
 *
 * The theme half uses the `<html data-theme>` observer the QrCard established:
 * mermaid bakes colours into the SVG, so a diagram drawn in Aurora would stay
 * dark in Daybreak. The pass itself decides what actually needs redrawing —
 * a container with no diagram in it never imports mermaid at all.
 */
export function useMermaidDiagrams(
  ref: RefObject<HTMLElement | null>,
  /** Re-run when the rendered HTML changes; the value itself is not read. */
  html: string,
  module?: string,
): void {
  const [themeTick, setThemeTick] = useState(0);

  useEffect(() => {
    const observer = new MutationObserver(() => setThemeTick((tick) => tick + 1));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!ref.current) return;
    // The container is handed over as a getter, not as a node: React owns this
    // subtree and re-sets it from `dangerouslySetInnerHTML` on its own
    // schedule, so a pass that resolved the node before its awaits could end up
    // swapping diagrams into a subtree that had already been discarded. No
    // cancellation is needed on top of that — the pass reads the container
    // again at the moment it swaps, so a late pass is a no-op, not a wrong
    // write. (The caller must also memoize its `__html` object; see
    // MarkdownPreview for why that is not optional.)
    void renderMermaidIn(() => ref.current, { module });
  }, [ref, html, themeTick, module]);
}
