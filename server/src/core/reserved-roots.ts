/**
 * The one list of URL path roots that are the app's own, kept in core so no
 * feature has to re-derive it (PLAN-15). A Portkey go-link slug may not be any
 * of these: `bifrost.local/go/api`, `/go/runestone`, `/go/go` would all read as
 * "shadowing a real part of the app", so they are refused (422) even though a
 * slug technically lives under `/go/`. The memorable-word namespace stays clean.
 *
 * Contains every first path segment the server or the client routes on, plus
 * `api` and `go` themselves. A guard test asserts the known roots are present so
 * a new top-level route can't silently become an allowed slug.
 */

export const RESERVED_ROOTS: ReadonlySet<string> = new Set([
  // Server-owned prefixes.
  'api',
  'go',
  'health',
  // Prometheus scrapes this by convention at the root, not under /api (PLAN-16b).
  'metrics',
  // Public data/preview routes that escape the SPA fallback.
  'runestone',
  'edda',
  'groot',
  'atlas',
  'variant',
  'loki',
  'accio',
  'nimbus',
  'heimdall',
  // Client route roots (App.tsx) — a slug must never collide with a real page.
  // `pensieve` became a first segment in PLAN-21 (it was only ever nested
  // under /runestone and /edda before the two libraries became one page).
  'pensieve',
  'portkey',
  'upload',
  'downloads',
  'hermes',
  'muninn',
  'wardens',
  'sigil',
  'ollivanders',
  'diagon-alley',
]);

/** True when `word` names one of the app's own path roots (already lowercased). */
export function isReservedRoot(word: string): boolean {
  return RESERVED_ROOTS.has(word);
}
