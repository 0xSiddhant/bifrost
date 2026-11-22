import { ALL_COLLECTIONS, type RelicCollection } from '../assets/relics/collections';

/**
 * Which relic collections drift through this device's sky. A visual
 * preference of the same class as the theme choice, so caching it locally is
 * allowed (see rules/coding.md, "sky prefs"). A season's decorations have
 * their own switches (`core/decor/prefs.ts`).
 */

const STORAGE_KEY = 'bifrost.relics';
const CHANGE_EVENT = 'bifrost:relics-changed';

/**
 * localStorage that cannot crash the page: Safari's private mode and a
 * cleared or blocked store throw on access. Deliberately silent, a designed
 * fallback like `core/theme`'s: the sky simply shows its defaults and the
 * choice is not remembered for next time.
 */
function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // See readStorage.
  }
}

export function getEnabledCollections(): RelicCollection[] {
  const stored = readStorage(STORAGE_KEY);
  if (stored === null) return [...ALL_COLLECTIONS]; // default: everything
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [...ALL_COLLECTIONS];
    return ALL_COLLECTIONS.filter((name) => parsed.includes(name));
  } catch {
    // A value this code did not write: the default, as for no value at all.
    return [...ALL_COLLECTIONS];
  }
}

export function setEnabledCollections(collections: RelicCollection[]): void {
  writeStorage(STORAGE_KEY, JSON.stringify(collections));
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

/** Returns an unsubscribe function. */
export function onRelicPrefsChange(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}
