import { readSettings, writeSetting, type DbHandle } from '../../../core/db/index.js';
import type { HeimdallSettings, SettingsRepository } from '../ports.js';

/** DB `settings` keys these values map to (also read by the boot config overlay). */
const KEYS = {
  shortcut: 'heimdall.shortcut',
  tapCount: 'heimdall.tapCount',
  defaultTheme: 'themes.default',
} as const;

export class DbSettingsRepository implements SettingsRepository {
  constructor(private readonly handle: DbHandle) {}

  read(): Partial<HeimdallSettings> {
    const rows = new Map(readSettings(this.handle).map((row) => [row.key, row.value]));
    const out: Partial<HeimdallSettings> = {};

    const shortcut = rows.get(KEYS.shortcut);
    if (shortcut) out.shortcut = shortcut;

    const tapCount = rows.get(KEYS.tapCount);
    if (tapCount !== undefined) {
      const parsed = Number(tapCount);
      if (Number.isInteger(parsed)) out.tapCount = parsed;
    }

    const defaultTheme = rows.get(KEYS.defaultTheme);
    if (defaultTheme) out.defaultThemeId = defaultTheme;

    return out;
  }

  update(patch: Partial<HeimdallSettings>): void {
    if (patch.shortcut !== undefined) writeSetting(this.handle, KEYS.shortcut, patch.shortcut);
    if (patch.tapCount !== undefined) {
      writeSetting(this.handle, KEYS.tapCount, String(patch.tapCount));
    }
    if (patch.defaultThemeId !== undefined) {
      // Empty string = "no explicit default"; the config overlay ignores it.
      writeSetting(this.handle, KEYS.defaultTheme, patch.defaultThemeId ?? '');
    }
  }
}
