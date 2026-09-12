import { log } from '../../core/log';

/**
 * PDF export (PLAN-20) — print the generated standalone document in a hidden
 * iframe, never the app page.
 *
 * A print stylesheet over the live page would mean hiding the header, bottom
 * nav, sky relics, the Nótt overlay, the editor pane, the toolbar, the outline
 * rail and the divider: a dozen `@media print` overrides that rot silently
 * every time the shell changes, with nothing failing loudly when one is missed.
 * The export document already *is* the clean representation, so printing it
 * makes `.html` and `.pdf` the same artifact — and it removes the async race
 * structurally, because the string handed in here already has its diagrams
 * inlined. There is no "wait for every diagram before calling print()".
 *
 * Browsers name the saved PDF after the document's `<title>`, which the export
 * sets to the edda's name.
 */

/**
 * Fallback removal, because `afterprint` is not reliably delivered in every
 * browser and one leaked iframe per export is a real leak. The timer starts
 * *after* `print()` returns — it blocks on the dialog in every desktop browser,
 * so this cannot fire out from under an open print preview.
 */
export const PRINT_CLEANUP_MS = 20_000;

/** `cleanupMs` is a seam so the fallback can be proven in a test in ms. */
export async function printHtmlDocument(
  html: string,
  cleanupMs: number = PRINT_CLEANUP_MS,
): Promise<void> {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.title = 'Print preview';
  // Off-screen rather than display:none — a frame with no box does not always
  // have a printable document. A4-shaped so its layout matches the paper.
  frame.style.cssText =
    'position:fixed;left:-10000px;top:0;width:210mm;height:297mm;border:0;opacity:0;';
  frame.srcdoc = html;

  const loaded = new Promise<void>((resolve) => {
    frame.addEventListener('load', () => resolve(), { once: true });
  });
  document.body.append(frame);
  await loaded;

  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    frame.remove();
  };

  const view = frame.contentWindow;
  if (!view) {
    remove();
    throw new Error('the print frame has no document');
  }

  try {
    view.addEventListener('afterprint', remove, { once: true });
    view.focus();
    view.print();
  } catch (error) {
    remove();
    throw error;
  }
  window.setTimeout(remove, cleanupMs);
}

/** Build-then-print, with the one failure path this feature can actually hit. */
export async function printDocument(html: string): Promise<boolean> {
  try {
    await printHtmlDocument(html);
    return true;
  } catch (error) {
    log.reportError('printing an edda failed', error, { module: 'edda' });
    return false;
  }
}
