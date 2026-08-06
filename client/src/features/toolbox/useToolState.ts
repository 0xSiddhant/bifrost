import { useCallback, useState } from 'react';

/**
 * Scratch input that survives closing and reopening a tool panel, but not a
 * reload (PLAN-18).
 *
 * A module-level Map rather than `localStorage`: what someone pasted into
 * Base64 is scratch, not a draft worth keeping — the allowed-localStorage list
 * in `rules/coding.md` is deliberately short and is not being widened for it.
 * Closing a panel unmounts the tool, so component state alone would lose the
 * input on every close.
 */
const scratch = new Map<string, unknown>();

export function useToolState<T>(key: string, initial: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => (scratch.has(key) ? (scratch.get(key) as T) : initial));
  const set = useCallback(
    (next: T) => {
      scratch.set(key, next);
      setValue(next);
    },
    [key],
  );
  return [value, set];
}

/** Test seam, and the reset a future "clear the toolbox" action would call. */
export function clearToolState(): void {
  scratch.clear();
}
