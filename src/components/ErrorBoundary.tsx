import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { captureException } from '@/lib/posthog';

// Web ErrorBoundary (parity with mobile's components/ui/ErrorBoundary). Without
// one, any render error unmounts the whole React tree → blank white screen.
//
// Two intended placements:
//  - ROOT (App.tsx, OUTSIDE the Router): last-resort catch so a catastrophic
//    error still shows a friendly screen instead of nothing.
//  - ROUTE (inside AppLayout / StandalonePageLayout, around <Outlet/>): a single
//    page's error keeps the header/sidebar alive so the user can navigate away.
//    Keyed by pathname at the usage site so navigation auto-clears the error.
//
// The "go to my circles" action is a plain <a> (full navigation), NOT a router
// <Link>, so this one component works both outside and inside the Router, and a
// full reload clears any bad in-memory state after a crash.

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Non-PHI label identifying where this boundary sits, sent with telemetry. */
  boundary: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

function ErrorFallback({ onRetry }: { onRetry: () => void }): ReactNode {
  const { t } = useTranslation('common');
  return (
    <div
      role="alert"
      className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 py-12 text-center"
    >
      <span
        aria-hidden="true"
        className="flex h-16 w-16 items-center justify-center rounded-full bg-terracotta-soft text-2xl font-bold text-terracotta-deep"
      >
        !
      </span>
      <h1 className="serif m-0 text-xl text-ink">{t('errorBoundary.title')}</h1>
      <p className="m-0 max-w-md text-ink-3">{t('errorBoundary.message')}</p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
        <button type="button" className="btn btn-primary" onClick={onRetry}>
          {t('errorBoundary.retry')}
        </button>
        <a href="/circles" className="btn btn-ghost">
          {t('errorBoundary.home')}
        </a>
      </div>
    </div>
  );
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Forward to PostHog ($exception) so it feeds the admin error digest; a
    // boundary "handles" the error, so capture_exceptions wouldn't see it.
    captureException(error, this.props.boundary);
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.error(`ErrorBoundary [${this.props.boundary}] caught:`, error, errorInfo);
    }
  }

  handleRetry = (): void => {
    this.setState({ hasError: false });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return <ErrorFallback onRetry={this.handleRetry} />;
    }
    return this.props.children;
  }
}
