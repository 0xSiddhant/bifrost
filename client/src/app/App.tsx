import { useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { useCapabilities } from '../core/useCapabilities';
import { bifrostEvents, type SseStatus } from '../core/sse';

export function App() {
  const { capabilities, error } = useCapabilities();
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
      <header className="shell-header">
        <span className="brand">🌈 Bifrost</span>
        <nav className="shell-nav">
          {/* Placeholder nav — real pages arrive with each feature plan. */}
          {capabilities?.modules.map((moduleName) => (
            <NavLink key={moduleName} to="/" className="nav-item">
              {moduleName}
            </NavLink>
          ))}
        </nav>
        <span className={`sse-dot sse-${sseStatus}`} title={`live updates: ${sseStatus}`} />
      </header>
      <main className="shell-main">
        <Routes>
          <Route
            path="*"
            element={
              <section className="placeholder">
                <h1>Foundation ready</h1>
                <p>
                  {error
                    ? `API unreachable: ${error}`
                    : capabilities
                      ? `Profile "${capabilities.profile}" · modules: ${capabilities.modules.join(', ')}`
                      : 'Loading capabilities…'}
                </p>
                <p className="muted">The real UI lands in PLAN-01.</p>
              </section>
            }
          />
        </Routes>
      </main>
    </div>
  );
}
