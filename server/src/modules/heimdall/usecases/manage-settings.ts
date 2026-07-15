import type { EventBus } from '../../../core/bus/index.js';
import { AppError } from '../../../core/http/index.js';
import { normalizeShortcut, ShortcutError } from '../shortcut.js';
import type { HeimdallSettings, SettingsRepository } from '../ports.js';

export interface SettingsPatch {
  shortcut?: string;
  tapCount?: number;
  defaultThemeId?: string | null;
}

/** Current runtime settings: DB overlay values, else the .env-derived defaults. */
export class GetSettingsUseCase {
  constructor(
    private readonly repo: SettingsRepository,
    private readonly defaults: HeimdallSettings,
  ) {}

  execute(): HeimdallSettings {
    const overlay = this.repo.read();
    return {
      shortcut: overlay.shortcut ?? this.defaults.shortcut,
      tapCount: overlay.tapCount ?? this.defaults.tapCount,
      defaultThemeId: overlay.defaultThemeId ?? this.defaults.defaultThemeId,
    };
  }
}

/**
 * Validate a settings patch, persist the touched keys, then broadcast
 * `settings.updated` so open clients rebind the entry gesture without a reload.
 */
export class UpdateSettingsUseCase {
  constructor(
    private readonly repo: SettingsRepository,
    private readonly getSettings: GetSettingsUseCase,
    private readonly bus: EventBus,
  ) {}

  execute(patch: SettingsPatch): HeimdallSettings {
    const clean: Partial<HeimdallSettings> = {};

    if (patch.shortcut !== undefined) {
      try {
        clean.shortcut = normalizeShortcut(patch.shortcut);
      } catch (error) {
        throw new AppError(
          error instanceof ShortcutError ? error.message : 'invalid shortcut',
          400,
          'INVALID_SHORTCUT',
        );
      }
    }

    if (patch.tapCount !== undefined) {
      if (!Number.isInteger(patch.tapCount) || patch.tapCount < 3 || patch.tapCount > 20) {
        throw new AppError('tap count must be an integer from 3 to 20', 400, 'INVALID_TAP_COUNT');
      }
      clean.tapCount = patch.tapCount;
    }

    if (patch.defaultThemeId !== undefined) {
      if (patch.defaultThemeId !== null && !/^[a-z0-9-]{2,32}$/.test(patch.defaultThemeId)) {
        throw new AppError('invalid theme id', 400, 'INVALID_THEME_ID');
      }
      clean.defaultThemeId = patch.defaultThemeId;
    }

    this.repo.update(clean);
    const updated = this.getSettings.execute();
    this.bus.emit('settings.updated', {
      shortcut: updated.shortcut,
      tapCount: updated.tapCount,
    });
    return updated;
  }
}
