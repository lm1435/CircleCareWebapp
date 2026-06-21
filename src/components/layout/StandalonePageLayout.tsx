import type { ReactElement } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { UserMenu } from './Header';

function BackIcon(): ReactElement {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

/**
 * Layout for the authenticated routes that render WITHOUT AppLayout (the circle
 * picker, pending invites, profile, help). Provides:
 *  - a persistent <header> bar (sibling of <main>) so a user who lands on /help
 *    or /profile is never stranded: a Back affordance and the CircleCare brand
 *    linking home to /circles, plus the shared account menu for full parity with
 *    AppLayout's Header.
 *  - the single `<main id="main">` landmark these pages were missing (fixes axe
 *    landmark-one-main / region) and which the skip-link still targets.
 *
 * Back goes to history (-1) and falls back to /circles when there's no history
 * to return to (e.g. the page was opened directly via a deep link).
 */
export function StandalonePageLayout(): ReactElement {
  const { t } = useTranslation('common');
  const location = useLocation();
  const navigate = useNavigate();

  const handleBack = (): void => {
    // No prior in-app history (direct deep link / fresh tab) → send home so the
    // back button is never a no-op that strands the user.
    if (window.history.length <= 1) {
      navigate('/circles');
    } else {
      navigate(-1);
    }
  };

  return (
    <div className="min-h-screen bg-bg">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-cream focus:px-5 focus:py-3 focus:text-sm focus:text-ink focus:shadow-lg"
      >
        {t('skipToContent')}
      </a>

      <header className="flex items-center justify-between gap-3 border-b border-line bg-cream px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-1 sm:gap-2">
          <button
            type="button"
            onClick={handleBack}
            aria-label={t('nav.back')}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink transition-colors hover:bg-bg-2"
          >
            <BackIcon />
          </button>
          <Link
            to="/circles"
            aria-label={t('appName')}
            className="flex min-h-11 min-w-0 items-center gap-2 px-1 no-underline"
          >
            <img src="/icon.png" alt="" className="h-7 w-7 shrink-0 rounded-lg" />
            <span className="serif hidden truncate text-lg text-ink sm:inline">
              {t('appName')}
            </span>
          </Link>
        </div>

        <UserMenu />
      </header>

      <main id="main" className="min-w-0">
        {/* Page-level boundary so one page's error doesn't blank the app; keyed by
            path so navigation auto-clears a caught error. */}
        <ErrorBoundary boundary="standalone-page" key={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  );
}
