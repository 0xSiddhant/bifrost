import { withChunkTimeout } from '../core/chunkError';
import { guidePanelChunk } from '../core/guide/GuideButton';
import { GUIDES } from '../core/guide/registry';
import { log } from '../core/log';

/**
 * Offline mode (PLAN-22) — the mechanism half: resolve the JS for the
 * pure-client pages while the LAN is still there, so an already-open tab can
 * navigate to them with zero network afterwards.
 *
 * Why this file is in `app/` and not `core/`: the loaders are `import()` calls
 * against `features/`, and only the composition-root tier may reach across
 * every feature. The server's registry travels as data (`core/offlineMode.ts`)
 * precisely because a loader cannot — so the two lists are joined here, by id.
 *
 * Calling `import()` directly, beside the `lazy()` wrappers in `App.tsx`, is
 * safe and does not double-fetch: ES modules are singletons per resolved URL
 * within a document's module graph, so this resolves the very module record
 * `React.lazy` reads later.
 */

/** id → loader. Ids mirror the server registry in `modules/offline-mode`. */
export type WarmLoaders = Record<string, () => Promise<unknown>>;

export const WARM_LOADERS: WarmLoaders = {
  // The whole Diagon Alley tool set is one chunk (PLAN-18), which is why the
  // registry is page-level: a per-tool entry would fetch exactly the same file.
  toolbox: () => import('../features/toolbox/ToolBody'),
  runestone: () => import('../features/runestone/RunestonePage'),
  groot: () => import('../features/groot/GrootPage'),
  atlas: () => import('../features/atlas/AtlasPage'),
  edda: () => import('../features/edda/EddaPage'),
  variant: () => import('../features/variant/VariantPage'),
  loki: () => import('../features/loki/LokiPage'),
  saga: () => import('../features/saga/SagaPage'),
  screensaver: () => import('../features/screensaver/Screensaver'),
};

/**
 * What the shell itself loads lazily, warmed on every arm beside whatever the
 * server's policy names (PLAN-40). The Guide panel and its texts belong to the
 * header on every page that has a guide, not to a page an admin chooses to
 * warm, so there is no policy switch for them: the server's registry has no
 * Guide entry, and a loader in `WARM_LOADERS` alone would never be asked for.
 *
 * One entry for the panel and all six texts, so the pill counts the Guide
 * once. The key doubles as its label: `targetLabel` falls back to the id for
 * anything the server's registry does not name, so a failure reads "Guide".
 */
export const SHELL_WARM_LOADERS: WarmLoaders = {
  Guide: () => Promise.all([guidePanelChunk.load(), ...GUIDES.map((guide) => guide.load())]),
};

export interface WarmLoadResult {
  loaded: string[];
  failed: string[];
}

/**
 * Fire every requested target together and report both halves. `allSettled`,
 * not `all`: one chunk failing must not cancel the five that would have
 * worked, and the caller needs the failures by name so the pill can say
 * *Partly ready* instead of a false *Ready*.
 */
export async function runWarmLoad(
  ids: string[],
  loaders: WarmLoaders = WARM_LOADERS,
): Promise<WarmLoadResult> {
  const known = ids.filter((id) => loaders[id] !== undefined);
  // A registry id with no loader means the server knows about a page this
  // client build does not — an older tab against a newer server. Nothing to
  // warm, but the mismatch is invisible without a line.
  for (const id of ids) {
    if (loaders[id] === undefined) {
      log.warn(`offline mode: no warm loader for "${id}"`, { module: 'offline-mode' });
    }
  }

  // Timed out, not merely raced: a host that has gone away leaves each request
  // hanging, and without a bound the pill sits on "Warming…" indefinitely.
  const settled = await Promise.allSettled(
    known.map((id) => withChunkTimeout(loaders[id]?.() ?? Promise.resolve())),
  );
  const result: WarmLoadResult = { loaded: [], failed: [] };
  settled.forEach((outcome, index) => {
    const id = known[index] ?? '';
    if (outcome.status === 'fulfilled') {
      result.loaded.push(id);
    } else {
      result.failed.push(id);
      const reason = outcome.reason instanceof Error ? outcome.reason : undefined;
      log.warn(`offline mode: warm load failed for "${id}"${reason ? `: ${reason.message}` : ''}`, {
        module: 'offline-mode',
        stack: reason?.stack,
      });
    }
  });
  return result;
}

/**
 * One arm of the Offline switch: the policy's targets, then the shell's own,
 * in one status. A shell id never collides with a server one (they are
 * capitalised labels), so the two maps join as they are.
 */
export function runOfflineWarmLoad(
  policyIds: string[],
  loaders: WarmLoaders = WARM_LOADERS,
  shell: WarmLoaders = SHELL_WARM_LOADERS,
): Promise<WarmLoadResult> {
  return runWarmLoad([...policyIds, ...Object.keys(shell)], { ...loaders, ...shell });
}
