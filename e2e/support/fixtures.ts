import {
  test as base,
  expect,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';
import {
  CONNECTION_LOSS,
  formatViolations,
  isAllowed,
  isExternal,
  isNavigationCancelShaped,
  NavigationCancels,
  type Violation,
} from './guards.js';
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

export interface GuardState {
  violations: Violation[];
  /** WebKit's navigation-cancel reports, held until a navigation explains them. */
  cancels: NavigationCancels<Page>;
  /** Stop recording (a test that deliberately takes the server away). */
  pause(): void;
  resume(): void;
  isRecording(): boolean;
  /** From now on, a refused connection is expected (the test stopped the server). */
  allowConnectionLoss(): void;
  connectionLossAllowed(): boolean;
}

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

function attachGuard(context: BrowserContext, state: GuardState): void {
  const record = (violation: Violation, page?: Page | null) => {
    if (!state.isRecording() || isAllowed(violation)) return;
    if (state.connectionLossAllowed() && CONNECTION_LOSS.matches(violation)) return;
    if (page && isNavigationCancelShaped(violation)) {
      state.cancels.offer(page, violation, Date.now());
      return;
    }
    state.violations.push(violation);
  };
  const watchNavigations = (page: Page) => {
    page.on('request', (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame())
        state.cancels.navigated(page, Date.now());
    });
    page.on('close', () => state.cancels.navigated(page, Date.now()));
  };
  context.pages().forEach(watchNavigations);
  context.on('page', watchNavigations);
  const external = new Set<string>();

  void context.route(
    (url) => isExternal(url.href),
    async (route) => {
      external.add(route.request().url());
      record({
        kind: 'external',
        page: route.request().frame()?.url() ?? '',
        url: route.request().url(),
        detail: 'request to a non-loopback host (blocked)',
      });
      await route.abort('blockedbyclient');
    },
  );
  context.on('weberror', (webError) => {
    const error = webError.error();
    record(
      {
        kind: 'pageerror',
        page: webError.page()?.url() ?? '',
        detail: `${error.name}: ${error.message}`,
      },
      webError.page(),
    );
  });
  context.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    // The browser's own line for a 4xx answer, not the app's: a 404 for a
    // stale slug or a 422 for a refused name is the API working as designed,
    // and the response itself is checked (≥ 500 is the failure that matters).
    if (/^Failed to load resource: the server responded with a status of 4\d\d/.test(text)) return;
    record(
      { kind: 'console.error', page: message.page()?.url() ?? '', detail: text },
      message.page(),
    );
  });
  context.on('response', (response) => {
    if (response.status() >= 500) {
      record({
        kind: 'http5xx',
        page: response.frame()?.url() ?? '',
        url: response.url(),
        detail: `${response.status()} ${response.statusText()}`,
      });
    }
  });
  context.on('requestfailed', (request) => {
    if (external.has(request.url())) return;
    record({
      kind: 'requestfailed',
      page: request.frame()?.url() ?? '',
      url: request.url(),
      detail: request.failure()?.errorText ?? 'failed',
    });
  });
}

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
    let recording = true;
    let connectionLoss = false;
    const state: GuardState = {
      violations: [],
      cancels: new NavigationCancels<Page>(),
      pause: () => {
        recording = false;
      },
      resume: () => {
        recording = true;
      },
      isRecording: () => recording,
      allowConnectionLoss: () => {
        connectionLoss = true;
      },
      connectionLossAllowed: () => connectionLoss,
    };
    await use(state);
    // Every page has closed by now, so anything still held was never explained
    // by a navigation.
    state.violations.push(...state.cancels.unexplained());
    if (state.violations.length > 0 && testInfo.status === 'passed') {
      throw new Error(
        `the page reported errors the user would never see:\n${formatViolations(state.violations)}`,
      );
    }
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
