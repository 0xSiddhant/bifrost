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
  'pageerror' | 'console.error' | 'http5xx' | 'requestfailed' | 'external';

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
      'The SSE stream (`/api/events`) is a request that never finishes by design: every navigation, reload and context close cancels it, and the browser reports that as a failed request.',
    matches: (v) =>
      v.kind === 'requestfailed' && pathOf(v.url) === '/api/events' && ABORT_REASONS.test(v.detail),
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
 * connect, and the browser says so on the console. Page errors, 5xx and any
 * other console line still fail the test.
 */
export const CONNECTION_LOSS: AllowEntry = {
  reason:
    'The test stopped the server on purpose (offline mode): a refused connection is the expected state, and the browser logs each one.',
  matches: (v) =>
    (v.kind === 'requestfailed' &&
      /ERR_CONNECTION_REFUSED|Could not connect|Connection refused|network connection was lost/i.test(
        v.detail,
      )) ||
    (v.kind === 'console.error' &&
      /Failed to load resource: (net::ERR_CONNECTION_REFUSED|Could not connect)/i.test(v.detail)) ||
    // Vite's own preload helper reports a lazy chunk's stylesheet it could not
    // fetch; the app catches the import failure itself (RouteBoundary).
    (v.kind === 'console.error' && /^Error: Unable to preload CSS for /.test(v.detail)),
};

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
