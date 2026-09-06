import React from 'react';
import ReactDOM from 'react-dom/client';

// Self-hosted fonts (@fontsource — bundled woff2). CSP forbids third-party
// runtime origins: NEVER add a Google Fonts / CDN <link> instead.
// Inter carries EVERY in-app surface (the web stand-in for mobile's SF/Roboto).
// Instrument Serif survives for the signed-out hero wordmark ONLY (spec §3.1 /
// §6.1) — the 400 upright face, nothing else. Never reintroduce it in-app.
import '@fontsource/instrument-serif/400.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';

import '@/styles/globals.css';
import '@/i18n'; // Initialize i18n (side effect)
import { initAnalytics } from '@/lib/posthog';
import { installBootErrorBuffer } from '@/lib/bootErrorBuffer';
import App from '@/App';

// FIRST statement, before the render and before analytics is even scheduled:
// posthog-js only starts catching window errors / unhandled rejections inside
// `init()`, which the schedule below deliberately pushes past first paint. Two
// `addEventListener` calls hold anything thrown in that gap (max 10, sanitized)
// for `initAnalytics` to replay — or discard, if the visitor declined. See
// lib/bootErrorBuffer.ts. Errors thrown while the imports ABOVE evaluate are
// still out of reach (ESM hoists them ahead of this line) — accepted.
installBootErrorBuffer();

// Deferred to AFTER first paint so the (lazily fetched) posthog-js chunk never
// competes with the initial render for bandwidth/main-thread time, and never
// forces posthog-js into the entry bundle's synchronous module graph.
// `requestIdleCallback` runs once the browser is idle; `setTimeout` is the
// fallback for engines that don't implement it (Safari). No-op either way
// when VITE_POSTHOG_KEY is unset.
function scheduleAnalyticsInit(): void {
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
  };
  if (typeof w.requestIdleCallback === 'function') {
    // `timeout: 2000` guarantees the callback still fires on a busy/never-idle
    // tab (e.g. constant animation or polling) instead of deferring analytics
    // indefinitely.
    w.requestIdleCallback(() => initAnalytics(), { timeout: 2000 });
  } else {
    setTimeout(() => initAnalytics(), 0);
  }
}
scheduleAnalyticsInit();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
