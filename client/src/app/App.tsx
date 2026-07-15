import { lazy, Suspense, useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { useCapabilities } from '../core/useCapabilities';
import { bifrostEvents, type SseStatus } from '../core/sse';
import { ThemeSwitcher } from '../core/ui/ThemeSwitcher';
import { SkyRelics } from '../core/ui/SkyRelics';
import {
  ClipboardIcon,
  DownloadIcon,
  FolderIcon,
  QrIcon,
  UploadIcon,
  WifiOffIcon,
} from '../core/ui/icons';
import { HomePage } from './pages/HomePage';
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
const ClipboardPage = lazy(() =>
  import('../features/clipboard/ClipboardPage').then((m) => ({ default: m.ClipboardPage })),
);
const QrToolPage = lazy(() =>
  import('../features/qr-tool/QrToolPage').then((m) => ({ default: m.QrToolPage })),
);
const HeimdallPage = lazy(() =>
  import('../features/heimdall/HeimdallPage').then((m) => ({ default: m.HeimdallPage })),
);

/**
 * Static nav for the design review. PLAN-02+ derives this from
 * /api/capabilities so each profile only shows its loaded modules.
 * Heimdall is deliberately absent — it opens via gesture/shortcut only.
 */
const NAV = [
  { to: '/', label: 'Home', icon: <FolderIcon size={18} /> },
  { to: '/upload', label: 'Send', icon: <UploadIcon size={18} /> },
  { to: '/downloads', label: 'Receive', icon: <DownloadIcon size={18} /> },
  { to: '/clipboard', label: 'Clipboard', icon: <ClipboardIcon size={18} /> },
  { to: '/qr', label: 'QR', icon: <QrIcon size={18} /> },
];

export function App() {
  const { capabilities } = useCapabilities();
  const [sseStatus, setSseStatus] = useState<SseStatus>('connecting');

  useEffect(() => {
    const unsubscribe = bifrostEvents.onStatus(setSseStatus);
    bifrostEvents.connect();
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
        <NavLink to="/" className="wordmark">
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
            <Route path="/" element={<HomePage />} />
            <Route path="/upload" element={<UploadPage />} />
            <Route path="/downloads" element={<DownloadsPage />}>
              {/* Modal route: deep-linkable, back button closes the preview. */}
              <Route path=":id/preview" element={<PreviewModal />} />
            </Route>
            <Route path="/clipboard" element={<ClipboardPage />} />
            <Route path="/qr" element={<QrToolPage />} />
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
        <span className="mono caption">bifrost.local</span>
        <span className="caption">
          profile: {capabilities?.profile ?? '—'} · v0.1.0 ·{' '}
          <span className={`sse-dot sse-${sseStatus}`} /> {sseStatus}
        </span>
      </footer>
    </div>
  );
}
