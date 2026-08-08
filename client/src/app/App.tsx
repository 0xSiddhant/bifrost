import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useCapabilities } from '../core/useCapabilities';
import { bifrostEvents, type SseStatus } from '../core/sse';
import { startDeviceRegistry } from '../core/devices';
import { fetchScreensaverConfig, type ScreensaverConfig } from '../core/screensaver';
import { isDesktopViewport } from '../features/screensaver/isDesktop';
import { useIdle } from '../features/screensaver/useIdle';
import { ThemeSwitcher } from '../core/ui/ThemeSwitcher';
import { SkyRelics } from '../core/ui/SkyRelics';
import { NotificationHost } from '../core/notify';
import { usePublishedBanner } from './usePublishedBanner';
import { useHeimdallGesture } from '../features/heimdall/useHeimdallGesture';
import { FolderIcon, SparklesIcon, WandIcon, WifiOffIcon } from '../core/ui/icons';
import { MidgardPage } from './pages/MidgardPage';
import { OllivandersPage } from './pages/OllivandersPage';
import { DiagonAlleyPage } from './pages/DiagonAlleyPage';
import { NotFoundPage } from './pages/NotFoundPage';

// Route-level code splitting: cloud builds never ship local-only pages.
const UploadPage = lazy(() =>
  import('../features/file-transfer/UploadPage').then((m) => ({ default: m.UploadPage })),
);
const DownloadsPage = lazy(() =>
  import('../features/file-transfer/DownloadsPage').then((m) => ({ default: m.DownloadsPage })),
);
const PreviewModal = lazy(() =>
  import('../features/previews/PreviewModal').then((m) => ({ default: m.PreviewModal })),
);
const UploadPreviewModal = lazy(() =>
  import('../features/previews/UploadPreviewModal').then((m) => ({
    default: m.UploadPreviewModal,
  })),
);
const HermesPage = lazy(() =>
  import('../features/hermes/HermesPage').then((m) => ({ default: m.HermesPage })),
);
const HeimdallModal = lazy(() =>
  import('../features/heimdall/HeimdallModal').then((m) => ({ default: m.HeimdallModal })),
);
const WardensPage = lazy(() =>
  import('../features/wardens/WardensPage').then((m) => ({ default: m.WardensPage })),
);
const RunestonePage = lazy(() =>
  import('../features/runestone/RunestonePage').then((m) => ({ default: m.RunestonePage })),
);
// One library over every document kind (PLAN-21). It is a shell across several
// features, not a feature, so it lives in app/pages — and stays lazy, as the
// two per-tool pages it replaces were.
const PensievePage = lazy(() =>
  import('./pages/PensievePage').then((m) => ({ default: m.PensievePage })),
);
const VariantPage = lazy(() =>
  import('../features/variant/VariantPage').then((m) => ({ default: m.VariantPage })),
);
const EddaPage = lazy(() =>
  import('../features/edda/EddaPage').then((m) => ({ default: m.EddaPage })),
);
const EddaPreviewPage = lazy(() =>
  import('../features/edda/EddaPreviewPage').then((m) => ({ default: m.EddaPreviewPage })),
);
const LokiPage = lazy(() =>
  import('../features/loki/LokiPage').then((m) => ({ default: m.LokiPage })),
);
const AccioPage = lazy(() =>
  import('../features/accio/AccioPage').then((m) => ({ default: m.AccioPage })),
);
const NimbusPage = lazy(() =>
  import('../features/nimbus/NimbusPage').then((m) => ({ default: m.NimbusPage })),
);
const PortkeyPage = lazy(() =>
  import('../features/portkey/PortkeyPage').then((m) => ({ default: m.PortkeyPage })),
);
// Nótt idle screensaver — desktop-only, so the whole chunk is loaded lazily and
// only ever imported on a real computer that has actually gone idle.
const Screensaver = lazy(() =>
  import('../features/screensaver/Screensaver').then((m) => ({ default: m.Screensaver })),
);

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
    match: ['/runestone', '/variant', '/edda', '/loki', '/pensieve'],
    modules: ['runestone', 'variant', 'edda', 'loki'],
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
        <Suspense fallback={<div className="page-loading caption">Crossing the bridge…</div>}>
          <Routes>
            <Route path="/" element={<MidgardPage />} />
            {/* Category hubs — the tools they list keep their own routes below. */}
            <Route path="/ollivanders" element={<OllivandersPage />} />
            <Route path="/diagon-alley" element={<DiagonAlleyPage />} />
            {/* The open tool lives in the URL: back closes the panel, refresh
                reopens it, and a tool is linkable (PLAN-18). */}
            <Route path="/diagon-alley/:toolId" element={<DiagonAlleyPage />} />
            <Route path="/upload" element={<UploadPage />}>
              {/* Preview a staged file before publishing it; back closes it. */}
              <Route path=":name/preview" element={<UploadPreviewModal />} />
            </Route>
            <Route path="/downloads" element={<DownloadsPage />}>
              {/* Modal route: deep-linkable, back button closes the preview. */}
              <Route path=":id/preview" element={<PreviewModal />} />
            </Route>
            <Route path="/hermes" element={<HermesPage />} />
            <Route path="/accio" element={<AccioPage />} />
            {/* pre-rename URL (shipped as "muninn") */}
            <Route path="/muninn" element={<Navigate to="/hermes" replace />} />
            {/* The one library, over every document kind (PLAN-21). */}
            <Route path="/pensieve" element={<PensievePage />} />
            <Route path="/runestone" element={<RunestonePage />} />
            {/* literal segments beat the :slug param — declared first for clarity.
                Every legacy library URL points straight at the unified page, so
                none of them double-redirects through another old one. */}
            <Route path="/runestone/pensieve" element={<Navigate to="/pensieve?type=runestone" replace />} />
            {/* pre-rename URLs (shipped as "library", then "mimir") */}
            <Route path="/runestone/library" element={<Navigate to="/pensieve?type=runestone" replace />} />
            <Route path="/runestone/mimir" element={<Navigate to="/pensieve?type=runestone" replace />} />
            <Route path="/runestone/:slug" element={<RunestonePage />} />
            <Route path="/variant" element={<VariantPage />} />
            {/* literal segments beat the :slug param — declared first */}
            <Route path="/edda" element={<EddaPage />} />
            <Route path="/edda/pensieve" element={<Navigate to="/pensieve?type=edda" replace />} />
            {/* pre-rename URL (development-only "library") */}
            <Route path="/edda/library" element={<Navigate to="/pensieve?type=edda" replace />} />
            <Route path="/edda/preview/:slug" element={<EddaPreviewPage />} />
            <Route path="/edda/:slug" element={<EddaPage />} />
            <Route path="/loki" element={<LokiPage />} />
            <Route path="/wardens" element={<WardensPage />} />
            {/* The QR page became a toolbox tool (PLAN-18). The root stays in
                RESERVED_ROOTS: this redirect is a real route, and a /go/sigil
                slug shadowing it would be confusing. */}
            <Route path="/sigil" element={<Navigate replace to="/diagon-alley/qr" />} />
            <Route path="/nimbus" element={<NimbusPage />} />
            <Route path="/portkey" element={<PortkeyPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </main>

      {/* Outside <Routes> on purpose: a notification raised on one page must
          survive navigating to another, so it cannot live inside the router. */}
      <NotificationHost />

      {/* Heimdall is a modal overlay, not a route — no URL, nothing to probe.
          Opened by the gesture/shortcut only (≥768px). */}
      {heimdallOpen && (
        <Suspense fallback={null}>
          <HeimdallModal onClose={() => setHeimdallOpen(false)} />
        </Suspense>
      )}

      {/* Nótt idle screensaver — mounted only while active (desktop-only). */}
      {screensaverActive && screensaverConfig && (
        <Suspense fallback={null}>
          <Screensaver config={screensaverConfig} onDismiss={dismissScreensaver} />
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
