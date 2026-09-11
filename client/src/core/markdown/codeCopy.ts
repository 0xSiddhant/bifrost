import { copyText } from '../copy';
import { log } from '../log';

/**
 * A copy button on every fenced code block of a rendered-markdown container
 * (PLAN-30).
 *
 * Shaped after the mermaid pass next door: an imperative DOM walk run after
 * the markdown has been committed, rather than anything the pure renderer in
 * `render.ts` could do — that function stays a string → string function, and a
 * button that has to talk to the clipboard is not markup you can sanitize into
 * existence.
 *
 * The feedback is the clipboard → checkmark, 1.5-second icon swap Pensieve's
 * curl button and Portkey's copy-link already use, so this is a third use of a
 * proven interaction rather than a new one.
 */

/** Marks a `<pre>` whose button already exists, so a re-run adds no second one. */
const DONE_ATTR = 'data-copy-attached';

/** How long the checkmark stays up — Pensieve's and Portkey's own 1.5s. */
export const COPIED_FEEDBACK_MS = 1500;

const SVG_OPEN =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';

/** `ClipboardIcon` and `CheckIcon` from core/ui/icons, as markup. */
const CLIPBOARD_SVG = `${SVG_OPEN}<rect x="6" y="4" width="12" height="16" rx="2"/><path d="M9 4.5V3h6v1.5M9.5 10h5M9.5 14h5"/></svg>`;
const CHECK_SVG = `${SVG_OPEN}<path d="m5 13 4 4L19 7"/></svg>`;

/**
 * The blocks that get a button: a `<pre>` whose first child is a `<code>`.
 *
 * That shape is exactly what `render.ts` emits for a real fence, and it is
 * deliberately narrower than "every `<pre>`" — a mermaid placeholder
 * (`<pre class="mermaid-src">`) and the `<pre>` inside a mermaid error figure
 * both hold bare text with no `<code>`, and neither is source anyone wants on
 * their clipboard. Wrapping a placeholder would also break the mermaid pass,
 * which replaces the `<pre>` node itself.
 */
function copyableBlocks(container: HTMLElement): HTMLPreElement[] {
  return Array.from(container.querySelectorAll('pre')).filter(
    (pre) => pre.firstElementChild?.tagName === 'CODE' && !pre.hasAttribute(DONE_ATTR),
  );
}

/**
 * Inject one copy button per un-processed fenced block.
 *
 * Each `<pre>` is wrapped in a positioned container rather than holding the
 * button itself: a `<pre>` scrolls horizontally, and a button inside it would
 * slide out of view with the code.
 *
 * Idempotent — the marker attribute means a second call over the same
 * container is a no-op, which matters because the hook re-runs on every commit.
 */
export function attachCodeCopyButtons(container: HTMLElement): void {
  for (const pre of copyableBlocks(container)) {
    pre.setAttribute(DONE_ATTR, '');

    const wrapper = document.createElement('div');
    wrapper.className = 'md-codeblock';
    pre.replaceWith(wrapper);
    wrapper.append(pre);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'md-copy';
    button.setAttribute('aria-label', 'Copy code');
    button.innerHTML = CLIPBOARD_SVG;
    wrapper.append(button);
  }
}

/**
 * Handle a click anywhere in the container, copying the owning block's source.
 *
 * One delegated listener rather than one per button: the buttons are recreated
 * from scratch every time React re-sets the container's `innerHTML`, so a
 * per-button listener would have to be re-bound on every keystroke in Edda.
 *
 * The text comes from the `<code>` element's `textContent`, which is the raw
 * source — highlight.js's `<span>`s contribute no text of their own, so what
 * lands on the clipboard is what was typed in the fence, not the markup.
 */
export async function handleCodeCopyClick(event: MouseEvent): Promise<void> {
  const target = event.target as Element | null;
  const button = target?.closest?.('.md-copy');
  if (!(button instanceof HTMLButtonElement)) return;

  const code = button.parentElement?.querySelector('pre > code');
  if (!code) {
    // Not silent: the button only exists because a `<pre><code>` was wrapped a
    // moment ago, so losing it means the DOM was rewritten underneath us.
    log.warn('markdown: a copy button found no code block to copy', { module: 'markdown' });
    return;
  }

  if (!(await copyText(code.textContent ?? ''))) {
    log.warn('markdown: the clipboard write for a code block failed', { module: 'markdown' });
    return;
  }

  button.innerHTML = CHECK_SVG;
  button.setAttribute('aria-label', 'Copied');
  window.setTimeout(() => {
    // The container may have been re-rendered in the meantime, which discards
    // this button entirely; writing to a detached node is harmless.
    button.innerHTML = CLIPBOARD_SVG;
    button.setAttribute('aria-label', 'Copy code');
  }, COPIED_FEEDBACK_MS);
}
