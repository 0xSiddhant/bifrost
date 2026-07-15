import type { FeatureModule } from '../../core/module.js';
import { registerThemeRoutes } from './routes/themes.js';
import { FsThemeStore } from './services/fs-theme-store.js';
import { ThemeLoaderService } from './services/theme-loader.js';
import { ThemeValidator } from './services/theme-validator.js';
import {
  AddThemeUseCase,
  DeleteThemeUseCase,
  GetThemeUseCase,
  ListThemesUseCase,
} from './usecases/manage-themes.js';

export const themesModule: FeatureModule = {
  name: 'themes',
  async register(app, deps) {
    const { config, log, bus, sse } = deps;
    const store = new FsThemeStore(config.themes.dir);
    const validator = new ThemeValidator();
    const loader = new ThemeLoaderService(config.themes.dir, store, validator, bus, log);

    const unsubscribe = bus.on('theme.updated', (payload) =>
      sse.broadcast('theme.updated', payload),
    );

    registerThemeRoutes(app, {
      listThemes: new ListThemesUseCase(loader, config.themes.defaultId),
      getTheme: new GetThemeUseCase(loader),
      addTheme: new AddThemeUseCase(validator, store, loader),
      deleteTheme: new DeleteThemeUseCase(store, loader),
      writeApiEnabled: config.themes.writeApi,
    });

    // Boot scan completes before the server accepts traffic.
    await loader.start();

    app.addHook('onClose', async () => {
      unsubscribe();
      await loader.stop();
    });
  },
};
