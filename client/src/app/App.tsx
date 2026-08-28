import { Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useCapabilities } from '../core/useCapabilities';
import { bifrostEvents, type SseStatus } from '../core/sse';
import { startDeviceRegistry } from '../core/devices';
import { log } from '../core/log';
import { fetchScreensaverConfig, type ScreensaverConfig } from '../core/screensaver';
import {
  fetchOfflineModeConfig,
  enabledTargets,
  targetLabel,
  OFF_STATUS,
  type OfflineModeConfig,
  type WarmLoadStatus,
} from '../core/offlineMode';
import { isDesktopViewport } from '../features/screensaver/isDesktop';
import { useIdle } from '../features/screensaver/useIdle';
import { ThemeSwitcher } from '../core/ui/ThemeSwitcher';
import { OfflineModeToggle } from '../core/ui/OfflineModeToggle';
import { RouteBoundary } from '../core/ui/RouteBoundary';
import { SkyRelics } from '../core/ui/SkyRelics';
import { NotificationHost } from '../core/notify';
import { usePublishedBanner } from './usePublishedBanner';
import { runWarmLoad } from './offlineWarmLoad';
import { createLazyPages } from './lazyPages';
import { useHeimdallGesture } from '../features/heimdall/useHeimdallGesture';
import { FolderIcon, SparklesIcon, WandIcon, WifiOffIcon } from '../core/ui/icons';
import { MidgardPage } from './pages/MidgardPage';
import { OllivandersPage } from './pages/OllivandersPage';
import { DiagonAlleyPage } from './pages/DiagonAlleyPage';
import { NotFoundPage } from './pages/NotFoundPage';

/**
 * Nav is three category tabs (was a flat seven that overflowed the mobile bar).
 * Each tab is a hub page whose tools live as cards there and keep their own
 * routes: Midgard (Send/Receive/Hermes/Join Bifrost), Ollivanders (Runestone/
 * Variant/Edda), Diagon Alley (Nimbus and Portkey, plus the tools that expand
 * in place at /diagon-alley/:toolId rather than owning a route). A tab
 * appears only when at least one of its modules is loaded in the active deploy
 * profile. Heimdall is deliberately absent — it opens via gesture/shortcut only.
 */
interface NavCategory {
  to: string;
  label: string;
  icon: ReactNode;
  /** Sub-page path prefixes that also light this tab as active. */
  match?: string[];
  /** Tab shows when any of these modules is available (null = always). */
  modules: (string | null)[];
}

const NAV: NavCategory[] = [
  { to: '/', label: 'Midgard', icon: <FolderIcon size={18} />, modules: [null] },
  {
    to: '/ollivanders',
    label: 'Ollivanders',
    icon: <WandIcon size={18} />,
    match: ['/runestone', '/variant', '/edda', '/groot', '/loki', '/pensieve'],
    modules: ['runestone', 'variant', 'edda', 'groot', 'loki'],
  },
  {
    to: '/diagon-alley',
    label: 'Diagon Alley',
    icon: <SparklesIcon size={18} />,
    match: ['/nimbus', '/portkey'],
    modules: ['qr-tool', 'nimbus', 'portkey'],
  },
];

export function App() {
  const { capabilities } = useCapabilities();
  const [heimdallOpen, setHeimdallOpen] = useState(false);
  const { registerTap } = useHeimdallGesture(() => setHeimdallOpen(true));
  usePublishedBanner();
  const [sseStatus, setSseStatus] = useState<SseStatus>('connecting');
  const { pathname } = useLocation();

  // Fresh `lazy` payloads on every bump. React caches a lazy rejection for the
  // life of the payload, so retrying a page whose chunk never arrived means
  // building it again — see lazyPages. Only ever bumped while a route failure
  // is on screen, since new component identities remount the tree.
  const [pageEpoch, setPageEpoch] = useState(0);
  const pages = useMemo(() => createLazyPages(), [pageEpoch]);
  const retryPages = useCallback(() => setPageEpoch((epoch) => epoch + 1), []);

  // Nótt (idle screensaver). The desktop gate is decided once; on a phone/tablet
  // we never fetch config, never arm the idle timer, never load the overlay.
  const [isDesktop] = useState(() => isDesktopViewport());
  const [screensaverConfig, setScreensaverConfig] = useState<ScreensaverConfig | null>(null);
  const [screensaverActive, setScreensaverActive] = useState(false);
  const dismissScreensaver = useCallback(() => setScreensaverActive(false), []);

  useEffect(() => {
    if (!isDesktop) return;
    let cancelled = false;
    fetchScreensaverConfig()
      .then((cfg) => {
        if (!cancelled) setScreensaverConfig(cfg);
      })
      .catch(() => {
        // Module absent (older/cloud server) — the saver simply stays disabled.
      });
    // Heimdall edits broadcast the new policy; rebind live without a reload.
    const off = bifrostEvents.on('screensaver.settingsUpdated', (payload) => {
      setScreensaverConfig((prev) =>
        prev ? { ...prev, ...(payload as Partial<ScreensaverConfig>) } : prev,
      );
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [isDesktop]);

  // Offline mode (PLAN-22). The warmed chunks belong to the tab, not to a page,
  // so both the policy and the status live here in the persistent shell —
  // navigating between the two gated pages must not reset the pill to Off.
  const [offlineConfig, setOfflineConfig] = useState<OfflineModeConfig | null>(null);
  const [warmStatus, setWarmStatus] = useState<WarmLoadStatus>(OFF_STATUS);

  useEffect(() => {
    let cancelled = false;
    fetchOfflineModeConfig()
      .then((cfg) => {
        if (!cancelled) setOfflineConfig(cfg);
      })
      .catch((error: unknown) => {
        // The toggle stays disabled without this, so a silent failure would
        // read as a dead control with no explanation anywhere.
        log.reportError('offline mode: could not read policy config', error, {
          module: 'offline-mode',
        });
      });
    // An admin narrowing the registry must reach tabs that are already open.
    const off = bifrostEvents.on('offlineMode.settingsUpdated', (payload) => {
      setOfflineConfig(payload as OfflineModeConfig);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const armOffline = useCallback(
    (on: boolean) => {
      if (!on) {
        // Nothing to un-import: the switch arms the load, it does not hold it.
        setWarmStatus(OFF_STATUS);
        return;
      }
      if (!offlineConfig) return;
      const targets = enabledTargets(offlineConfig);
      setWarmStatus({ state: 'warming', loaded: 0, failed: [] });
      void runWarmLoad(targets.map((target) => target.id)).then(({ loaded, failed }) => {
        setWarmStatus(
          failed.length === 0
            ? { state: 'ready', loaded: loaded.length, failed: [] }
            : {
                state: 'partial',
                loaded: loaded.length,
                failed: failed.map((id) => targetLabel(offlineConfig, id)),
              },
        );
      });
    },
    [offlineConfig],
  );

  useIdle({
    enabled: isDesktop && Boolean(screensaverConfig?.enabled) && !screensaverActive,
    idleMs: (screensaverConfig?.idleSeconds ?? 60) * 1000,
    onIdle: () => {
      // If the admin panel is open when we go idle, close it first (it must not
      // sit under the overlay), then raise the saver.
      setHeimdallOpen(false);
      setScreensaverActive(true);
    },
  });
  const nav = NAV.filter((category) =>
    category.modules.some(
      (module) => module === null || !capabilities || capabilities.modules.includes(module),
    ),
  );
  // Page-scoped, not a global control (PLAN-22): only the two hubs whose pages
  // compute locally offer it — Ollivanders, and Diagon Alley with or without an
  // open tool.
  const showOfflineToggle =
    pathname === '/ollivanders' ||
    pathname === '/diagon-alley' ||
    pathname.startsWith('/diagon-alley/');

  // A category tab is active on its own page and on any of its tools' pages.
  const isActive = (category: NavCategory) => {
    if (category.to === '/') return pathname === '/';
    const paths = [category.to, ...(category.match ?? [])];
    return paths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  };
  const navItems = () =>
    nav.map((category) => (
      <Link
        key={category.to}
        to={category.to}
        className={isActive(category) ? 'nav__item active' : 'nav__item'}
        aria-current={isActive(category) ? 'page' : undefined}
      >
        {category.icon}
        <span>{category.label}</span>
      </Link>
    ));

  useEffect(() => {
    const unsubscribe = bifrostEvents.onStatus(setSseStatus);
    bifrostEvents.connect();
    startDeviceRegistry();
    return () => {
      unsubscribe();
      bifrostEvents.close();
    };
  }, []);

  return (
    <div className="shell">
      <div className="sky" aria-hidden="true">
        <SkyRelics />
      </div>
      <div className="bridge-strip" aria-hidden="true" />
      <header className="shell-header">
        {/* Home link, and the mobile Heimdall tap target (the footer mark is
            hidden on phones). 7 rapid taps open the gate; single taps go home. */}
        {/* Home link, and (≥768px) the Heimdall tap entry: N rapid taps open the
            modal; single taps go home. Below the threshold registerTap no-ops. */}
        <NavLink to="/" className="wordmark" onClick={registerTap}>
          Bifrost
        </NavLink>
        <nav className="nav nav--top" aria-label="Main">
          {navItems()}
        </nav>
        {showOfflineToggle && (
          <OfflineModeToggle
            status={warmStatus}
            ready={offlineConfig !== null}
            onChange={armOffline}
          />
        )}
        <ThemeSwitcher />
      </header>

      {sseStatus === 'closed' && (
        <div className="offline-banner" role="status">
          <WifiOffIcon size={16} />
          <span>Connection to the bridge lost — reconnecting…</span>
        </div>
      )}

      {/* Diagon Alley is a grid of small cards, not a reading column: it takes
          the full window so the toolbox gets as many columns as the screen can
          hold (PLAN-18). Every other page keeps the 62rem measure. */}
      <main className={pathname.startsWith('/diagon-alley') ? 'shell-main shell-main--wide' : 'shell-main'}>
        {/* Between the shell and the pages: a route whose chunk cannot be
            fetched (offline, or the bridge is down) shows a message here
            instead of taking the whole app down with it. */}
        <RouteBoundary pathname={pathname} retryToken={pageEpoch} onRetry={retryPages}>
          <Suspense fallback={<div className="page-loading caption">Crossing the bridge…</div>}>
            <Routes>
              <Route path="/" element={<MidgardPage />} />
              {/* Category hubs — the tools they list keep their own routes below. */}
              <Route path="/ollivanders" element={<OllivandersPage />} />
              <Route path="/diagon-alley" element={<DiagonAlleyPage />} />
              {/* The open tool lives in the URL: back closes the panel, refresh
                  reopens it, and a tool is linkable (PLAN-18). */}
              <Route path="/diagon-alley/:toolId" element={<DiagonAlleyPage />} />
              <Route path="/upload" element={<pages.UploadPage />}>
                {/* Preview a staged file before publishing it; back closes it. */}
                <Route path=":name/preview" element={<pages.UploadPreviewModal />} />
              </Route>
              <Route path="/downloads" element={<pages.DownloadsPage />}>
                {/* Modal route: deep-linkable, back button closes the preview. */}
                <Route path=":id/preview" element={<pages.PreviewModal />} />
              </Route>
              <Route path="/hermes" element={<pages.HermesPage />} />
              <Route path="/accio" element={<pages.AccioPage />} />
              {/* pre-rename URL (shipped as "muninn") */}
              <Route path="/muninn" element={<Navigate to="/hermes" replace />} />
              {/* The one library, over every document kind (PLAN-21). */}
              <Route path="/pensieve" element={<pages.PensievePage />} />
              <Route path="/runestone" element={<pages.RunestonePage />} />
              {/* literal segments beat the :slug param — declared first for clarity.
                  Every legacy library URL points straight at the unified page, so
                  none of them double-redirects through another old one. */}
              <Route path="/runestone/pensieve" element={<Navigate to="/pensieve?type=runestone" replace />} />
              {/* pre-rename URLs (shipped as "library", then "mimir") */}
              <Route path="/runestone/library" element={<Navigate to="/pensieve?type=runestone" replace />} />
              <Route path="/runestone/mimir" element={<Navigate to="/pensieve?type=runestone" replace />} />
              <Route path="/runestone/:slug" element={<pages.RunestonePage />} />
              <Route path="/variant" element={<pages.VariantPage />} />
              {/* literal segments beat the :slug param — declared first */}
              <Route path="/edda" element={<pages.EddaPage />} />
              <Route path="/edda/pensieve" element={<Navigate to="/pensieve?type=edda" replace />} />
              {/* pre-rename URL (development-only "library") */}
              <Route path="/edda/library" element={<Navigate to="/pensieve?type=edda" replace />} />
              <Route path="/edda/preview/:slug" element={<pages.EddaPreviewPage />} />
              <Route path="/edda/:slug" element={<pages.EddaPage />} />
              {/* literal segments beat the :slug param — declared first */}
              <Route path="/groot" element={<pages.GrootPage />} />
              <Route path="/groot/pensieve" element={<Navigate to="/pensieve?type=groot" replace />} />
              <Route path="/groot/library" element={<Navigate to="/pensieve?type=groot" replace />} />
              <Route path="/groot/:slug" element={<pages.GrootPage />} />
              <Route path="/loki" element={<pages.LokiPage />} />
              <Route path="/wardens" element={<pages.WardensPage />} />
              {/* The QR page became a toolbox tool (PLAN-18). The root stays in
                  RESERVED_ROOTS: this redirect is a real route, and a /go/sigil
                  slug shadowing it would be confusing. */}
              <Route path="/sigil" element={<Navigate replace to="/diagon-alley/qr" />} />
              <Route path="/nimbus" element={<pages.NimbusPage />} />
              <Route path="/portkey" element={<pages.PortkeyPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </RouteBoundary>
      </main>

      {/* Outside <Routes> on purpose: a notification raised on one page must
          survive navigating to another, so it cannot live inside the router. */}
      <NotificationHost />

      {/* Heimdall is a modal overlay, not a route — no URL, nothing to probe.
          Opened by the gesture/shortcut only (≥768px). */}
      {heimdallOpen && (
        <Suspense fallback={null}>
          <pages.HeimdallModal onClose={() => setHeimdallOpen(false)} />
        </Suspense>
      )}

      {/* Nótt idle screensaver — mounted only while active (desktop-only). */}
      {screensaverActive && screensaverConfig && (
        <Suspense fallback={null}>
          <pages.Screensaver config={screensaverConfig} onDismiss={dismissScreensaver} />
        </Suspense>
      )}

      <nav className="nav nav--bottom" aria-label="Main">
        {navItems()}
      </nav>

      <footer className="shell-footer">
        <span className="mono caption footer-mark" aria-hidden="true">
          bifrost.local
        </span>
        <span className="caption">
          profile: {capabilities?.profile ?? '—'} · v0.1.0 ·{' '}
          <span className={`sse-dot sse-${sseStatus}`} /> {sseStatus}
        </span>
      </footer>
    </div>
  );
}
