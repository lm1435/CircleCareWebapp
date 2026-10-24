import type { ReactElement } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { CircleButton, Spinner } from '@/components/ui';
import { useAuth } from '@/hooks/useAuth';
import { StandalonePageLayout } from './StandalonePageLayout';
import { Wordmark } from './Wordmark';

/**
 * Layout for /help and /help/:slug, which are reachable both signed in (the
 * standalone layout with the account menu) and signed out (Login / Sign up
 * link here). Signed out gets a minimal header: Back and the brand lockup
 * linking to /login, plus the single `<main id="main">` landmark.
 */
export function HelpRouteLayout(): ReactElement {
  const { isAuthenticated, isBootstrapping } = useAuth();
  const { t } = useTranslation('common');
  const location = useLocation();
  const navigate = useNavigate();

  if (isBootstrapping) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg">
        <Spinner size={32} />
      </main>
    );
  }
  if (isAuthenticated) return <StandalonePageLayout />;

  return (
    <div className="min-h-screen bg-bg">
      <a
        href="#main"
        onClick={() => document.getElementById('main')?.focus()}
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-cream focus:px-5 focus:py-3 focus:text-sm focus:text-ink focus:shadow-lg"
      >
        {t('skipToContent')}
      </a>
      <header className="flex h-[60px] items-center gap-1 border-b border-line bg-cream px-4 sm:gap-2 sm:px-6">
        <CircleButton
          name="arrow-back"
          label={t('nav.back')}
          shadow={false}
          onClick={() => {
            if (window.history.length <= 1) navigate('/login');
            else navigate(-1);
          }}
        />
        <Wordmark to="/login" />
      </header>
      <main id="main" tabIndex={-1} className="min-w-0">
        <ErrorBoundary boundary="standalone-page" key={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  );
}
