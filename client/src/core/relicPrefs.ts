import { ALL_COLLECTIONS, type RelicCollection } from '../assets/relics';

/**
 * Which relic collections drift through the sky. A visual preference of the
 * same class as the theme choice, so caching it locally is allowed (see
 * rules/coding.md). Heimdall's server-side settings arrive in PLAN-05.
 */

const STORAGE_KEY = 'bifrost.relics';
const CHANGE_EVENT = 'bifrost:relics-changed';

export function getEnabledCollections(): RelicCollection[] {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === null) return [...ALL_COLLECTIONS]; // default: everything
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [...ALL_COLLECTIONS];
    return ALL_COLLECTIONS.filter((name) => parsed.includes(name));
  } catch {
    return [...ALL_COLLECTIONS];
  }
}

export function setEnabledCollections(collections: RelicCollection[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(collections));
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

/** Returns an unsubscribe function. */
export function onRelicPrefsChange(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}
