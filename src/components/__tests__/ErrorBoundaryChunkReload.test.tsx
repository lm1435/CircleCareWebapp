import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@/i18n';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import * as posthog from '@/lib/posthog';
import { Analytics } from '@/lib/analytics';
import {
  CHUNK_RELOAD_STORAGE_KEY,
  RELOAD_GUARD_WINDOW_MS,
  installChunkReloadListener,
  isChunkLoadError,
  resetChunkReloadStateForTests,
  tryChunkReload,
} from '@/lib/chunkReload';

// Stale lazy chunk after a deploy (PostHog issue 01a1b184: TasksPage-/CalendarPage-
// chunk 404s on Android Chrome). The boundary must reload ONCE on its own, never
// loop, and never reload for an ordinary render error.

function ThrowOnce({ error }: { error: Error }): JSX.Element {
  throw error;
}

const CHROME_MSG =
  "Failed to fetch dynamically imported module: https://my.circlecare.app/assets/TasksPage-yJrkxV-u.js";

describe('stale chunk auto-reload', () => {
  const originalLocation = window.location;
  const reload = vi.fn();
  let chunkReloadSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { ...originalLocation, reload },
    });
    reload.mockClear();
    window.sessionStorage.removeItem(CHUNK_RELOAD_STORAGE_KEY);
    resetChunkReloadStateForTests();
    vi.spyOn(posthog, 'captureException').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    chunkReloadSpy = vi.spyOn(Analytics, 'chunkReload');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.sessionStorage.removeItem(CHUNK_RELOAD_STORAGE_KEY);
    resetChunkReloadStateForTests();
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
  });

  it('P1: a chunk-load error reloads the page once, with no tap on Retry', () => {
    render(
      <ErrorBoundary boundary="route">
        <ThrowOnce error={new TypeError(CHROME_MSG)} />
      </ErrorBoundary>
    );
    expect(reload).toHaveBeenCalledTimes(1);
    expect(Number(window.sessionStorage.getItem(CHUNK_RELOAD_STORAGE_KEY))).toBeGreaterThan(0);
  });

  it.each([
    ['Chrome', CHROME_MSG],
    ['Firefox', 'error loading dynamically imported module: https://x/assets/CalendarPage-abc.js'],
    ['Safari', 'Importing a module script failed.'],
    ['webpack', 'ChunkLoadError: Loading chunk 7 failed.'],
  ])('P1b: recognises the %s phrasing', (_browser, message) => {
    expect(isChunkLoadError(new TypeError(message))).toBe(true);
  });

  it('P2: fires chunk_reload with enum-only props before reloading', () => {
    const order: string[] = [];
    chunkReloadSpy.mockImplementation(() => {
      order.push('analytics');
    });
    reload.mockImplementation(() => order.push('reload'));

    render(
      <ErrorBoundary boundary="route">
        <ThrowOnce error={new TypeError(CHROME_MSG)} />
      </ErrorBoundary>
    );

    expect(chunkReloadSpy).toHaveBeenCalledTimes(1);
    expect(chunkReloadSpy).toHaveBeenCalledWith({ source: 'error_boundary', outcome: 'reloaded' });
    expect(order).toEqual(['analytics', 'reload']);
    // No URL / free text leaks into the props.
    expect(JSON.stringify(chunkReloadSpy.mock.calls[0])).not.toMatch(/assets|https?:|TasksPage/);
  });

  it('P2b: the vite:preloadError listener reloads and reports source=preload_error', () => {
    installChunkReloadListener();
    window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(chunkReloadSpy).toHaveBeenCalledWith({ source: 'preload_error', outcome: 'reloaded' });
    // The boundary catching the same stale chunk afterwards neither reloads
    // again nor double-counts.
    expect(tryChunkReload('error_boundary')).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(chunkReloadSpy).toHaveBeenCalledTimes(1);
  });

  it('N1: a second chunk error in the same session (after the reload) does not reload again', () => {
    const first = render(
      <ErrorBoundary boundary="route">
        <ThrowOnce error={new TypeError(CHROME_MSG)} />
      </ErrorBoundary>
    );
    expect(reload).toHaveBeenCalledTimes(1);
    first.unmount();

    // Simulate the fresh page after the reload: module state is new, the
    // sessionStorage guard survives.
    resetChunkReloadStateForTests();
    render(
      <ErrorBoundary boundary="route">
        <ThrowOnce error={new TypeError(CHROME_MSG)} />
      </ErrorBoundary>
    );

    expect(reload).toHaveBeenCalledTimes(1);
    expect(chunkReloadSpy).toHaveBeenLastCalledWith({
      source: 'error_boundary',
      outcome: 'suppressed_loop',
    });
    // Falls through to today's fallback UI.
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('N1b: a guard older than the window allows one more reload (later deploy, same tab)', () => {
    window.sessionStorage.setItem(
      CHUNK_RELOAD_STORAGE_KEY,
      String(Date.now() - RELOAD_GUARD_WINDOW_MS - 1000)
    );
    expect(tryChunkReload('error_boundary')).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('N2: an ordinary (non-chunk) error does not reload and shows the normal boundary', () => {
    render(
      <ErrorBoundary boundary="route">
        <ThrowOnce error={new TypeError("Cannot read properties of undefined (reading 'map')")} />
      </ErrorBoundary>
    );
    expect(reload).not.toHaveBeenCalled();
    expect(chunkReloadSpy).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(CHUNK_RELOAD_STORAGE_KEY)).toBeNull();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('N3: sessionStorage throwing does not crash and does not reload (no unguarded loop)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });

    expect(() =>
      render(
        <ErrorBoundary boundary="route">
          <ThrowOnce error={new TypeError(CHROME_MSG)} />
        </ErrorBoundary>
      )
    ).not.toThrow();

    expect(reload).not.toHaveBeenCalled();
    expect(chunkReloadSpy).toHaveBeenCalledWith({
      source: 'error_boundary',
      outcome: 'suppressed_no_storage',
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
