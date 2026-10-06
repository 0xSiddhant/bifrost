import type { FeatureModule } from '../../core/module.js';

/**
 * Built-in pseudo-module: proves the module contract and loader mechanism
 * before any real feature exists (PLAN-00). Ships in every profile.
 */
export const healthModule: FeatureModule = {
  name: 'health',
  register(app, deps) {
    app.get(
      '/api/health',
      {
        schema: {
          tags: ['health'],
          summary: 'Liveness: the process is up and serving',
          operationId: 'getHealth',
          response: {
            200: {
              type: 'object',
              required: ['ok', 'uptime', 'profile'],
              properties: {
                ok: { type: 'boolean', enum: [true] },
                uptime: { type: 'number', description: 'Process uptime in seconds' },
                profile: { type: 'string', enum: ['local', 'cloud'] },
              },
            },
          },
        },
      },
      () => ({
        ok: true,
        uptime: process.uptime(),
        profile: deps.config.profile,
      }),
    );
  },
};
