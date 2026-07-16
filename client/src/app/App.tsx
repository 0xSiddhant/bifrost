import { lazy, Suspense, useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { useCapabilities } from '../core/useCapabilities';
import { bifrostEvents, type SseStatus } from '../core/sse';
import { startDeviceRegistry } from '../core/devices';
import { ThemeSwitcher } from '../core/ui/ThemeSwitcher';
import { SkyRelics } from '../core/ui/SkyRelics';
import { useHeimdallGesture } from '../features/heimdall/useHeimdallGesture';
import {
  ClipboardIcon,
  DownloadIcon,
  FolderIcon,
  MonitorIcon,
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
const MuninnPage = lazy(() =>
  import('../features/muninn/MuninnPage').then((m) => ({ default: m.MuninnPage })),
);
const SigilPage = lazy(() =>
  import('../features/sigil/SigilPage').then((m) => ({ default: m.SigilPage })),
);
const HeimdallPage = lazy(() =>
  import('../features/heimdall/HeimdallPage').then((m) => ({ default: m.HeimdallPage })),
);
const WardensPage = lazy(() =>
  import('../features/wardens/WardensPage').then((m) => ({ default: m.WardensPage })),
);

/**
 * Static nav for the design review. PLAN-02+ derives this from
 * /api/capabilities so each profile only shows its loaded modules.
 * Heimdall is deliberately absent — it opens via gesture/shortcut only.
 */
const NAV = [
  { to: '/', label: 'Midgard', icon: <FolderIcon size={18} /> },
  { to: '/upload', label: 'Send', icon: <UploadIcon size={18} /> },
  { to: '/downloads', label: 'Receive', icon: <DownloadIcon size={18} /> },
  { to: '/muninn', label: 'Muninn', icon: <ClipboardIcon size={18} /> },
  { to: '/wardens', label: 'Wardens', icon: <MonitorIcon size={18} /> },
  { to: '/sigil', label: 'Sigil', icon: <QrIcon size={18} /> },
];

export function App() {
  const { capabilities } = useCapabilities();
  const { registerTap } = useHeimdallGesture();
  const [sseStatus, setSseStatus] = useState<SseStatus>('connecting');

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
        <NavLink to="/" className="wordmark" onClick={registerTap}>
          Bifrost
        </NavLink>
        <nav className="nav nav--top" aria-label="Main">
          {NAV.map((item) => (
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
            <Route path="/muninn" element={<MuninnPage />} />
            <Route path="/wardens" element={<WardensPage />} />
            <Route path="/sigil" element={<SigilPage />} />
            <Route path="/heimdall" element={<HeimdallPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </main>

      <nav className="nav nav--bottom" aria-label="Main">
        {NAV.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'} className="nav__item">
            {item.icon}
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <footer className="shell-footer">
        {/* The server-identity mark doubles as the hidden touch entry to
            Heimdall — N taps within 3s. Not a link, not labelled. */}
        <span
          className="mono caption footer-mark"
          onClick={registerTap}
          aria-hidden="true"
        >
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
