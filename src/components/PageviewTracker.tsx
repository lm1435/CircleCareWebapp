import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { trackPageview } from '@/lib/pageview';

/**
 * Fires a sanitized `$pageview` on initial load and on every route change.
 * Rendered once in the router's root layout (next to RouteTitle) so it sits
 * inside the RouterProvider tree and sees every navigation.
 *
 * Only `location.pathname` is read — hash/search (OAuth token fragments, invite
 * codes) never reach analytics; see lib/pageview.ts. trackPageview itself
 * no-ops when PostHog isn't configured (missing VITE_POSTHOG_KEY).
 */
export function PageviewTracker(): null {
  const { pathname } = useLocation();

  useEffect(() => {
    trackPageview(pathname);
  }, [pathname]);

  return null;
}
