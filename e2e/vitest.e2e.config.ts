import { defineConfig } from 'vitest/config';

// Out-of-process suites with no browser (the installed CLI; PLAN-33's API
// suites later). Each file boots its own server in beforeAll, so files run in
// parallel and the tests inside a file run in order against that server.
export default defineConfig({
  test: {
    include: ['**/*.e2e.ts'],
    globalSetup: ['cli/global-setup.ts'],
    exclude: ['**/node_modules/**'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    sequence: { concurrent: false },
    fileParallelism: true,
  },
});
