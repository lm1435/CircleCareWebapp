import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@/i18n'; // side-effect: initialize i18next so fallback strings resolve
import type { BackendModule, ReadCallback } from 'i18next';
import { createInstance } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { ErrorBoundary, truncateComponentStack } from '@/components/ErrorBoundary';
import * as analytics from '@/lib/posthog';

// A child that throws on demand so we can drive the boundary into and out of its
// error state.
let shouldThrow = true;
function Child(): JSX.Element {
  if (shouldThrow) throw new Error('boom');
  return <div>recovered content</div>;
}

// A child that throws a specific error once, so different tests can exercise
// different `handleRetry` branches (ordinary reset vs. chunk-load reload).
function ThrowOnce({ error }: { error: Error }): JSX.Element {
  throw error;
}

// A locale chunk that never arrives: read() simply never invokes `callback`.
// Same technique as src/__tests__/appSuspenseFallback.test.tsx (Spinner) —
// duplicated here rather than shared, since this follow-up scopes to
// ErrorBoundary.tsx and its test only.
const neverResolvesBackend: BackendModule = {
  type: 'backend',
  init: () => {},
  read: (_language: string, _namespace: string, _callback: ReadCallback) => {
    // Deliberately empty — the promise/suspense this drives never settles.
  },
};

function buildStuckEsI18n() {
  const instance = createInstance();
  void instance
    .use(neverResolvesBackend)
    .use(initReactI18next)
    .init({
      lng: 'es',
      fallbackLng: false, // no fallback resources either — nothing ever resolves
      ns: ['common'],
      defaultNS: 'common',
      resources: {}, // nothing bundled — matches a real (non-test) es session
      partialBundledLanguages: true,
      react: { useSuspense: true },
    });
  return instance;
}

describe('ErrorBoundary', () => {
  it('renders the fallback, captures the error, and recovers on retry', () => {
    shouldThrow = true;
    const capture = vi.spyOn(analytics, 'captureException').mockImplementation(() => {});
    // React logs the caught error to console.error; silence it for a clean run.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary boundary="test">
        <Child />
      </ErrorBoundary>
    );

    // Fallback shown instead of a blank tree.
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to my circles' })).toHaveAttribute(
      'href',
      '/circles'
    );

    // Error forwarded to PostHog with the boundary label (PHI-safe) plus the
    // mobile-parity crash-record fields.
    expect(capture).toHaveBeenCalledWith(
      expect.any(Error),
      'test',
      expect.objectContaining({ fatal: true, component_stack: expect.any(String) })
    );

    // Retry after the underlying issue is resolved → children render again.
    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('recovered content')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    capture.mockRestore();
    consoleError.mockRestore();
  });

  /**
   * Crash-record parity with mobile's ErrorBoundary: `$exception` carries
   * `fatal: true` and a component stack truncated exactly like mobile's —
   * `split('\n').slice(0, 4).join(' ').slice(0, 300)`. Component stacks are
   * component NAMES only, so nothing here is PHI; the cap exists because a
   * deep tree produces hundreds of lines and only the top frames identify the
   * crash.
   */
  describe('crash-record fields', () => {
    function Wrap7({ children }: { children: JSX.Element }) {
      return <section>{children}</section>;
    }
    function Wrap6({ children }: { children: JSX.Element }) {
      return <Wrap7>{children}</Wrap7>;
    }
    function Wrap5({ children }: { children: JSX.Element }) {
      return <Wrap6>{children}</Wrap6>;
    }
    function Wrap4({ children }: { children: JSX.Element }) {
      return <Wrap5>{children}</Wrap5>;
    }
    function Wrap3({ children }: { children: JSX.Element }) {
      return <Wrap4>{children}</Wrap4>;
    }
    function Wrap2({ children }: { children: JSX.Element }) {
      return <Wrap3>{children}</Wrap3>;
    }
    function Wrap1({ children }: { children: JSX.Element }) {
      return <Wrap2>{children}</Wrap2>;
    }

    it('passes fatal: true and a component_stack of at most 4 lines / 300 chars', () => {
      const capture = vi.spyOn(analytics, 'captureException').mockImplementation(() => {});
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      render(
        <ErrorBoundary boundary="route">
          <Wrap1>
            <ThrowOnce error={new Error('deep boom')} />
          </Wrap1>
        </ErrorBoundary>
      );

      expect(capture).toHaveBeenCalledTimes(1);
      const [, boundary, extra] = capture.mock.calls[0] as [
        Error,
        string,
        { fatal: boolean; component_stack: string },
      ];
      expect(boundary).toBe('route');
      expect(extra.fatal).toBe(true);
      expect(typeof extra.component_stack).toBe('string');
      expect(extra.component_stack.length).toBeLessThanOrEqual(300);
      // Lines were joined with a space — nothing multi-line survives.
      expect(extra.component_stack).not.toContain('\n');
      // React lists the stack innermost-first: ['', ThrowOnce, section, Wrap7]
      // are the 4 lines kept; Wrap6 and everything outward (up to the boundary
      // itself) fall outside the window and are dropped.
      expect(extra.component_stack).toContain('ThrowOnce');
      expect(extra.component_stack).toContain('Wrap7');
      expect(extra.component_stack).not.toContain('Wrap6');
      // (`at ErrorBoundary` — the FRAME; the dev-only source path also names this file.)
      expect(extra.component_stack).not.toMatch(/at ErrorBoundary\b/);

      capture.mockRestore();
      consoleError.mockRestore();
    });

    it('truncateComponentStack mirrors mobile: 4 lines, joined, sliced to 300', () => {
      const longLine = (name: string) => `    at ${name} (${'x'.repeat(120)})`;
      const stack = ['', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6'].map((n) => (n ? longLine(n) : n));
      const out = truncateComponentStack(stack.join('\n'));
      expect(out.length).toBeLessThanOrEqual(300);
      expect(out).not.toContain('\n');
      expect(out).toContain('L1');
      expect(out).not.toContain('L4');
      expect(out).not.toContain('L5');

      const short = truncateComponentStack('\n    at A\n    at B');
      expect(short).toBe('     at A     at B');
      expect(truncateComponentStack(undefined)).toBe('');
      expect(truncateComponentStack(null)).toBe('');
    });
  });

  /**
   * Reviewer-reported issue (W6b follow-up): React 18 `lazy()` caches a
   * REJECTED import promise forever, so re-rendering the same lazy element
   * after a stale-deploy chunk 404 throws the identical error again
   * immediately — the ordinary "Try again" (`setState({ hasError: false })`)
   * is inert for this one error class. `handleRetry` must instead reload the
   * document so the browser re-fetches the current (up to date) chunk
   * manifest.
   */
  describe('chunk-load errors', () => {
    const originalReload = window.location.reload;
    const reload = vi.fn();

    beforeEach(() => {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: { ...window.location, reload },
        writable: true,
      });
      reload.mockClear();
    });

    afterEach(() => {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: { ...window.location, reload: originalReload },
        writable: true,
      });
    });

    it.each([
      ["Failed to fetch dynamically imported module: 'https://app/assets/OverviewPage-abc123.js'"],
      ['Importing a module script failed'],
      ['ChunkLoadError'],
    ])('reloads the page instead of resetting state for: %s', (message) => {
      const capture = vi.spyOn(analytics, 'captureException').mockImplementation(() => {});
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      render(
        <ErrorBoundary boundary="test">
          <ThrowOnce error={new Error(message)} />
        </ErrorBoundary>
      );

      expect(screen.getByRole('alert')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

      expect(reload).toHaveBeenCalledTimes(1);
      // The fallback is still showing — state was NOT reset (that would just
      // re-throw the same cached rejection and re-render the same fallback
      // for a different reason; reload is the only thing that recovers).
      expect(screen.getByRole('alert')).toBeInTheDocument();

      capture.mockRestore();
      consoleError.mockRestore();
    });

    it('matches a ChunkLoadError by name, not just message text', () => {
      const capture = vi.spyOn(analytics, 'captureException').mockImplementation(() => {});
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      const chunkError = new Error('unrelated message text');
      chunkError.name = 'ChunkLoadError';

      render(
        <ErrorBoundary boundary="test">
          <ThrowOnce error={chunkError} />
        </ErrorBoundary>
      );
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

      expect(reload).toHaveBeenCalledTimes(1);

      capture.mockRestore();
      consoleError.mockRestore();
    });

    it('does NOT reload for an ordinary error (only resets state, per the test above)', () => {
      shouldThrow = true;
      const capture = vi.spyOn(analytics, 'captureException').mockImplementation(() => {});
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      render(
        <ErrorBoundary boundary="test">
          <Child />
        </ErrorBoundary>
      );
      shouldThrow = false;
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

      expect(reload).not.toHaveBeenCalled();
      expect(screen.getByText('recovered content')).toBeInTheDocument();

      capture.mockRestore();
      consoleError.mockRestore();
    });
  });

  /**
   * Coordinator follow-up (W6b, same class as the Spinner fix): the ROOT
   * `ErrorBoundary` (App.tsx) sits OUTSIDE the app's `<Suspense>` boundary —
   * there is no ancestor Suspense here in production, and deliberately none
   * in this test either. If `ErrorFallback`'s `useTranslation('common')` used
   * react-i18next's default `useSuspense: true`, a render error hitting this
   * boundary on an es-detected session whose locale chunk hasn't landed would
   * itself suspend with nothing to catch it — the error screen never paints.
   *
   * Uses the never-resolving-backend technique from
   * src/__tests__/appSuspenseFallback.test.tsx: an ISOLATED i18next instance
   * (via I18nextProvider, never the app's shared `@/i18n` singleton) whose
   * backend `read()` never calls back, standing in for the `MODE=production`
   * shape of `src/i18n/index.ts` without fighting its test-mode escape hatch.
   */
  it('renders non-empty fallback markup for an es-detected instance whose namespace never resolves', () => {
    const stuckI18n = buildStuckEsI18n();
    const capture = vi.spyOn(analytics, 'captureException').mockImplementation(() => {});
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <I18nextProvider i18n={stuckI18n}>
        <ErrorBoundary boundary="test">
          <ThrowOnce error={new Error('boom')} />
        </ErrorBoundary>
      </I18nextProvider>
    );

    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert.textContent?.trim()).not.toBe('');
    expect(screen.getByRole('button', { name: /.+/ })).toBeInTheDocument();

    capture.mockRestore();
    consoleError.mockRestore();
  });
});
