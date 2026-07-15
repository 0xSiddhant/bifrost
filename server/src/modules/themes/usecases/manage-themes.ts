import type { EventBus } from '../../../core/bus/index.js';
import type { ThemeSummary } from '../../../core/bus/events.js';
import { AppError } from '../../../core/http/index.js';
import { toSummary, type ResolvedTheme, type ThemeStore, type ThemeVisibilityStore } from '../ports.js';
import { BUILT_IN_THEME_IDS, type ThemeLoaderService } from '../services/theme-loader.js';
import type { ThemeValidator } from '../services/theme-validator.js';

/** A theme summary plus its admin enable/disable state (Heimdall manager). */
export interface ManagedThemeSummary extends ThemeSummary {
  enabled: boolean;
}

/** Public listing — disabled themes are hidden entirely (the switcher never sees them). */
export class ListThemesUseCase {
  constructor(
    private readonly loader: ThemeLoaderService,
    private readonly defaultId: string | null,
    private readonly visibility: ThemeVisibilityStore,
  ) {}

  execute(): { defaultId: string | null; themes: ThemeSummary[] } {
    const disabled = this.visibility.disabledIds();
    const themes = this.loader.summaries().filter((theme) => !disabled.has(theme.id));
    // null (nothing configured, the theme vanished, or it was disabled) tells
    // the client to fall through to its prefers-color-scheme match.
    const defaultId =
      this.defaultId !== null && themes.some((theme) => theme.id === this.defaultId)
        ? this.defaultId
        : null;
    return { defaultId, themes };
  }
}

/** Admin listing — every theme with its enabled flag (guarded, for Heimdall). */
export class ListManagedThemesUseCase {
  constructor(
    private readonly loader: ThemeLoaderService,
    private readonly visibility: ThemeVisibilityStore,
  ) {}

  execute(): { themes: ManagedThemeSummary[] } {
    const disabled = this.visibility.disabledIds();
    return {
      themes: this.loader.summaries().map((theme) => ({ ...theme, enabled: !disabled.has(theme.id) })),
    };
  }
}

/** Toggle a theme's visibility, then re-announce so open switchers update live. */
export class SetThemeEnabledUseCase {
  constructor(
    private readonly loader: ThemeLoaderService,
    private readonly visibility: ThemeVisibilityStore,
    private readonly bus: EventBus,
  ) {}

  execute(id: string, enabled: boolean): ManagedThemeSummary {
    const theme = this.loader.get(id);
    if (!theme) throw new AppError('theme not found', 404, 'NOT_FOUND');

    const disabled = this.visibility.disabledIds();
    if (!enabled && !disabled.has(id)) {
      const enabledCount = this.loader.summaries().filter((t) => !disabled.has(t.id)).length;
      if (enabledCount <= 1) {
        throw new AppError('at least one theme must stay enabled', 409, 'LAST_THEME');
      }
    }

    this.visibility.setDisabled(id, !enabled);
    // Re-broadcast (the module wiring filters the payload) so every open client
    // adds/removes the theme from its switcher without a reload.
    this.bus.emit('theme.updated', { themes: this.loader.summaries() });
    return { ...toSummary(theme), enabled };
  }
}

export class GetThemeUseCase {
  constructor(private readonly loader: ThemeLoaderService) {}

  execute(id: string): ResolvedTheme {
    const theme = this.loader.get(id);
    if (!theme) throw new AppError('theme not found', 404, 'NOT_FOUND');
    return theme;
  }
}

export class AddThemeUseCase {
  constructor(
    private readonly validator: ThemeValidator,
    private readonly store: ThemeStore,
    private readonly loader: ThemeLoaderService,
  ) {}

  /** Throws ThemeValidationError (→422 in the route) on schema violations. */
  async execute(body: unknown): Promise<ThemeSummary> {
    const theme = this.validator.check(body);
    if (BUILT_IN_THEME_IDS.has(theme.id)) {
      throw new AppError('built-in themes cannot be replaced', 403, 'BUILT_IN');
    }
    if (this.loader.get(theme.id)) {
      throw new AppError(`theme "${theme.id}" already exists`, 409, 'DUPLICATE');
    }
    const fileName = `${theme.id}.json`;
    await this.store.writeFile(fileName, `${JSON.stringify(theme, null, 2)}\n`);
    // Load synchronously — the watcher would get there too, but the response
    // should already reflect the new state.
    await this.loader.reloadFromDisk(fileName);
    const loaded = this.loader.get(theme.id);
    if (!loaded) throw new AppError('theme failed to load after write', 500, 'INTERNAL');
    return toSummary(loaded);
  }
}

export class DeleteThemeUseCase {
  constructor(
    private readonly store: ThemeStore,
    private readonly loader: ThemeLoaderService,
  ) {}

  async execute(id: string): Promise<void> {
    if (BUILT_IN_THEME_IDS.has(id)) {
      throw new AppError('built-in themes cannot be deleted', 403, 'BUILT_IN');
    }
    const fileName = this.loader.fileNameOf(id);
    if (!fileName) throw new AppError('theme not found', 404, 'NOT_FOUND');
    await this.store.deleteFile(fileName);
    this.loader.removeByFileName(fileName);
  }
}
