import React from 'react';
import ReactDOM from 'react-dom/client';

// Self-hosted fonts (@fontsource — bundled woff2). CSP forbids third-party
// runtime origins: NEVER add a Google Fonts / CDN <link> instead.
// Matches the mobile design system: Instrument Serif (display) + Inter (UI/data).
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';

import '@/styles/globals.css';
import '@/i18n'; // Initialize i18n (side effect)
import { initAnalytics } from '@/lib/posthog';
import App from '@/App';

initAnalytics(); // no-op when VITE_POSTHOG_KEY is unset

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
