/**
 * Under Vitest `__BIFROST_BUILD__` is a runtime global rather than a baked
 * literal (see vite.config.ts), so a test can import a module as the
 * standalone build: set the global, `vi.resetModules()`, then import.
 */
const globals = globalThis as { __BIFROST_BUILD__?: string };
globals.__BIFROST_BUILD__ ??= 'hub';
