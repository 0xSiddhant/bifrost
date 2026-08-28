/**
 * Was this error a route's JS chunk failing to arrive?
 *
 * Every page below the shell is `React.lazy`, so opening one the tab has not
 * loaded yet is a network request. When that request cannot be served — the
 * device is offline, or the bridge is down — `import()` rejects, the throw
 * reaches the nearest error boundary, and without this distinction the app-wide
 * boundary treats "the server is unreachable" exactly like "a component has a
 * bug in it": a full-screen crash card, on a page that was never broken.
 *
 * The message is the only signal available — none of the engines give this
 * rejection a type or a code — and each one words it differently, so all four
 * spellings are matched. A false positive costs a friendlier message on a real
 * bug; a false negative costs the crash card, which is where we started.
 */
const CHUNK_ERROR_FRAGMENTS = [
  // Chromium
  'failed to fetch dynamically imported module',
  // Firefox
  'error loading dynamically imported module',
  // Safari
  'importing a module script failed',
  // Vite's preload helper, when the chunk's CSS is the part that fails
  'unable to preload css',
];

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const lowered = message.toLowerCase();
  return CHUNK_ERROR_FRAGMENTS.some((fragment) => lowered.includes(fragment));
}
