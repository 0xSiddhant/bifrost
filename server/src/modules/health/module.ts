import type { FeatureModule } from '../../core/module.js';

/**
 * Built-in pseudo-module: proves the module contract and loader mechanism
 * before any real feature exists (PLAN-00). Ships in every profile.
 */
export const healthModule: FeatureModule = {
  name: 'health',
  register(app, deps) {
    app.get('/api/health', () => ({
      ok: true,
      uptime: process.uptime(),
      profile: deps.config.profile,
    }));
  },
};
