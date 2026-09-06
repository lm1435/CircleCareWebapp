import { sanitizeErrorText } from './analytics';

/**
 * THE BOOT BLIND SPOT.
 *
 * posthog-js installs its `window.onerror` / `unhandledrejection` handlers
 * inside `init()` — and main.tsx deliberately defers `initAnalytics()` to
 * after first paint (`requestIdleCallback`, 2s timeout) so the ~64 KB SDK
 * chunk never competes with the initial render. Anything thrown in that
 * window — a failed lazy route import, a Zod env mismatch, a render-time
 * TypeError outside every ErrorBoundary, a rejected auth bootstrap — was
 * simply lost: the app went blank and the admin digest never heard about it.
 * Mobile has no equivalent gap (its SDK initialises synchronously), so this
 * is exactly the class of crash that made web look healthier than it was.
 *
 * `installBootErrorBuffer()` is called SYNCHRONOUSLY from main.tsx before
 * `scheduleAnalyticsInit()` and before `createRoot().render()`. It adds two
 * listeners and nothing else — zero work on the render path. Errors are held
 * as at most `MAX_BOOT_ERRORS` sanitized `Error` clones until `initAnalytics`
 * either:
 *   - finishes configuring the SDK → `flushBootErrors(captureException)`
 *     replays each entry as a `$exception` tagged `boundary: 'boot'` so the
 *     digest can tell a pre-init crash from an ErrorBoundary catch, or
 *   - decides collection is NOT allowed (declined consent, no key, SDK load
 *     failure) → `discardBootErrors()` drops everything unsent. A declining
 *     visitor's errors are never transmitted, not even the ones that happened
 *     before we could ask.
 * Either way both listeners are removed afterwards, so from then on posthog's
 * own handlers are the only ones (no double capture of a post-init error).
 *
 * If `initAnalytics` is never called at all (VITE_POSTHOG_KEY unset AND the
 * idle callback never fires — e.g. the tab is torn down first), the listeners
 * simply stay installed: they cap at ten entries and hold only sanitized
 * strings, so the cost is bounded and there is nothing sensitive to leak.
 *
 * PHI posture: only `name` / sanitized `message` / `stack` are kept. The raw
 * `ErrorEvent` is never retained (it references the window and, for a
 * cross-origin script, carries nothing useful anyway), and a non-Error
 * rejection reason (a string, an object, a DOM node) is collapsed to a short
 * sanitized string before it is wrapped — never stored as-is.
 *
 * Every entry point is wrapped in try/catch: a crash reporter that can itself
 * crash the boot it is reporting on is worse than none.
 */

export const MAX_BOOT_ERRORS = 10;

type BootErrorSink = (error: Error, boundary: string) => void;

/** The `boundary` tag every replayed entry carries — grep target for the digest. */
export const BOOT_BOUNDARY = 'boot';

const buffer: Error[] = [];
let onWindowError: ((event: Event) => void) | null = null;
let onUnhandledRejection: ((event: Event) => void) | null = null;

/**
 * Build the Error CLONE we actually retain. Mirrors `withSanitizedMessage` in
 * lib/posthog.ts (message scrubbed, name kept, the stack header rewritten to
 * the scrubbed message) but is applied at STORE time rather than flush time,
 * so a buffer that is never flushed still only ever holds sanitized text.
 * Stack FRAMES are kept verbatim — they are bundle URLs, not user data, and
 * they are what makes a boot crash triageable.
 */
function toStoredError(reason: unknown, fallbackMessage: string): Error {
  if (reason instanceof Error) {
    const rawMessage = typeof reason.message === 'string' ? reason.message : '';
    const safe = sanitizeErrorText(rawMessage) || 'Error';
    const clone = new Error(safe);
    clone.name = typeof reason.name === 'string' ? reason.name : 'Error';
    if (typeof reason.stack === 'string') {
      clone.stack = rawMessage.length > 0 ? reason.stack.replace(rawMessage, safe) : reason.stack;
    }
    return clone;
  }
  // Non-Error reason: a thrown string/object, or `event.message` when the
  // browser gave us no `error` (cross-origin "Script error."). `String()` on
  // a DOM node or a plain object yields "[object X]" — short and content-free
  // — and `sanitizeErrorText` bounds anything else.
  let text = '';
  try {
    text = typeof reason === 'string' ? reason : reason == null ? '' : String(reason);
  } catch {
    text = '';
  }
  const clone = new Error(sanitizeErrorText(text) || sanitizeErrorText(fallbackMessage) || 'Error');
  clone.name = 'UnhandledRejection';
  return clone;
}

function push(reason: unknown, fallbackMessage: string): void {
  try {
    // Keep the FIRST ten: the earliest boot errors are the causal ones, and
    // everything after a blank screen tends to be a cascade of the same fault.
    if (buffer.length >= MAX_BOOT_ERRORS) return;
    buffer.push(toStoredError(reason, fallbackMessage));
  } catch {
    /* never let the buffer be the thing that throws during boot */
  }
}

function removeListeners(): void {
  try {
    if (typeof window === 'undefined') return;
    if (onWindowError) window.removeEventListener('error', onWindowError);
    if (onUnhandledRejection) {
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    }
  } catch {
    /* best-effort */
  } finally {
    onWindowError = null;
    onUnhandledRejection = null;
  }
}

/**
 * Install the two window listeners. Idempotent; a no-op outside a browser
 * (SSR/tests without a window) or when `addEventListener` itself throws.
 */
export function installBootErrorBuffer(): void {
  try {
    if (typeof window === 'undefined' || onWindowError || onUnhandledRejection) return;
    const errorListener = (event: Event): void => {
      const e = event as ErrorEvent;
      push(e.error, typeof e.message === 'string' ? e.message : '');
    };
    const rejectionListener = (event: Event): void => {
      push((event as PromiseRejectionEvent).reason, 'Unhandled promise rejection');
    };
    window.addEventListener('error', errorListener);
    window.addEventListener('unhandledrejection', rejectionListener);
    onWindowError = errorListener;
    onUnhandledRejection = rejectionListener;
  } catch {
    // Leave whatever partially succeeded unregistered-by-record: with both
    // handles null, a later flush/discard has nothing to remove and simply
    // clears the buffer.
    onWindowError = null;
    onUnhandledRejection = null;
  }
}

/**
 * Replay every buffered error through `sink` (in practice
 * `captureException`), tagged `boundary: 'boot'`, then stop listening and
 * clear the buffer. Called by `initAnalytics` AFTER `markPosthogReady`, so
 * each entry goes straight to a configured SDK rather than back into the
 * loader queue.
 */
export function flushBootErrors(sink: BootErrorSink): void {
  try {
    const pending = buffer.splice(0, buffer.length);
    for (const error of pending) {
      try {
        sink(error, BOOT_BOUNDARY);
      } catch {
        /* one bad entry must not stop the rest */
      }
    }
  } catch {
    /* best-effort */
  } finally {
    removeListeners();
  }
}

/**
 * Drop everything unsent and stop listening. Called on every `initAnalytics`
 * path that will never send: collection not allowed, no key, SDK failed to
 * load. Nothing captured before the visitor's decision is transmitted after it.
 */
export function discardBootErrors(): void {
  try {
    buffer.length = 0;
  } finally {
    removeListeners();
  }
}

/** Test seam: how many entries are currently held. */
export function __bootErrorCountForTests(): number {
  return buffer.length;
}

/** Test seam: back to the never-installed state without flushing anything. */
export function __resetBootErrorBufferForTests(): void {
  discardBootErrors();
}
