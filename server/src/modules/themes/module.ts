import type { FeatureModule } from '../../core/module.js';
import { registerThemeRoutes } from './routes/themes.js';
import { DbThemeVisibilityStore } from './services/db-theme-visibility-store.js';
import { FsThemeStore } from './services/fs-theme-store.js';
import { ThemeLoaderService } from './services/theme-loader.js';
import { ThemeValidator } from './services/theme-validator.js';
import {
  AddThemeUseCase,
  DeleteThemeUseCase,
  GetThemeUseCase,
  ListManagedThemesUseCase,
  ListThemesUseCase,
  SetThemeEnabledUseCase,
} from './usecases/manage-themes.js';

export const themesModule: FeatureModule = {
  name: 'themes',
  async register(app, deps) {
    const { config, log, db, bus, sse } = deps;
    const store = new FsThemeStore(config.themes.dir);
    const validator = new ThemeValidator();
    const loader = new ThemeLoaderService(config.themes.dir, store, validator, bus, log);
    const visibility = new DbThemeVisibilityStore(db);

    // Disabled themes are dropped from the live broadcast too, so switchers
    // add/remove them without a reload.
    const unsubscribe = bus.on('theme.updated', (payload) => {
      const disabled = visibility.disabledIds();
      sse.broadcast('theme.updated', {
        themes: payload.themes.filter((theme) => !disabled.has(theme.id)),
      });
    });

    registerThemeRoutes(app, {
      listThemes: new ListThemesUseCase(loader, config.themes.defaultId, visibility),
      getTheme: new GetThemeUseCase(loader),
      addTheme: new AddThemeUseCase(validator, store, loader),
      deleteTheme: new DeleteThemeUseCase(store, loader),
      listManagedThemes: new ListManagedThemesUseCase(loader, visibility),
      setThemeEnabled: new SetThemeEnabledUseCase(loader, visibility, bus),
    });

    // Boot scan completes before the server accepts traffic.
    await loader.start();

    app.addHook('onClose', async () => {
      unsubscribe();
      await loader.stop();
    });
  },
};
