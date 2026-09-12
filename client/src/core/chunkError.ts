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
  // Ours, from withChunkTimeout below
  'timed out fetching dynamically imported module',
];

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const lowered = message.toLowerCase();
  return CHUNK_ERROR_FRAGMENTS.some((fragment) => lowered.includes(fragment));
}

/**
 * How long to wait for a page's chunk before calling it unreachable.
 *
 * A refused connection fails instantly, but a *vanished* host does not: the
 * SYN goes nowhere, nothing answers, and the browser waits out its own connect
 * timeout — measured at 45s and still counting, during which the click looks
 * like it simply did nothing. That is the shape of the commonest failure here,
 * a laptop that walked out of Wi-Fi range while the tab stayed open.
 *
 * 8s is far above any real LAN chunk load (the largest is a few hundred kB over
 * a local network) and far below the browser's own patience, so a hung fetch
 * becomes an answer while a slow one still succeeds. The request itself is left
 * running — this bounds the *waiting*, not the fetch.
 */
export const CHUNK_TIMEOUT_MS = 8_000;

export function withChunkTimeout<T>(load: Promise<T>, timeoutMs = CHUNK_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error('Timed out fetching dynamically imported module')),
      timeoutMs,
    );
  });
  return Promise.race([load, expiry]).finally(() => clearTimeout(timer)) as Promise<T>;
}
