import { useEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/**
 * A new page starts at its top. The window keeps its scroll offset across
 * client-side route changes, so a click near the foot of one page used to land
 * mid-content on the next (e.g. a contextual "How does this work?" link opening
 * /help/:slug at the old offset).
 *
 * Rendered once in the router's ROOT layout (next to RouteTitle / RouteFocus),
 * not per-section: the help routes (HelpRouteLayout) and the standalone pages
 * (StandalonePageLayout) are outside AppLayout, and when this lived in
 * AppLayout they never reset. RouteFocus relies on this (`preventScroll` on the
 * heading focus) — the reset here is the only thing that moves the viewport.
 *
 * PUSH/REPLACE only: Back and Forward (POP) keep the browser's own
 * restoration, and a hash navigation is a jump to a section, which the page
 * itself handles.
 *
 * Gated on the PATHNAME actually changing (not just `navigationType`): a
 * page-owned `setSearchParams(..., { replace: true })` — e.g. NotesPage's
 * `?date=` deep-link effect clearing its own param after scrolling to a day
 * group — is also a REPLACE navigation, and used to reset the window to (0, 0)
 * even though the pathname never changed. That's more than cosmetic: it can
 * cancel an in-flight smooth `scrollIntoView` the page just started (confirmed
 * — the deep-link scroll landed at 0 every time until this was scoped to real
 * page changes).
 */
export function ScrollReset(): null {
  const location = useLocation();
  const navigationType = useNavigationType();
  const previousPathnameRef = useRef(location.pathname);
  useEffect(() => {
    const pathnameChanged = previousPathnameRef.current !== location.pathname;
    previousPathnameRef.current = location.pathname;
    if (!pathnameChanged || navigationType === 'POP' || location.hash) return;
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
  }, [location.pathname, location.hash, navigationType]);
  return null;
}
