import type { BrowserContext, Page, TestInfo } from '@playwright/test';
import {
  API_OUTAGE,
  CONNECTION_LOSS,
  formatViolations,
  isAllowed,
  isExternal,
  isNavigationCancelShaped,
  NavigationCancels,
  type Violation,
} from './guards.js';

/**
 * The no-silent-errors guard as Playwright fixture pieces, shared by the hub
 * projects (fixtures.ts) and the standalone one (standalone-fixtures.ts).
 * Kept apart from fixtures.ts on purpose: that file registers a hook that
 * needs the hub server, and importing it would boot one for the standalone
 * project too.
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
  /** From now on, a 502 from the web host is expected (the test stopped the API alone). */
  allowApiOutage(): void;
  apiOutageAllowed(): boolean;
}

export function attachGuard(context: BrowserContext, state: GuardState): void {
  const record = (violation: Violation, page?: Page | null) => {
    if (!state.isRecording() || isAllowed(violation)) return;
    if (state.connectionLossAllowed() && CONNECTION_LOSS.matches(violation)) return;
    if (state.apiOutageAllowed() && API_OUTAGE.matches(violation)) return;
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

/**
 * The guard fixture's body, shared with the standalone project's fixtures
 * (PLAN-35): hand the test a fresh state, then fail it at teardown on any
 * violation nothing explained.
 */
export async function useGuard(
  use: (state: GuardState) => Promise<void>,
  testInfo: TestInfo,
): Promise<void> {
  let recording = true;
  let connectionLoss = false;
  let apiOutage = false;
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
    allowApiOutage: () => {
      apiOutage = true;
    },
    apiOutageAllowed: () => apiOutage,
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
}
