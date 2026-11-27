import { defineConfig, devices } from '@playwright/test';
import type { WorkerOptions } from './support/fixtures.js';

/**
 * Playwright is for the UI only (owner's call, PLAN-32a): browser journeys,
 * the standalone site (PLAN-35), and the cross-surface journeys whose assertion is what
 * a browser shows. Everything out-of-process without a browser (the installed
 * CLI, PLAN-33's API suites) runs under Vitest — see vitest.e2e.config.ts.
 *
 * Each worker boots its own production server (support/fixtures.ts), so
 * `workers` is also the number of servers running at once.
 */

// A pre-installed Chromium can stand in for Playwright's own download (the
// cloud dev container ships one); CI and a developer machine use
// `npx playwright install` and leave this unset.
const chromiumExecutable = process.env.E2E_CHROMIUM_EXECUTABLE || undefined;
const chromiumLaunch = chromiumExecutable
  ? { launchOptions: { executablePath: chromiumExecutable } }
  : {};

// WebKit runs by hand only (owner, 2026-11-27): `./bifrost test e2e webkit`
// sets this. CI's WebKit, in a container with no GPU, failed journeys for
// reasons a real iPhone does not have, so it is no longer a gate; run it
// before a release, beside a look on a real iPhone or iPad.
const withWebkit = process.env.E2E_WEBKIT === '1';

export default defineConfig<object, WorkerOptions>({
  testDir: '.',
  testMatch: ['browser/**/*.spec.ts', 'standalone/**/*.spec.ts'],
  // The packed, temp-prefix CLI for the cross-surface journeys.
  globalSetup: './browser/global-setup.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  // A failure is a client break caught before merge, not a flake to retry.
  retries: 0,
  // CI keeps four, the count its shards are sized and measured at. Locally,
  // four on a busy machine pushed Edda/Groot journeys past the app's 8 s
  // route-chunk timeout, so a developer run stays at two.
  workers: process.env.CI ? 4 : 2,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  outputDir: 'test-results',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Device B and the shell's clipboard copy buttons need a real clipboard in
    // Chromium; WebKit has no such permission and uses the app's fallback.
    actionTimeout: 15_000,
  },
  projects: [
    {
      name: 'chromium-desktop',
      testMatch: 'browser/**/*.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 900 },
        ...chromiumLaunch,
      },
    },
    {
      name: 'chromium-mobile',
      testMatch: 'browser/**/*.spec.ts',
      use: {
        ...devices['Pixel 7'],
        // An iPhone 14's visible page in Safari, the size the WebKit project
        // uses, so the CI gate still sees the household's phone layout (a
        // control under the bottom nav showed only at this height, PR #119).
        viewport: devices['iPhone 14'].viewport,
        ...chromiumLaunch,
      },
    },
    ...(withWebkit
      ? [
          {
            // The household's iPads and iPhones are WebKit, and this project
            // has shipped Safari-only bugs before (AbortSignal.any, the
            // plain-http clipboard fallback, a reload's tab id in PLAN-43).
            name: 'webkit-mobile',
            testMatch: 'browser/**/*.spec.ts',
            use: { ...devices['iPhone 14'] },
          },
        ]
      : []),
    {
      // The standalone site (PLAN-35): dist-standalone/ from a static server
      // with the container's nginx rules, and no Bifrost server at all. The
      // profile's own cloud-gating check is an API test now
      // (api/cloud-profile.e2e.ts): a client build no longer asks the server
      // what to show.
      name: 'standalone',
      testMatch: 'standalone/**/*.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 900 },
        ...chromiumLaunch,
      },
    },
  ],
});
