/** How long a browser with no idle period gets before the task runs anyway. */
const IDLE_TIMEOUT_MS = 2_000;
/** Safari has no `requestIdleCallback`: a short wait past the first paint instead. */
const IDLE_FALLBACK_MS = 200;

/**
 * Runs `task` once the browser is idle after the first paint, and returns the
 * cancel. For decoration (the sky's relics, a season's decorations): started
 * during the first render, a chunk's download and evaluation would share the
 * moments the page is still painting (Lighthouse's simulated LCP counted them,
 * PLAN-41).
 */
export function whenIdle(task: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(task, { timeout: IDLE_TIMEOUT_MS });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(task, IDLE_FALLBACK_MS);
  return () => window.clearTimeout(id);
}
