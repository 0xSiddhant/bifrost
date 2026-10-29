import { lazy, Suspense } from 'react';
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

/**
 * The sky's relics, drawn once their chunk arrives, a moment after the first
 * paint. Nothing waits for them and nothing moves when they appear: they are
 * absolutely placed inside `.sky`. A missing chunk costs the relics, never
 * the shell.
 */
export function SkyRelics() {
  return (
    <ChunkBoundary onChunkError={relicsFailed}>
      <Suspense fallback={null}>
        <RelicScatter />
      </Suspense>
    </ChunkBoundary>
  );
}
