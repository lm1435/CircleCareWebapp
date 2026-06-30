import { type ReactElement } from 'react';
import { Helmet } from 'react-helmet-async';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

/**
 * Sets a unique, descriptive document <title> per route (WCAG SC 2.4.2, Level A).
 * Rendered once high in the router tree. Maps the current pathname to an i18n
 * page-title key; dynamic circle routes are matched by their trailing segment.
 *
 * `/invite/:code` is deliberately excluded — InviteLandingPage owns its own
 * <title> via Helmet, so we render nothing there to avoid double-setting.
 */
const STATIC_TITLES: Record<string, string> = {
  '/login': 'pageTitles.login',
  '/signup': 'pageTitles.signup',
  '/verify-email': 'pageTitles.verifyEmail',
  '/forgot-password': 'pageTitles.forgotPassword',
  '/reset-password': 'pageTitles.resetPassword',
  '/circles': 'pageTitles.circlePicker',
  '/invites': 'pageTitles.invites',
  '/profile': 'pageTitles.profile',
  '/upgrade': 'pageTitles.upgrade',
  '/help': 'pageTitles.help',
};

const CIRCLE_SUBTITLES: Record<string, string> = {
  calendar: 'pageTitles.calendar',
  tasks: 'pageTitles.tasks',
  activity: 'pageTitles.activity',
  emergency: 'pageTitles.emergency',
  documents: 'pageTitles.documents',
  vitals: 'pageTitles.vitals',
  members: 'pageTitles.members',
  settings: 'pageTitles.settings',
};

function titleKeyForPath(pathname: string): string | null {
  if (STATIC_TITLES[pathname]) {
    return STATIC_TITLES[pathname];
  }
  // /circles/:circleId  → overview;  /circles/:circleId/<sub> → sub page
  const circleMatch = pathname.match(/^\/circles\/[^/]+(?:\/([^/]+))?\/?$/);
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

export function RouteTitle(): ReactElement | null {
  const { pathname } = useLocation();
  const { t } = useTranslation('common');

  // InviteLandingPage sets its own title — never override it.
  if (pathname.startsWith('/invite/')) {
    return null;
  }

  const key = titleKeyForPath(pathname);
  const title = key ? `${t(key)} · CircleCare` : 'CircleCare';

  return (
    <Helmet>
      <title>{title}</title>
    </Helmet>
  );
}
