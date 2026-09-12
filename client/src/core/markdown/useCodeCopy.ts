import { useEffect, type RefObject } from 'react';
import { attachCodeCopyButtons, handleCodeCopyClick } from './codeCopy';

/**
 * Put a copy button on every fenced code block of a rendered-markdown
 * container after each commit, and keep one delegated click listener on it
 * (PLAN-30).
 *
 * The same shape as `useMermaid` beside it, for the same reason: React re-sets
 * this subtree from `dangerouslySetInnerHTML` whenever the HTML changes, so
 * anything added to it imperatively has to be added again afterwards.
 *
 * Unlike the mermaid pass this needs no theme observer — a button carries no
 * baked-in colour, it inherits the theme's tokens from CSS like everything else.
 */
export function useCodeCopy(
  ref: RefObject<HTMLElement | null>,
  /** Re-run when the rendered HTML changes; the value itself is not read. */
  html: string,
): void {
  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    attachCodeCopyButtons(container);
    const onClick = (event: MouseEvent) => void handleCodeCopyClick(event);
    container.addEventListener('click', onClick);
    return () => container.removeEventListener('click', onClick);
  }, [ref, html]);
}
