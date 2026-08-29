import { lazy, type ComponentType } from 'react';
import { withChunkTimeout } from '../core/chunkError';

/**
 * Every route's code-split page, built as a *set* rather than as module-level
 * constants (PLAN-22).
 *
 * `React.lazy` caches its outcome per component, and a rejection is sticky:
 * `lazyInitializer` re-invokes the loader only while the payload is still
 * uninitialised, so once a chunk fails to arrive that route throws the same
 * cached error on every later render — for the life of the tab. That made
 * "Try again" a lie, and left a page that failed while the bridge was down
 * broken after it came back, until a full reload.
 *
 * Calling this again produces fresh `lazy` payloads, so a retry is a genuine
 * second attempt. The app rebuilds the set only while a route failure is on
 * screen: new component identities remount the tree, and that is precisely the
 * moment when there is nothing to lose.
 *
 * Every loader is wrapped in `withChunkTimeout`, because a vanished host leaves
 * the request hanging rather than refusing it, and waiting out the browser's
 * own connect timeout is indistinguishable from the click having done nothing.
 */
function page<P, M>(load: () => Promise<M>, pick: (module: M) => ComponentType<P>) {
  return lazy(() => withChunkTimeout(load()).then((module) => ({ default: pick(module) })));
}

// Route-level code splitting: cloud builds never ship local-only pages.
export function createLazyPages() {
  return {
    UploadPage: page(
      () => import('../features/file-transfer/UploadPage'),
      (m) => m.UploadPage,
    ),
    DownloadsPage: page(
      () => import('../features/file-transfer/DownloadsPage'),
      (m) => m.DownloadsPage,
    ),
    PreviewModal: page(
      () => import('../features/previews/PreviewModal'),
      (m) => m.PreviewModal,
    ),
    UploadPreviewModal: page(
      () => import('../features/previews/UploadPreviewModal'),
      (m) => m.UploadPreviewModal,
    ),
    HermesPage: page(
      () => import('../features/hermes/HermesPage'),
      (m) => m.HermesPage,
    ),
    HeimdallModal: page(
      () => import('../features/heimdall/HeimdallModal'),
      (m) => m.HeimdallModal,
    ),
    WardensPage: page(
      () => import('../features/wardens/WardensPage'),
      (m) => m.WardensPage,
    ),
    RunestonePage: page(
      () => import('../features/runestone/RunestonePage'),
      (m) => m.RunestonePage,
    ),
    // One library over every document kind (PLAN-21). It is a shell across
    // several features, not a feature, so it lives in app/pages — and stays
    // lazy, as the two per-tool pages it replaces were.
    PensievePage: page(
      () => import('./pages/PensievePage'),
      (m) => m.PensievePage,
    ),
    VariantPage: page(
      () => import('../features/variant/VariantPage'),
      (m) => m.VariantPage,
    ),
    EddaPage: page(
      () => import('../features/edda/EddaPage'),
      (m) => m.EddaPage,
    ),
    EddaPreviewPage: page(
      () => import('../features/edda/EddaPreviewPage'),
      (m) => m.EddaPreviewPage,
    ),
    GrootPage: page(
      () => import('../features/groot/GrootPage'),
      (m) => m.GrootPage,
    ),
    LokiPage: page(
      () => import('../features/loki/LokiPage'),
      (m) => m.LokiPage,
    ),
    AccioPage: page(
      () => import('../features/accio/AccioPage'),
      (m) => m.AccioPage,
    ),
    NimbusPage: page(
      () => import('../features/nimbus/NimbusPage'),
      (m) => m.NimbusPage,
    ),
    PortkeyPage: page(
      () => import('../features/portkey/PortkeyPage'),
      (m) => m.PortkeyPage,
    ),
    // Nótt idle screensaver — desktop-only, so the whole chunk is loaded lazily
    // and only ever imported on a real computer that has actually gone idle.
    Screensaver: page(
      () => import('../features/screensaver/Screensaver'),
      (m) => m.Screensaver,
    ),
  };
}

export type LazyPages = ReturnType<typeof createLazyPages>;
