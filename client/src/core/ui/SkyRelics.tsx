import { lazy, Suspense, useEffect, useState } from 'react';
import { withChunkTimeout } from '../chunkError';
import { log } from '../log';
import { ChunkBoundary } from './ChunkBoundary';

/**
 * The relic drawings' own chunk (PLAN-41): 115 of them, of which a page draws
 * 10–14, were most of the entry chunk's unused JavaScript. An object, so a
 * test can make it fail.
 */
export const relicScatterChunk = {
  load: () => import('./RelicScatter'),
};

/**
 * Built once: the relics are decoration, so after a failed fetch the sky
 * stays empty until the page is reloaded rather than retrying.
 */
const RelicScatter = lazy(() =>
  withChunkTimeout(relicScatterChunk.load()).then((module) => ({
    default: module.RelicScatter,
  })),
);

function relicsFailed(error: Error): void {
  log.warn(`sky: the relic drawings' chunk could not be loaded: ${error.message}`, {
    module: 'relics',
  });
}

/** How long a browser with no idle period gets before the relics load anyway. */
const IDLE_TIMEOUT_MS = 2_000;
/** Safari has no `requestIdleCallback`: a short wait past the first paint instead. */
const IDLE_FALLBACK_MS = 200;

/**
 * Runs `task` once the browser is idle after the first paint, and returns the
 * cancel. The relic chunk is decoration, so it waits for the work the first
 * render actually needs: started during that render, its download and its 115
 * drawings' evaluation would share the moments the page is still painting
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
 * The sky's relics, drawn once the browser is idle after the first paint and
 * their chunk has arrived. Nothing waits for them and nothing moves when they
 * appear: they are absolutely placed inside `.sky`. A missing chunk costs the
 * relics, never the shell.
 */
export function SkyRelics() {
  const [idle, setIdle] = useState(false);
  useEffect(() => whenIdle(() => setIdle(true)), []);
  if (!idle) return null;
  return (
    <ChunkBoundary onChunkError={relicsFailed}>
      <Suspense fallback={null}>
        <RelicScatter />
      </Suspense>
    </ChunkBoundary>
  );
}
