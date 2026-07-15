import type { ThemeSummary } from '../../../core/bus/events.js';
import { AppError } from '../../../core/http/index.js';
import { toSummary, type ResolvedTheme, type ThemeStore } from '../ports.js';
import { BUILT_IN_THEME_IDS, type ThemeLoaderService } from '../services/theme-loader.js';
import type { ThemeValidator } from '../services/theme-validator.js';

export class ListThemesUseCase {
  constructor(
    private readonly loader: ThemeLoaderService,
    private readonly defaultId: string | null,
  ) {}

  execute(): { defaultId: string | null; themes: ThemeSummary[] } {
    const themes = this.loader.summaries();
    // null (nothing configured, or the configured theme vanished) tells the
    // client to fall through to its prefers-color-scheme match.
    const defaultId =
      this.defaultId !== null && themes.some((theme) => theme.id === this.defaultId)
        ? this.defaultId
        : null;
    return { defaultId, themes };
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
