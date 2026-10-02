import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { loadMeta, prefetch } from './api';
import { DIPS_PATH, feedPath } from './pages/Home';
import './styles.css';

// Kick off the landing page's data now, in parallel with React's first render.
loadMeta().catch(() => {});
if (location.pathname === '/') {
  prefetch(feedPath(new URLSearchParams(location.search)));
  prefetch(DIPS_PATH);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

// Keep the push service worker registered so alerts keep flowing after reloads.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
