/**
 * This device's switches for the season's decorations: the ids switched off,
 * under `bifrost.decor.off`. A visual preference of the same class as the
 * relic collections (rules/coding.md, "sky prefs"), so local storage is
 * allowed. An id the installed season does not have is simply ignored, so a
 * season can be removed without migrating anything.
 */

const STORAGE_KEY = 'bifrost.decor.off';
const CHANGE_EVENT = 'bifrost:decor-changed';

/**
 * localStorage that cannot crash the page: Safari's private mode and a
 * blocked store throw. Deliberately silent, a designed fallback like
 * `core/theme`'s: every decoration then reads as switched on.
 */
function read(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function switchedOff(): string[] {
  const raw = read();
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    // A value this code did not write: nothing is switched off.
    return [];
  }
}

export function isDecorationEnabled(id: string): boolean {
  return !switchedOff().includes(id);
}

export function setDecorationEnabled(id: string, enabled: boolean): void {
  const next = switchedOff().filter((entry) => entry !== id);
  if (!enabled) next.push(id);
  try {
    if (next.length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // See read().
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

/** Returns an unsubscribe function. */
export function onDecorPrefsChange(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}

/** A stable snapshot for `useSyncExternalStore`: the stored value itself. */
export function decorPrefsSnapshot(): string | null {
  return read();
}
