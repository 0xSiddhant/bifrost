import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { useCapabilities } from '../core/useCapabilities';
import { bifrostEvents, type SseStatus } from '../core/sse';
import { startDeviceRegistry } from '../core/devices';
import { ThemeSwitcher } from '../core/ui/ThemeSwitcher';
import { SkyRelics } from '../core/ui/SkyRelics';
import { useHeimdallGesture } from '../features/heimdall/useHeimdallGesture';
import {
  BracesIcon,
  ClipboardIcon,
  DiffIcon,
  DownloadIcon,
  FolderIcon,
  QrIcon,
  UploadIcon,
  WifiOffIcon,
} from '../core/ui/icons';
import { MidgardPage } from './pages/MidgardPage';
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
const HermesPage = lazy(() =>
  import('../features/hermes/HermesPage').then((m) => ({ default: m.HermesPage })),
);
const SigilPage = lazy(() =>
  import('../features/sigil/SigilPage').then((m) => ({ default: m.SigilPage })),
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
const PensievePage = lazy(() =>
  import('../features/runestone/PensievePage').then((m) => ({ default: m.PensievePage })),
);
const VariantPage = lazy(() =>
  import('../features/variant/VariantPage').then((m) => ({ default: m.VariantPage })),
);

/**
 * Nav renders from /api/capabilities: an entry appears only when its module is
 * loaded in the active deploy profile (until capabilities arrive, all entries
 * show to avoid a layout pop on the common local profile).
 * Heimdall is deliberately absent — it opens via gesture/shortcut only.
 */
const NAV = [
  { to: '/', label: 'Midgard', icon: <FolderIcon size={18} />, module: null },
  { to: '/upload', label: 'Send', icon: <UploadIcon size={18} />, module: 'file-transfer' },
  { to: '/downloads', label: 'Receive', icon: <DownloadIcon size={18} />, module: 'file-transfer' },
  { to: '/hermes', label: 'Hermes', icon: <ClipboardIcon size={18} />, module: 'clipboard' },
  { to: '/runestone', label: 'Runestone', icon: <BracesIcon size={18} />, module: 'runestone' },
  { to: '/variant', label: 'Variant', icon: <DiffIcon size={18} />, module: 'variant' },
  // Wardens is not a top-nav page — the device roster lives in Heimdall's
  // Wardens section. The /wardens route stays reachable for existing links.
  { to: '/sigil', label: 'Sigil', icon: <QrIcon size={18} />, module: 'qr-tool' },
];

export function App() {
  const { capabilities } = useCapabilities();
  const [heimdallOpen, setHeimdallOpen] = useState(false);
  const { registerTap } = useHeimdallGesture(() => setHeimdallOpen(true));
  const [sseStatus, setSseStatus] = useState<SseStatus>('connecting');
  const nav = NAV.filter(
    (item) =>
      item.module === null || !capabilities || capabilities.modules.includes(item.module),
  );

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
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'} className="nav__item">
              {item.icon}
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <ThemeSwitcher />
      </header>

      {sseStatus === 'closed' && (
        <div className="offline-banner" role="status">
          <WifiOffIcon size={16} />
          <span>Connection to the bridge lost — reconnecting…</span>
        </div>
      )}

      <main className="shell-main">
        <Suspense fallback={<div className="page-loading caption">Crossing the bridge…</div>}>
          <Routes>
            <Route path="/" element={<MidgardPage />} />
            <Route path="/upload" element={<UploadPage />} />
            <Route path="/downloads" element={<DownloadsPage />}>
              {/* Modal route: deep-linkable, back button closes the preview. */}
              <Route path=":id/preview" element={<PreviewModal />} />
            </Route>
            <Route path="/hermes" element={<HermesPage />} />
            {/* pre-rename URL (shipped as "muninn") */}
            <Route path="/muninn" element={<Navigate to="/hermes" replace />} />
            <Route path="/runestone" element={<RunestonePage />} />
            {/* literal segments beat the :slug param — declared first for clarity */}
            <Route path="/runestone/pensieve" element={<PensievePage />} />
            {/* pre-rename URLs (shipped as "library", then "mimir") */}
            <Route path="/runestone/library" element={<Navigate to="/runestone/pensieve" replace />} />
            <Route path="/runestone/mimir" element={<Navigate to="/runestone/pensieve" replace />} />
            <Route path="/runestone/:slug" element={<RunestonePage />} />
            <Route path="/variant" element={<VariantPage />} />
            <Route path="/wardens" element={<WardensPage />} />
            <Route path="/sigil" element={<SigilPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </main>

      {/* Heimdall is a modal overlay, not a route — no URL, nothing to probe.
          Opened by the gesture/shortcut only (≥768px). */}
      {heimdallOpen && (
        <Suspense fallback={null}>
          <HeimdallModal onClose={() => setHeimdallOpen(false)} />
        </Suspense>
      )}

      <nav className="nav nav--bottom" aria-label="Main">
        {nav.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'} className="nav__item">
            {item.icon}
            <span>{item.label}</span>
          </NavLink>
        ))}
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
