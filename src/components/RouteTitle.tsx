import { useLayoutEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

/**
 * Sets a unique, descriptive document <title> per route (WCAG SC 2.4.2, Level A).
 * Rendered once high in the router tree. Maps the current pathname to an i18n
 * page-title key; dynamic circle routes are matched by their trailing segment.
 *
 * `/invite/:code` and `/help/*` are deliberately excluded — InviteLandingPage,
 * HelpArticlePage and HelpCategoryPage own their <title> via Helmet. Unknown
 * paths (NotFoundPage, which sets "Page not found" via Helmet) are left alone too.
 *
 * WHY NOT <Helmet> HERE: RouteTitle sits above the lazy pages, under App.tsx's
 * single <Suspense>. A signed-in boot renders it while AuthGuard is still
 * bootstrapping; bootstrap then resolves through the zustand store (a SYNC update,
 * not a router transition), the lazy page suspends and React hides the visible
 * tree. Hiding calls componentWillUnmount on react-helmet-async's class
 * Dispatcher, which removes it from the instance list, and on reveal it is never
 * re-added (its `rendered` flag is already set). Every later title change was then
 * computed without it, so the tab froze on "Choose a circle" (prod bug 1.4.3,
 * RouteTitle.circleNavigation.test.tsx). A layout effect is re-created on reveal
 * and re-runs on every title change, so it cannot be orphaned that way. It runs
 * before the Helmet pages' deferred (requestAnimationFrame) write, so their own
 * titles still win where they set one.
 */
const STATIC_TITLES: Record<string, string> = {
  '/login': 'pageTitles.login',
  '/signup': 'pageTitles.signup',
  '/how-it-works': 'pageTitles.howItWorks',
  '/verify-email': 'pageTitles.verifyEmail',
  '/verify-email/start': 'pageTitles.verifyRequest',
  '/forgot-password': 'pageTitles.forgotPassword',
  '/reset-password': 'pageTitles.resetPassword',
  '/auth/callback': 'auth:callbackTitle',
  '/circles': 'pageTitles.circlePicker',
  '/invites': 'pageTitles.invites',
  '/notifications': 'pageTitles.notifications',
  '/profile': 'pageTitles.profile',
  '/upgrade': 'pageTitles.upgrade',
  '/help': 'pageTitles.help',
};

const CIRCLE_SUBTITLES: Record<string, string> = {
  calendar: 'pageTitles.calendar',
  meds: 'pageTitles.meds',
  tasks: 'pageTitles.tasks',
  notes: 'pageTitles.notes',
  activity: 'pageTitles.activity',
  emergency: 'pageTitles.emergency',
  documents: 'pageTitles.documents',
  vitals: 'pageTitles.vitals',
  members: 'pageTitles.members',
  settings: 'pageTitles.settings',
  'daily-update': 'pageTitles.dailyUpdate',
  'routine-check-in': 'pageTitles.routineCheckIn',
  welcome: 'pageTitles.welcome',
  notifications: 'pageTitles.notifications',
};

function titleKeyForPath(pathname: string): string | null {
  if (STATIC_TITLES[pathname]) {
    return STATIC_TITLES[pathname];
  }
  // /profile/:section — one settings page (lib/settingsSections.ts).
  if (/^\/profile\/[^/]+\/?$/.test(pathname)) {
    return 'pageTitles.profile';
  }
  // /circles/:circleId  → overview;  /circles/:circleId/<sub> → sub page
  // The daily update also takes a trailing date segment (/daily-update/2026-10-08).
  const circleMatch =
    pathname.match(/^\/circles\/[^/]+(?:\/([^/]+))?\/?$/) ??
    pathname.match(/^\/circles\/[^/]+\/(daily-update)\/\d{4}-\d{2}-\d{2}\/?$/);
  // /circles/:circleId/providers/:providerId — one doctor's Visits & notes.
  if (/^\/circles\/[^/]+\/providers\/[^/]+\/?$/.test(pathname)) {
    return 'pageTitles.providerVisits';
  }
  if (circleMatch) {
    const sub = circleMatch[1];
    if (!sub) {
      return 'pageTitles.overview';
    }
    if (CIRCLE_SUBTITLES[sub]) {
      return CIRCLE_SUBTITLES[sub];
    }
  }
  return null;
}

export function routeTitleFor(
  pathname: string,
  t: (key: string) => string
): string | null {
  // InviteLandingPage sets its own title — never override it.
  // HelpArticlePage and HelpCategoryPage (/help/c/:category) set theirs the same way.
  if (pathname.startsWith('/invite/') || pathname.startsWith('/help/')) {
    return null;
  }
  const key = titleKeyForPath(pathname);
  // No key: NotFoundPage (or a redirect hop) — the page owns the title.
  return key ? `${t(key)} · CircleCare` : null;
}

export function RouteTitle(): null {
  const { pathname } = useLocation();
  const { t } = useTranslation('common');
  const title = routeTitleFor(pathname, t);

  useLayoutEffect(() => {
    if (title !== null) {
      document.title = title;
    }
  }, [title]);

  return null;
}
