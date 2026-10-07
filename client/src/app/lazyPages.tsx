import { lazy, type ComponentType } from 'react';
import { withChunkTimeout } from '../core/chunkError';
import { BridgeClosedPage } from '../core/ui/BridgeClosed';

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

/**
 * Route-level code splitting. A hub-only page is `__HUB__ ? page(…) :
 * BridgeClosedPage`, written out at each entry rather than through a helper:
 * the `import()` must sit in the branch the standalone build drops, or its
 * chunk (and every request path in it) is emitted anyway (PLAN-35).
 */
export function createLazyPages() {
  return {
    UploadPage: __HUB__
      ? page(
          () => import('../features/file-transfer/UploadPage'),
          (m) => m.UploadPage,
        )
      : BridgeClosedPage,
    DownloadsPage: __HUB__
      ? page(
          () => import('../features/file-transfer/DownloadsPage'),
          (m) => m.DownloadsPage,
        )
      : BridgeClosedPage,
    DownloadFolderPage: __HUB__
      ? page(
          () => import('../features/file-transfer/DownloadFolderPage'),
          (m) => m.DownloadFolderPage,
        )
      : BridgeClosedPage,
    PreviewModal: __HUB__
      ? page(
          () => import('../features/previews/PreviewModal'),
          (m) => m.PreviewModal,
        )
      : BridgeClosedPage,
    UploadPreviewModal: __HUB__
      ? page(
          () => import('../features/previews/UploadPreviewModal'),
          (m) => m.UploadPreviewModal,
        )
      : BridgeClosedPage,
    HermesPage: __HUB__
      ? page(
          () => import('../features/hermes/HermesPage'),
          (m) => m.HermesPage,
        )
      : BridgeClosedPage,
    HeimdallModal: page(
      () => import('../features/heimdall/HeimdallModal'),
      (m) => m.HeimdallModal,
    ),
    WardensPage: __HUB__
      ? page(
          () => import('../features/wardens/WardensPage'),
          (m) => m.WardensPage,
        )
      : BridgeClosedPage,
    RunestonePage: page(
      () => import('../features/runestone/RunestonePage'),
      (m) => m.RunestonePage,
    ),
    // One library over every document kind (PLAN-21). It is a shell across
    // several features, not a feature, so it lives in app/pages — and stays
    // lazy, as the two per-tool pages it replaces were.
    PensievePage: __HUB__
      ? page(
          () => import('./pages/PensievePage'),
          (m) => m.PensievePage,
        )
      : BridgeClosedPage,
    VariantPage: page(
      () => import('../features/variant/VariantPage'),
      (m) => m.VariantPage,
    ),
    EddaPage: page(
      () => import('../features/edda/EddaPage'),
      (m) => m.EddaPage,
    ),
    EddaPreviewPage: __HUB__
      ? page(
          () => import('../features/edda/EddaPreviewPage'),
          (m) => m.EddaPreviewPage,
        )
      : BridgeClosedPage,
    GrootPage: page(
      () => import('../features/groot/GrootPage'),
      (m) => m.GrootPage,
    ),
    AtlasPage: page(
      () => import('../features/atlas/AtlasPage'),
      (m) => m.AtlasPage,
    ),
    LokiPage: page(
      () => import('../features/loki/LokiPage'),
      (m) => m.LokiPage,
    ),
    BrotliPage: __HUB__
      ? page(
          () => import('../features/brotli/BrotliPage'),
          (m) => m.BrotliPage,
        )
      : BridgeClosedPage,
    AccioPage: __HUB__
      ? page(
          () => import('../features/accio/AccioPage'),
          (m) => m.AccioPage,
        )
      : BridgeClosedPage,
    NimbusPage: __HUB__
      ? page(
          () => import('../features/nimbus/NimbusPage'),
          (m) => m.NimbusPage,
        )
      : BridgeClosedPage,
    PortkeyPage: __HUB__
      ? page(
          () => import('../features/portkey/PortkeyPage'),
          (m) => m.PortkeyPage,
        )
      : BridgeClosedPage,
    SagaPage: page(
      () => import('../features/saga/SagaPage'),
      (m) => m.SagaPage,
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
