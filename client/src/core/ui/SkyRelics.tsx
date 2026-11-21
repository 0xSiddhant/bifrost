import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { withChunkTimeout } from '../chunkError';
import { log } from '../log';
import { ChunkBoundary } from './ChunkBoundary';

/**
 * The sky's decoration chunk (PLAN-41): the relic drawings, 155 of which a
 * page draws 10–14, and the decorations a theme opts into (the Yule world's
 * snowfall, string lights and footer scene). An object, so a test can make
 * it fail.
 */
export const skyDecorChunk = {
  load: () => import('./skyDecor'),
};

/**
 * Fetched once for every mount point, and built once: the pieces are
 * decoration, so after a failed fetch they stay away until the page is
 * reloaded rather than retrying.
 */
let decorChunk: ReturnType<typeof skyDecorChunk.load> | null = null;
function loadDecor(): ReturnType<typeof skyDecorChunk.load> {
  decorChunk ??= withChunkTimeout(skyDecorChunk.load());
  return decorChunk;
}

const RelicScatter = lazy(() => loadDecor().then((m) => ({ default: m.RelicScatter })));
const Snowfall = lazy(() => loadDecor().then((m) => ({ default: m.Snowfall })));
const StringLights = lazy(() => loadDecor().then((m) => ({ default: m.StringLights })));
const FooterScene = lazy(() => loadDecor().then((m) => ({ default: m.FooterScene })));

/** How long a browser with no idle period gets before the relics load anyway. */
const IDLE_TIMEOUT_MS = 2_000;
/** Safari has no `requestIdleCallback`: a short wait past the first paint instead. */
const IDLE_FALLBACK_MS = 200;

/**
 * Runs `task` once the browser is idle after the first paint, and returns the
 * cancel. The chunk is decoration, so it waits for the work the first render
 * actually needs: started during that render, its download and its drawings'
 * evaluation would share the moments the page is still painting
 * (Lighthouse's simulated LCP counted them, PLAN-41).
 */
function whenIdle(task: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(task, { timeout: IDLE_TIMEOUT_MS });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(task, IDLE_FALLBACK_MS);
  return () => window.clearTimeout(id);
}

/**
 * One mount point: renders its pieces once the browser is idle and the chunk
 * has arrived. Nothing waits for them and nothing moves when they appear:
 * each is absolutely placed. A missing chunk costs this decoration, never the
 * shell, with one `warn` naming it.
 */
function IdleDecor({ what, children }: { what: string; children: ReactNode }) {
  const [idle, setIdle] = useState(false);
  useEffect(() => whenIdle(() => setIdle(true)), []);
  if (!idle) return null;
  return (
    <ChunkBoundary
      onChunkError={(error) =>
        log.warn(`sky: ${what} could not be loaded: ${error.message}`, { module: 'relics' })
      }
    >
      <Suspense fallback={null}>{children}</Suspense>
    </ChunkBoundary>
  );
}

/** Inside `.sky`: the relics, and the snow in front of them when the theme has it. */
export function SkyRelics() {
  return (
    <IdleDecor what="the relic drawings' chunk">
      <RelicScatter />
      <Snowfall />
    </IdleDecor>
  );
}

/** Right after the header: the string lights, when the theme has them. */
export function HeaderLights() {
  return (
    <IdleDecor what="the string lights">
      <StringLights />
    </IdleDecor>
  );
}

/** Inside the footer: the winter scene on the footer line, when the theme has it. */
export function FooterDecor() {
  return (
    <IdleDecor what="the footer scene">
      <FooterScene />
    </IdleDecor>
  );
}
