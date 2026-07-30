import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './app/App';
import { initTheme } from './core/theme';
import { initClientLogging } from './core/log';
import { ErrorBoundary } from './core/ui/ErrorBoundary';
import './core/fonts.css';
import './core/tokens.css';
import './core/base.css';
import './core/ui/ui.css';
import './app/app.css';

initTheme();
// Before render: a throw during the first paint is exactly the kind this is
// here to catch, and the global handlers must already be attached (PLAN-16a).
initClientLogging();

const container = document.getElementById('root');
if (!container) throw new Error('missing #root element');

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
