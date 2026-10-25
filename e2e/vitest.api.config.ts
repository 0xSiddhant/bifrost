import { defineConfig } from 'vitest/config';

// The black-box API suite (PLAN-33): the built server over real sockets,
// knowing nothing but server/openapi.json. Each file boots its own server(s),
// so files run in parallel and the tests inside a file run in order.
export default defineConfig({
  test: {
    include: ['api/**/*.e2e.ts'],
    globalSetup: ['api/global-setup.ts'],
    exclude: ['**/node_modules/**'],
    testTimeout: 120_000,
    hookTimeout: 180_000,
    sequence: { concurrent: false },
    fileParallelism: true,
  },
});
