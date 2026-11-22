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
import { whenIdle } from '../ui/whenIdle';
import { DecorBoundary } from './DecorBoundary';
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
 * three slots. Whatever goes wrong inside costs the decorations, never the
 * shell (`DecorBoundary`): a chunk that cannot load is reported once and the
 * slot stays empty until it next mounts (the theme or a switch turning its
 * decorations off and on), which tries again.
 *
 * The wrapper is `display: contents`, so a decoration lays out as if it were
 * the slot's parent's own child; `data-decor-state` (`empty`, `loading`,
 * `ready`, `failed`) is what the e2e journeys wait for.
 */
export function DecorSlot({ slot }: { slot: DecorSlotName }) {
  const decorations = useSlotDecorations(slot);
  const season = installedSeason();
  const [idle, setIdle] = useState(false);
  const [settled, setSettled] = useState<'ready' | 'failed' | null>(null);
  const markReady = useCallback(() => setSettled('ready'), []);
  const markFailed = useCallback(() => setSettled('failed'), []);
  useEffect(() => whenIdle(() => setIdle(true)), []);

  const ids = decorations.map((decoration) => decoration.id);
  const wanted = season !== null && ids.length > 0;
  // A slot that stops showing decorations forgets how its last ones ended, so
  // the next ones report `loading` until they are actually on the page.
  if (!wanted && settled !== null) setSettled(null);
  const state = !wanted ? 'empty' : (settled ?? 'loading');
  const View = wanted && idle ? seasonView(season) : null;

  return (
    <div style={{ display: 'contents' }} data-decor-slot={slot} data-decor-state={state}>
      {View && (
        <DecorBoundary slot={slot} onError={markFailed}>
          <Suspense fallback={null}>
            <View ids={ids} onReady={markReady} />
          </Suspense>
        </DecorBoundary>
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

/**
 * The season's components, fetched once for all three slots. A failed fetch
 * is reported once and forgotten, so the next slot to mount fetches again
 * rather than replaying the failure for the rest of the session.
 */
export function loadSeason(season: Season): Promise<DecorationComponents> {
  let chunk = chunks.get(season);
  if (!chunk) {
    chunk = withChunkTimeout(season.load()).catch((error: unknown) => {
      chunks.delete(season);
      views.delete(season);
      const reason = error instanceof Error ? error.message : String(error);
      log.warn(`decor: the ${season.id} season's decorations could not be loaded: ${reason}`, {
        module: 'decor',
      });
      throw error;
    });
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
