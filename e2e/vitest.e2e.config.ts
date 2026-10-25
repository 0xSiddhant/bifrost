import { defineConfig } from 'vitest/config';

// The installed-CLI suite. Each file boots its own server in beforeAll, so
// files run in parallel and the tests inside a file run in order against that
// server. PLAN-33's API suite has its own config (vitest.api.config.ts): it
// needs no packed CLI, which this config's global setup installs.
export default defineConfig({
  test: {
    include: ['cli/**/*.e2e.ts'],
    globalSetup: ['cli/global-setup.ts'],
    exclude: ['**/node_modules/**'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    sequence: { concurrent: false },
    fileParallelism: true,
  },
});
