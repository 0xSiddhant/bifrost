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
 * What this tab last wrote when storage refused it (Safari's private mode, a
 * blocked or full store): the switch still works until a reload, it is just
 * not remembered. `undefined` while storage takes the writes.
 */
let unsaved: string | null | undefined;

/**
 * localStorage that cannot crash the page: a blocked store throws on access.
 * Deliberately silent, a designed fallback like `core/theme`'s: with nothing
 * readable, every decoration reads as switched on.
 */
function read(): string | null {
  if (unsaved !== undefined) return unsaved;
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
  const value = next.length === 0 ? null : JSON.stringify(next);
  try {
    if (value === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, value);
    unsaved = undefined;
  } catch {
    unsaved = value;
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

/**
 * Called on a switch in this tab and on one in any other tab of this browser
 * (the `storage` event), so every open tab's sky follows. Returns an
 * unsubscribe function.
 */
export function onDecorPrefsChange(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) listener();
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** A stable snapshot for `useSyncExternalStore`: the stored value itself. */
export function decorPrefsSnapshot(): string | null {
  return read();
}
