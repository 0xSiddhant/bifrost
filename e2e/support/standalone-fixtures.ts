import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { attachGuard, useGuard, type GuardState } from './guard-fixture.js';
import { resolve, startStaticSite, STANDALONE_DIR, type StaticSite } from './static-server.js';

/**
 * The Playwright half of the `standalone` project (PLAN-35): the built
 * `client/dist-standalone/` from a static server with the container's rules,
 * and no Bifrost server anywhere.
 *
 * Every context carries the usual no-silent-errors guard, plus the
 * no-request guard: the site may ask its own origin only for files of the
 * build (and page navigations). Anything else, an `/api/…` call above all,
 * is a request for a hub it does not have, and fails the test at teardown
 * even though the static server would have answered it with the app shell.
 */

interface WorkerFixtures {
  site: StaticSite;
}

interface TestFixtures {
  guard: GuardState;
  /** A second tab of the same browser: the same storage, its own page. */
  secondTab: () => Promise<Page>;
  /** How many hub stubs this page has called (`globalThis.__bifrostStubCalls`). */
  stubCalls: (page: Page) => Promise<string[]>;
}

function attachNoRequestGuard(context: BrowserContext, state: GuardState, origin: string): void {
  context.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    // A different origin is the base guard's `external` (blocked and recorded).
    if (url.origin !== origin) return;
    if (request.isNavigationRequest()) return;
    const hit = resolve(STANDALONE_DIR, decodeURIComponent(url.pathname));
    const isBuildFile =
      hit.status === 200 && (url.pathname === '/index.html' || !hit.file?.endsWith('index.html'));
    if (request.method() === 'GET' && isBuildFile) return;
    if (!state.isRecording()) return;
    state.violations.push({
      kind: 'hubrequest',
      page: request.frame()?.url() ?? '',
      url: request.url(),
      detail: `${request.method()} ${url.pathname}: not a file of the standalone build`,
    });
  });
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  site: [
    async ({}, use) => {
      const site = await startStaticSite();
      await use(site);
      await site.stop();
    },
    { scope: 'worker' },
  ],

  baseURL: async ({ site }, use) => {
    await use(site.baseUrl);
  },

  guard: async ({}, use, testInfo) => {
    await useGuard(use, testInfo);
  },

  context: async ({ context, guard, site }, use) => {
    attachGuard(context, guard);
    attachNoRequestGuard(context, guard, site.baseUrl);
    await use(context);
  },

  secondTab: async ({ context }, use) => {
    await use(() => context.newPage());
  },

  stubCalls: async ({}, use) => {
    await use((page) =>
      page.evaluate(
        () => (globalThis as { __bifrostStubCalls?: string[] }).__bifrostStubCalls?.slice() ?? [],
      ),
    );
  },
});

export { expect };
