import { defineConfig } from 'vitest/config';

// Unit tests of the e2e support code only — they run in `npm test`, before any
// build exists, so nothing here may spawn a server or a browser.
export default defineConfig({
  test: {
    include: ['**/*.test.ts'],
    exclude: ['**/node_modules/**', 'test-results/**'],
  },
});
