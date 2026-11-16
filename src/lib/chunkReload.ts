import { Analytics } from '@/lib/analytics';

/**
 * Stale-chunk recovery (web only — mobile ships one bundle, no lazy chunks).
 *
 * A tab opened BEFORE a deploy still holds the old index.html, whose lazy route
 * chunks (`assets/TasksPage-<oldhash>.js`) the deploy's `rsync --delete`
 * removed. Navigating to such a route rejects the dynamic import, and React
 * caches that rejection forever, so only a full reload (fresh index.html, fresh
 * chunk manifest) recovers. Before this, the ErrorBoundary showed "Something went
 * wrong" and the user had to tap "Try again" to get that reload.
 *
 * `tryChunkReload` does the reload automatically, ONCE: a sessionStorage
 * timestamp marks that we already reloaded, and a second chunk error inside
 * `RELOAD_GUARD_WINDOW_MS` (the reload did not help — e.g. the chunk is
 * genuinely missing, or the network is down) falls through to the normal
 * ErrorBoundary UI instead of looping. When sessionStorage is unavailable
 * (private mode, blocked site data) the guard cannot be recorded, so we never
 * auto-reload: an unguarded reload is exactly what could loop.
 */

/**
 * Browser phrasings of a failed dynamic import:
 *  - Chromium: "Failed to fetch dynamically imported module: <url>"
 *  - Firefox:  "error loading dynamically imported module: <url>"
 *  - Safari:   "Importing a module script failed."
 *  - webpack-style tooling: name/message `ChunkLoadError`
 */
const CHUNK_LOAD_ERROR_PATTERN =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|ChunkLoadError/i;

export function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  return CHUNK_LOAD_ERROR_PATTERN.test(`${String(name ?? '')} ${String(message ?? '')}`);
}

export const CHUNK_RELOAD_STORAGE_KEY = 'cc_chunk_reload_at';

/**
 * A reload that did not fix things fails again within seconds; 5 minutes is
 * comfortably above that, and short enough that a tab left open across a LATER
 * deploy in the same session can still self-heal once more.
 */
export const RELOAD_GUARD_WINDOW_MS = 5 * 60 * 1000;

export type ChunkReloadSource = 'preload_error' | 'error_boundary';
export type ChunkReloadOutcome = 'reloaded' | 'suppressed_loop' | 'suppressed_no_storage';

/**
 * The decision already taken in this page lifetime (null = none yet). The same
 * stale chunk is usually reported twice (Vite's `vite:preloadError`, then the
 * ErrorBoundary catching the rejected lazy import): the second report reuses
 * the first decision, so it neither reloads twice nor double-counts the event.
 */
let decided: boolean | null = null;

/** Test-only: reset the per-page-lifetime decision. */
export function resetChunkReloadStateForTests(): void {
  decided = null;
}

/**
 * Reload the page once to pick up the current deploy's chunks.
 * Returns true when a reload was started (now or earlier in this page lifetime),
 * false when the caller should show its normal error UI.
 */
export function tryChunkReload(source: ChunkReloadSource): boolean {
  if (decided !== null) return decided;

  let outcome: ChunkReloadOutcome;
  try {
    const raw = window.sessionStorage.getItem(CHUNK_RELOAD_STORAGE_KEY);
    const last = raw ? Number(raw) : NaN;
    const now = Date.now();
    if (Number.isFinite(last) && now - last >= 0 && now - last < RELOAD_GUARD_WINDOW_MS) {
      outcome = 'suppressed_loop';
    } else {
      window.sessionStorage.setItem(CHUNK_RELOAD_STORAGE_KEY, String(now));
      outcome = 'reloaded';
    }
  } catch {
    outcome = 'suppressed_no_storage';
  }

  Analytics.chunkReload({ source, outcome });

  decided = outcome === 'reloaded';
  if (decided) window.location.reload();
  return decided;
}

/** App-entry hook: Vite dispatches `vite:preloadError` when a chunk import fails. */
export function installChunkReloadListener(): void {
  window.addEventListener('vite:preloadError', () => {
    // No preventDefault: if we do not reload, the rejection must still reach the
    // route ErrorBoundary so the user sees the fallback (and its manual retry).
    tryChunkReload('preload_error');
  });
}
