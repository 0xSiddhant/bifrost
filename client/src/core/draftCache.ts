import { useEffect, useRef } from 'react';
import { markLeftOpen } from './draftReturn';

/**
 * Keeps an Ollivanders editor's cached scratch draft in step with what is on
 * screen, and decides when "Restore the draft from your last visit?" shows.
 *
 * The rules, as the owner set them:
 *
 * - The prompt is only about a draft from an **earlier** visit (`offered`), and
 *   it shows only while the buffer is **blank**. Typing hides it; deleting
 *   everything again, without saving, brings it back.
 * - The cache mirrors the buffer. Leave with content in it and that content is
 *   what the next visit offers. Leave it blank and the older draft still on
 *   offer stays on offer — clearing the editor is not a reason to lose it.
 * - Saving to the Pensieve clears the draft (each page's `save`, which also
 *   flips `isScratch`, so nothing here writes it back).
 *
 * The mirror runs on the same 500 ms debounce as before, and leaving flushes it
 * so a click away inside that window cannot lose the last keystrokes.
 */

export interface ScratchDraft {
  title: string;
  text: string;
  savedAt: number;
}

interface Options<D extends ScratchDraft> {
  /** True on the unsaved editor; a saved document lives on the server instead. */
  isScratch: boolean;
  title: string;
  text: string;
  /** The buffer counts as empty: whitespace, or the skeleton an editor opens with. */
  blank: boolean;
  /** The earlier visit's draft the prompt is offering, if any. */
  offered: D | null;
  save: (draft: ScratchDraft) => void;
  clear: () => void;
  /** Set to mark the buffer left open for `core/draftReturn` (Runestone, Groot). */
  returnId?: string;
}

/** True when the restore prompt should be on screen. */
export function showsRestore(offered: ScratchDraft | null, blank: boolean): boolean {
  return offered !== null && blank;
}

export function useDraftCache<D extends ScratchDraft>({
  isScratch,
  title,
  text,
  blank,
  offered,
  save,
  clear,
  returnId,
}: Options<D>): void {
  // The leave handler has to flush what is on screen at unmount, not what
  // existed when it registered.
  const latest = useRef({ isScratch, title, text, blank, offered });
  latest.current = { isScratch, title, text, blank, offered };
  const store = useRef({ save, clear, returnId });
  store.current = { save, clear, returnId };

  useEffect(() => {
    if (!isScratch) return;
    const id = window.setTimeout(() => {
      if (!blank) save({ title, text, savedAt: Date.now() });
      else if (offered) save(offered);
      else clear();
    }, 500);
    return () => window.clearTimeout(id);
  }, [isScratch, title, text, blank, offered, save, clear]);

  useEffect(() => {
    // Leaving runs this twice over: a navigation inside the app unmounts the
    // page, while a reload or a typed URL never does and only fires `pagehide`.
    const flush = (markReturn: boolean) => {
      const left = latest.current;
      const { save: put, returnId: id } = store.current;
      if (!left.isScratch) return;
      if (!left.blank) {
        put({ title: left.title, text: left.text, savedAt: Date.now() });
        if (markReturn && id) markLeftOpen(id);
      } else if (left.offered) {
        put(left.offered);
      }
      // Blank with nothing on offer: left to the debounce, not cleared here. The
      // first mount's state has not landed yet when StrictMode runs this, and a
      // clear then would wipe the draft the page is about to offer.
    };
    // A page unload ends the page's lifetime, so there is no return to mark.
    const onPageHide = () => flush(false);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      flush(true);
    };
  }, []);
}
