import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useState,
  type ComponentType,
  type LazyExoticComponent,
} from 'react';
import { withChunkTimeout } from '../chunkError';
import { log } from '../log';
import { ChunkBoundary } from '../ui/ChunkBoundary';
import { whenIdle } from '../ui/whenIdle';
import { installedSeason } from './registry';
import type { DecorationComponents, DecorSlotName, Season } from './types';
import { useSlotDecorations } from './useSlotDecorations';

/**
 * One place in the shell where the installed season's decorations appear
 * (`sky`, `header`, `footer`). It names no decoration: it renders whichever of
 * the season's decorations belong to this slot, are turned on by the applied
 * theme and are not switched off on this device. With no season installed,
 * or none of its decorations wanted here, it renders an empty marker and
 * loads nothing.
 *
 * The season's components are one chunk, asked for once the browser is idle
 * after the first paint (like the relics, PLAN-41), and fetched once for all
 * three slots. A chunk that cannot load costs the decorations, never the
 * shell: one `warn`, and the slot stays empty.
 *
 * The wrapper is `display: contents`, so a decoration lays out as if it were
 * the slot's parent's own child; `data-decor-state` (`empty`, `loading`,
 * `ready`) is what the e2e journeys wait for.
 */
export function DecorSlot({ slot }: { slot: DecorSlotName }) {
  const decorations = useSlotDecorations(slot);
  const season = installedSeason();
  const [idle, setIdle] = useState(false);
  const [ready, setReady] = useState(false);
  const markReady = useCallback(() => setReady(true), []);
  useEffect(() => whenIdle(() => setIdle(true)), []);

  const ids = decorations.map((decoration) => decoration.id);
  const wanted = season !== null && ids.length > 0;
  const state = !wanted ? 'empty' : ready ? 'ready' : 'loading';
  const View = wanted && idle ? seasonView(season) : null;

  return (
    <div style={{ display: 'contents' }} data-decor-slot={slot} data-decor-state={state}>
      {View && (
        <ChunkBoundary
          onChunkError={(error) =>
            log.warn(
              `decor: the ${slot} slot's decorations could not be loaded: ${error.message}`,
              {
                module: 'decor',
              },
            )
          }
        >
          <Suspense fallback={null}>
            <View ids={ids} onReady={markReady} />
          </Suspense>
        </ChunkBoundary>
      )}
    </div>
  );
}

interface ViewProps {
  ids: readonly string[];
  onReady: () => void;
}

/** One loaded chunk per season, shared by the three slots. */
const chunks = new WeakMap<Season, Promise<DecorationComponents>>();
const views = new WeakMap<Season, LazyExoticComponent<ComponentType<ViewProps>>>();

/** The season's components, fetched once (and after a failure, not retried). */
export function loadSeason(season: Season): Promise<DecorationComponents> {
  let chunk = chunks.get(season);
  if (!chunk) {
    chunk = withChunkTimeout(season.load());
    chunks.set(season, chunk);
  }
  return chunk;
}

function seasonView(season: Season): LazyExoticComponent<ComponentType<ViewProps>> {
  let view = views.get(season);
  if (!view) {
    view = lazy(() =>
      loadSeason(season).then((components) => ({
        default: function SeasonDecorations({ ids, onReady }: ViewProps) {
          useEffect(onReady, [onReady]);
          return (
            <>
              {ids.map((id) => {
                const Decoration = components[id];
                return Decoration ? <Decoration key={id} /> : null;
              })}
            </>
          );
        },
      })),
    );
    views.set(season, view);
  }
  return view;
}
