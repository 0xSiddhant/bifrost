/**
 * The no-silent-errors guard (PLAN-32a): a test fails on anything going wrong
 * in the page that the user would never see — a `pageerror`, a
 * `console.error`, a response ≥ 500, a failed request, or any request to a
 * host that is not this machine.
 *
 * This file is the runner-free half: what counts as a violation, and the
 * allowlist of what does not. `fixtures.ts` wires it into Playwright. Every
 * allowlist entry carries the reason it is not a bug, so an entry can be
 * argued with rather than cargo-culted.
 */

export type ViolationKind =
  | 'pageerror'
  | 'console.error'
  | 'http5xx'
  | 'requestfailed'
  | 'external'
  // The standalone site asked its own origin for something that is not a
  // file of the build: a request meant for a hub it does not have (PLAN-35).
  | 'hubrequest';

export interface Violation {
  kind: ViolationKind;
  /** The page URL the event happened on (may be empty very early in a load). */
  page: string;
  /** The request URL, for request-shaped kinds. */
  url?: string;
  /** Error text, console text, status code or failure reason. */
  detail: string;
}

export interface AllowEntry {
  reason: string;
  matches(violation: Violation): boolean;
}

function pathOf(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/** Aborted, cancelled or interrupted by the page itself — not by the network. */
const ABORT_REASONS =
  /ERR_ABORTED|cancelled|canceled|aborted|Load request cancelled|NS_BINDING_ABORTED/i;

export const ALLOWLIST: AllowEntry[] = [
  {
    reason:
      'The SSE stream (`/api/v1/events`) is a request that never finishes by design: every navigation, reload and context close cancels it, and the browser reports that as a failed request.',
    matches: (v) =>
      v.kind === 'requestfailed' &&
      pathOf(v.url) === '/api/v1/events' &&
      ABORT_REASONS.test(v.detail),
  },
  {
    reason:
      'A request the page itself aborted — an `AbortController` cancelling a superseded list fetch or a debounced search on unmount or a filter change, or a navigation cancelling an in-flight load. The page chose to stop it; nothing failed.',
    matches: (v) => v.kind === 'requestfailed' && ABORT_REASONS.test(v.detail),
  },
];

/**
 * Allowed only after a test has deliberately taken the server away
 * (`guard.allowConnectionLoss()`): every request the page makes then fails to
 * connect, and the browser says so on the console. A request already in
 * flight when the server stops is cut off instead (Chromium's
 * `ERR_CONNECTION_RESET`, WebKit's "Connection reset by peer"). Page errors,
 * 5xx and any other console line still fail the test.
 */
export const CONNECTION_LOSS: AllowEntry = {
  reason:
    'The test stopped the server on purpose (offline mode): a refused connection is the expected state, and the browser logs each one.',
  matches: (v) =>
    (v.kind === 'requestfailed' &&
      /ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_EMPTY_RESPONSE|Could not connect|Connection refused|Connection reset by peer|network connection was lost/i.test(
        v.detail,
      )) ||
    (v.kind === 'console.error' &&
      /Failed to load resource: (net::ERR_CONNECTION_REFUSED|net::ERR_CONNECTION_RESET|net::ERR_EMPTY_RESPONSE|Could not connect|Error receiving data: Connection reset by peer)/i.test(
        v.detail,
      )) ||
    // Vite's own preload helper reports a lazy chunk's stylesheet it could not
    // fetch; the app catches the import failure itself (RouteBoundary).
    (v.kind === 'console.error' && /^Error: Unable to preload CSS for /.test(v.detail)),
};

/**
 * Allowed only after a test has deliberately stopped the API behind a running
 * web host (`guard.allowApiOutage()`, PLAN-36): every API call is then answered
 * `502 HUB_UNAVAILABLE` (a `/go` link 503), and the browser logs each one. A
 * 5xx from anything else, and every other console line, still fails the test.
 */
export const API_OUTAGE: AllowEntry = {
  reason:
    'The test stopped the API on purpose and left the web host up: its 502 HUB_UNAVAILABLE (503 for /go) is the designed answer, and the browser logs each one.',
  matches: (v) =>
    (v.kind === 'http5xx' && /^50[23]\b/.test(v.detail)) ||
    (v.kind === 'console.error' &&
      (/^Failed to load resource: the server responded with a status of 50[23]\b/.test(v.detail) ||
        /^EventSource's response has a status 50[23] that is not 200/.test(v.detail))),
};

/**
 * WebKit's report of a same-origin request cut off by the page navigating
 * away. Chromium drops such a request silently; WebKit rejects its `fetch`
 * (or dynamic `import()`) promise in the old document first, which surfaces as
 * a page error ("Fetch API cannot load … due to access control checks") or a
 * console line ("Importing a module script failed"). For a loopback URL that
 * text cannot be a real CORS failure: every request here is same-origin.
 *
 * Shape alone is not enough to allow it — the same words would describe a
 * chunk that really failed to load — so `NavigationCancels` allows one only
 * when the same page starts a navigation (or closes) within
 * `NAVIGATION_CANCEL_WINDOW_MS` of it.
 */
const LOOPBACK_FETCH_CANCEL =
  /Fetch API cannot load https?:\s?\/*(127\.0\.0\.1|localhost|\[::1\])[:/].* due to access control checks/;

export function isNavigationCancelShaped(violation: Violation): boolean {
  if (violation.kind !== 'pageerror' && violation.kind !== 'console.error') return false;
  return (
    LOOPBACK_FETCH_CANCEL.test(violation.detail) ||
    /^TypeError: Importing a module script failed\.$/.test(violation.detail)
  );
}

export const NAVIGATION_CANCEL_WINDOW_MS = 3_000;

/**
 * Holds navigation-cancel-shaped violations per page until it is known whether
 * a navigation explains them. The order differs by engine and timing — the
 * rejection can land just before or just after the navigation starts — so
 * both are checked: a violation shortly after a navigation is dropped at
 * once, one shortly before is dropped when the navigation comes. Whatever is
 * still held at the end is a real violation.
 */
export class NavigationCancels<PageKey extends object> {
  private readonly lastNavigation = new WeakMap<PageKey, number>();
  private held: { page: PageKey; at: number; violation: Violation }[] = [];

  /** True when the violation is explained already (and so is not held). */
  offer(page: PageKey, violation: Violation, now: number): boolean {
    const last = this.lastNavigation.get(page);
    if (last !== undefined && now - last <= NAVIGATION_CANCEL_WINDOW_MS) return true;
    this.held.push({ page, at: now, violation });
    return false;
  }

  /** The page started a navigation or closed: it cancels what it had in flight. */
  navigated(page: PageKey, now: number): void {
    this.lastNavigation.set(page, now);
    this.held = this.held.filter(
      (entry) => entry.page !== page || now - entry.at > NAVIGATION_CANCEL_WINDOW_MS,
    );
  }

  /** What no navigation explained. */
  unexplained(): Violation[] {
    return this.held.map((entry) => entry.violation);
  }
}

export function isAllowed(violation: Violation, allowlist: AllowEntry[] = ALLOWLIST): boolean {
  return allowlist.some((entry) => entry.matches(violation));
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/**
 * True for anything that leaves this machine. Fonts and every asset are
 * self-hosted, so the app has no business contacting another host: such a
 * request is a bug or a leak. `data:`, `blob:` and `about:` never touch a
 * network at all.
 */
export function isExternal(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (
    parsed.protocol !== 'http:' &&
    parsed.protocol !== 'https:' &&
    parsed.protocol !== 'ws:' &&
    parsed.protocol !== 'wss:'
  ) {
    return false;
  }
  return !LOOPBACK_HOSTS.has(parsed.hostname);
}

export function formatViolations(violations: Violation[]): string {
  return violations
    .map(
      (v) =>
        `  - [${v.kind}] ${v.detail}${v.url ? ` (${v.url})` : ''}${v.page ? ` on ${v.page}` : ''}`,
    )
    .join('\n');
}
