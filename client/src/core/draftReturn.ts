/**
 * Which editors were left with an open buffer during **this page's lifetime**.
 *
 * The buffers themselves live in `localStorage` (each feature's `draft.ts`) and
 * always did; what was missing was the difference between two situations that
 * look identical to the editor on mount:
 *
 * - **Coming back.** You were in Groot, jumped to Runestone to look at the same
 *   document as JSON, and navigated back. That is one task, and the YAML you
 *   were editing should simply still be there.
 * - **Opening it fresh.** You load the app and go to Groot to start something.
 *   A draft from days ago must not silently reappear as though you had written
 *   it — that is what the "Restore the draft from your last visit?" prompt is
 *   for, and it stays.
 *
 * This marker is deliberately module scope rather than storage: a reload wipes
 * it and a client-side navigation does not, which is exactly the line between
 * those two cases. Putting it in `sessionStorage` would survive a reload and
 * turn every refresh into a silent restore.
 */

const leftOpen = new Set<string>();

/** Record that `editorId` was navigated away from with content still in it. */
export function markLeftOpen(editorId: string): void {
  leftOpen.add(editorId);
}

/**
 * Read **and clear** the mark — it applies to exactly one return, so a later
 * fresh visit to the same editor falls back to the prompt.
 */
export function takeLeftOpen(editorId: string): boolean {
  return leftOpen.delete(editorId);
}
