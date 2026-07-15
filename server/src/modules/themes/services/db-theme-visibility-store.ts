import { readSettings, writeSetting, type DbHandle } from '../../../core/db/index.js';
import type { ThemeVisibilityStore } from '../ports.js';

/** DB `settings` key holding the comma-separated disabled theme ids. */
const KEY = 'themes.disabled';

export class DbThemeVisibilityStore implements ThemeVisibilityStore {
  constructor(private readonly handle: DbHandle) {}

  disabledIds(): Set<string> {
    const row = readSettings(this.handle).find((entry) => entry.key === KEY);
    if (!row || !row.value) return new Set();
    return new Set(
      row.value
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    );
  }

  setDisabled(id: string, disabled: boolean): void {
    const ids = this.disabledIds();
    if (disabled) ids.add(id);
    else ids.delete(id);
    writeSetting(this.handle, KEY, [...ids].join(','));
  }
}
