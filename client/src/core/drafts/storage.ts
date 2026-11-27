/**
 * The two Web Storage areas the drafts use, behind a small interface so tests
 * can give two simulated tabs one `localStorage` and a `sessionStorage` each.
 * Every method may throw (quota, a blocked profile, private mode); callers
 * decide what a failure means, because "best effort" is not the same answer
 * for a write the user is relying on and for a read that can fall back.
 */

export interface DraftStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  keys(): string[];
}

function wrap(area: () => Storage): DraftStorage {
  return {
    get: (key) => area().getItem(key),
    set: (key, value) => area().setItem(key, value),
    remove: (key) => area().removeItem(key),
    keys: () => {
      const storage = area();
      const keys: string[] = [];
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        if (key !== null) keys.push(key);
      }
      return keys;
    },
  };
}

// Reading the property itself throws a SecurityError when storage is blocked,
// so it is read at call time, inside the caller's try.
export const browserLocalStorage = (): DraftStorage => wrap(() => window.localStorage);
export const browserSessionStorage = (): DraftStorage => wrap(() => window.sessionStorage);

/** An in-memory area, for tests. */
export function memoryStorage(initial: Record<string, string> = {}): DraftStorage & {
  data: Map<string, string>;
  failWrites: Error | null;
} {
  const data = new Map(Object.entries(initial));
  const area = {
    data,
    failWrites: null as Error | null,
    get: (key: string) => data.get(key) ?? null,
    set: (key: string, value: string) => {
      if (area.failWrites) throw area.failWrites;
      data.set(key, value);
    },
    remove: (key: string) => {
      if (area.failWrites) throw area.failWrites;
      data.delete(key);
    },
    keys: () => [...data.keys()],
  };
  return area;
}

/** A short, loggable reason for a storage failure, never the stored value. */
export function storageErrorReason(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'QuotaExceededError' || error.code === 22) return 'browser storage is full';
    if (error.name === 'SecurityError') return 'browser storage is blocked';
    return error.name;
  }
  return error instanceof Error ? error.message : 'storage unavailable';
}
