import { defineConfig, devices } from '@playwright/test';
import type { WorkerOptions } from './support/fixtures.js';

/**
 * Playwright is for the UI only (owner's call, PLAN-32a): browser journeys,
 * cloud-profile gating, and the cross-surface journeys whose assertion is what
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

export default defineConfig<object, WorkerOptions>({
  testDir: '.',
  testMatch: ['browser/**/*.spec.ts', 'cloud/**/*.spec.ts'],
  // The packed, temp-prefix CLI for the cross-surface journeys.
  globalSetup: './browser/global-setup.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  // A failure is a client break caught before merge, not a flake to retry.
  retries: 0,
  workers: process.env.CI ? 4 : undefined,
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
        viewport: { width: 390, height: 844 },
        ...chromiumLaunch,
      },
    },
    {
      // The household's iPads and iPhones are WebKit, and this project has
      // shipped Safari-only bugs before (AbortSignal.any, the plain-http
      // clipboard fallback).
      name: 'webkit-mobile',
      testMatch: 'browser/**/*.spec.ts',
      use: { ...devices['iPhone 14'] },
    },
    {
      name: 'cloud',
      testMatch: 'cloud/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'], profile: 'cloud', ...chromiumLaunch },
    },
  ],
});
