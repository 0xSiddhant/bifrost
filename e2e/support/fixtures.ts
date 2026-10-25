import {
  test as base,
  expect,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';
import { attachGuard, useGuard, type GuardState } from './guard-fixture.js';
import { startServer, type E2EServer, type StartServerOptions } from './server.js';

/**
 * The Playwright half of the harness.
 *
 * - `server` is **worker-scoped**: each worker gets its own production server
 *   on a free port with its own scratch storage, so tests run in parallel
 *   without sharing state. A test that changes process-wide state (stopping the
 *   server, revoking every session, tripping the login throttle) asks
 *   `ownServer()` for a test-scoped one instead, so it never poisons a
 *   neighbour.
 * - Every browser context a test touches — the default one and every
 *   `newDevice()` — is guarded (see guards.ts); a test fails at teardown on any
 *   unallowed violation, even when every assertion passed.
 */

/** The worker option a project sets (`cloud` boots a `DEPLOY_PROFILE=cloud` server). */
export interface WorkerOptions {
  profile: 'local' | 'cloud';
}

interface WorkerFixtures extends WorkerOptions {
  server: E2EServer;
}

interface TestFixtures {
  guard: GuardState;
  /** A second (third, …) device: a separate browser context, so a separate deviceId. */
  newDevice: (options?: { baseURL?: string }) => Promise<Page>;
  /** A test-scoped server of its own, stopped and cleaned up after the test. */
  ownServer: (options?: StartServerOptions) => Promise<E2EServer>;
}

const DEVICE_OPTION_KEYS = [
  'viewport',
  'userAgent',
  'deviceScaleFactor',
  'isMobile',
  'hasTouch',
  'locale',
  'timezoneId',
  'colorScheme',
] as const;

export const test = base.extend<TestFixtures, WorkerFixtures>({
  profile: ['local', { scope: 'worker', option: true }],

  server: [
    async ({ profile }, use) => {
      const server = await startServer({ profile });
      await use(server);
      await server.stop();
    },
    { scope: 'worker', timeout: 90_000 },
  ],

  baseURL: async ({ server }, use) => {
    await use(server.baseUrl);
  },

  guard: async ({}, use, testInfo) => {
    await useGuard(use, testInfo);
  },

  context: async ({ context, guard }, use) => {
    attachGuard(context, guard);
    await use(context);
  },

  newDevice: async ({ browser, guard, baseURL }, use, testInfo) => {
    const contexts: BrowserContext[] = [];
    const projectUse = testInfo.project.use as BrowserContextOptions;
    await use(async (options = {}) => {
      const contextOptions: BrowserContextOptions = { baseURL: options.baseURL ?? baseURL };
      for (const key of DEVICE_OPTION_KEYS) {
        if (projectUse[key] !== undefined)
          (contextOptions as Record<string, unknown>)[key] = projectUse[key];
      }
      const context = await browser.newContext(contextOptions);
      attachGuard(context, guard);
      contexts.push(context);
      return context.newPage();
    });
    for (const context of contexts) await context.close();
  },

  ownServer: async ({ guard }, use) => {
    const servers: E2EServer[] = [];
    await use(async (options = {}) => {
      const server = await startServer(options);
      servers.push(server);
      return server;
    });
    // The test is over, but its pages may still be open on these servers:
    // their last favicon or SSE retry is refused once a server stops, which
    // is teardown, not a bug. Page errors still count.
    if (servers.length > 0) guard.allowConnectionLoss();
    for (const server of servers) await server.stop();
  },
});

// Attach the worker server's own output to any failing test: a client symptom
// is very often a server-side line.
test.afterEach(async ({ server }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    await testInfo.attach('server-output', { body: server.output(), contentType: 'text/plain' });
  }
});

export { expect };
export type { GuardState };
