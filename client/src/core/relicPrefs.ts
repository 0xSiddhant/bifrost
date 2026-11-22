import { ALL_COLLECTIONS, type RelicCollection } from '../assets/relics/collections';

/**
 * Which relic collections drift through this device's sky. A visual
 * preference of the same class as the theme choice, so caching it locally is
 * allowed (see rules/coding.md, "sky prefs"). A season's decorations have
 * their own switches (`core/decor/prefs.ts`).
 */

/**
 * The collections this device has unticked. Stored as the ones switched off,
 * not the ones on, so a collection added later (Yule, Halloween before it)
 * shows for everyone until they untick it.
 */
const STORAGE_KEY = 'bifrost.relics.off';
/**
 * Before 2026-11-22 the choice was stored as the collections ticked, which
 * hid every later collection from anyone who had ever saved one. Read once,
 * against the collections that existed then, and replaced on the next save.
 */
const LEGACY_KEY = 'bifrost.relics';
const LEGACY_COLLECTIONS: readonly RelicCollection[] = [
  'norse',
  'wizarding',
  'olympus',
  'ghibli',
  'halloween',
];
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

function removeStorage(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // See readStorage.
  }
}

/** A stored JSON array of names, or null when absent or not one this code wrote. */
function readNames(key: string): string[] | null {
  const stored = readStorage(key);
  if (stored === null) return null;
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed)
      ? parsed.filter((name): name is string => typeof name === 'string')
      : null;
  } catch {
    // A value this code did not write: the default, as for no value at all.
    return null;
  }
}

function switchedOff(): readonly string[] {
  const off = readNames(STORAGE_KEY);
  if (off) return off;
  const legacyOn = readNames(LEGACY_KEY);
  if (legacyOn) return LEGACY_COLLECTIONS.filter((name) => !legacyOn.includes(name));
  return []; // default: everything
}

export function getEnabledCollections(): RelicCollection[] {
  const off = switchedOff();
  return ALL_COLLECTIONS.filter((name) => !off.includes(name));
}

export function setEnabledCollections(collections: RelicCollection[]): void {
  const off = ALL_COLLECTIONS.filter((name) => !collections.includes(name));
  writeStorage(STORAGE_KEY, JSON.stringify(off));
  removeStorage(LEGACY_KEY);
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

/** Returns an unsubscribe function. */
export function onRelicPrefsChange(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}
