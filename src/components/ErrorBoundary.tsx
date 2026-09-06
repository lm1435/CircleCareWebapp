import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { captureException } from '@/lib/posthog';
import { Button, Text } from '@/components/ui';

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
  error?: Error;
}

// A `React.lazy()` import that 404s (a stale client hitting a deploy that
// removed the old chunk hash) leaves that lazy component's promise REJECTED
// forever — React caches it, so re-rendering the same lazy element throws the
// exact same error again immediately. Resetting `hasError` (the ordinary
// retry path) therefore does nothing for this case; only a full reload, which
// re-fetches the current index.html and its up-to-date chunk manifest, can
// recover. Matches the message Vite/Rollup-built apps throw (Chromium/Firefox
// phrasing) plus webpack's older `ChunkLoadError` name for parity with any
// non-Vite tooling in the pipeline (e.g. a Playwright-bundled helper).
const CHUNK_LOAD_ERROR_PATTERN =
  /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError/;

function isChunkLoadError(error: Error | undefined): boolean {
  if (!error) return false;
  return CHUNK_LOAD_ERROR_PATTERN.test(`${error.name} ${error.message}`);
}

/**
 * `useSuspense: false` is load-bearing, same reasoning as `Spinner`'s: the
 * ROOT `ErrorBoundary` (App.tsx) sits OUTSIDE the app's `<Suspense>`
 * boundary, so if this fallback suspended on the default `useSuspense: true`
 * (waiting on the `es` locale chunk, or any not-yet-loaded namespace) there
 * would be no ancestor Suspense left to catch it — a render error on an
 * es-detected session whose locale chunk hasn't landed would replace the
 * error screen with a blank page instead of showing it.
 */
function ErrorFallback({ onRetry }: { onRetry: () => void }): ReactNode {
  const { t } = useTranslation('common', { useSuspense: false });
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
      <Text variant="h1">{t('errorBoundary.title')}</Text>
      <p className="m-0 max-w-md text-ink-3">{t('errorBoundary.message')}</p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
        <Button variant="primary" onClick={onRetry}>
          {t('errorBoundary.retry')}
        </Button>
        <Button as="a" href="/circles" variant="ghost">
          {t('errorBoundary.home')}
        </Button>
      </div>
    </div>
  );
}

/** Mobile's exact truncation (components/ui/ErrorBoundary.tsx): 4 lines / 300 chars. */
export function truncateComponentStack(stack: string | null | undefined): string {
  try {
    return (stack ?? '').split('\n').slice(0, 4).join(' ').slice(0, 300);
  } catch {
    return '';
  }
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Forward to PostHog ($exception) so it feeds the admin error digest; a
    // boundary "handles" the error, so capture_exceptions wouldn't see it.
    //
    // Crash-record parity with mobile's ErrorBoundary: `fatal: true` (the
    // subtree was replaced by the fallback) and the React component stack,
    // truncated the same way mobile does it — first 4 lines, joined, capped at
    // 300 chars — because a deep tree produces hundreds of lines and the top
    // frames are the ones that identify the crash. A component stack is
    // component NAMES only (plus bundle URLs in dev): no props, no rendered
    // text, no user data.
    captureException(error, this.props.boundary, {
      fatal: true,
      component_stack: truncateComponentStack(errorInfo?.componentStack),
    });
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.error(`ErrorBoundary [${this.props.boundary}] caught:`, error, errorInfo);
    }
  }

  handleRetry = (): void => {
    if (isChunkLoadError(this.state.error)) {
      // Reset state buys nothing here (see the comment above
      // CHUNK_LOAD_ERROR_PATTERN) — reload the document instead.
      window.location.reload();
      return;
    }
    this.setState({ hasError: false, error: undefined });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return <ErrorFallback onRetry={this.handleRetry} />;
    }
    return this.props.children;
  }
}
