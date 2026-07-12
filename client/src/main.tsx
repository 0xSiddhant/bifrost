import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './app/App';
import { initTheme } from './core/theme';
import './core/fonts.css';
import './core/tokens.css';
import './core/base.css';
import './core/ui/ui.css';
import './app/app.css';

initTheme();

const container = document.getElementById('root');
if (!container) throw new Error('missing #root element');

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
