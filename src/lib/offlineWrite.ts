import i18n from 'i18next';
import { isOfflineNow } from '@/hooks/useIsOffline';

/**
 * NO WRITES WHILE OFFLINE (owner decision 2026-10-14). Web twin of
 * mobile/src/utils/offlineWrite.ts — same three sentences, same rules.
 *
 * Marking a dose, giving an as-needed dose, completing a task, saving a form,
 * posting a note, inviting, uploading, asking the assistant: refused while the
 * browser is offline — never queued, never shown as done. A queued write
 * replayed on reconnect could land on top of a different answer another
 * caregiver gave meanwhile. The controls stay visible and focusable
 * (`aria-disabled`, dimmed); a press explains, once, calmly (an info toast).
 *
 * Nothing on web is persisted across a reload (no persisted query cache — out
 * of scope); offline, a page shows only what it had already loaded.
 */

/**
 * Which sentence explains the refusal:
 *  - 'mark'   a dose / task answer   "You're offline. Connect to mark this."
 *  - 'save'   a form's Save, a post   "You're offline. Connect to save this."
 *  - 'change' any other create / edit / delete entry point (the New menu, an
 *             Edit button, invite, upload, the assistant)
 *                                    "You're offline. Connect to make changes."
 */
export type OfflineWriteKind = 'mark' | 'save' | 'change';

const MESSAGE_KEY: Record<OfflineWriteKind, string> = {
  mark: 'common:offline.writeBlocked',
  save: 'common:offline.saveBlocked',
  change: 'common:offline.changeBlocked',
};

export function offlineWriteMessage(kind: OfflineWriteKind): string {
  return i18n.t(MESSAGE_KEY[kind]);
}

type Explainer = (message: string) => void;
let explainer: Explainer | null = null;

/**
 * The ToastProvider registers how an explanation is shown (an info toast). Kept
 * as a module-level hook so any control — inside a portal, a dialog or a plain
 * function — can explain without threading the toast context through.
 */
export function setOfflineWriteExplainer(next: Explainer | null): void {
  explainer = next;
}

/**
 * EXPLAIN ONCE: a second press while the same explanation is still on screen
 * does nothing (no re-announcement, no flicker). A different sentence replaces
 * it. The hold matches the toast's own minimum on-screen time.
 */
const EXPLAIN_HOLD_MS = 5000;
let explaining: { kind: OfflineWriteKind; until: number } | null = null;

export function explainOfflineWrite(kind: OfflineWriteKind = 'mark'): void {
  const now = Date.now();
  if (explaining && explaining.kind === kind && now < explaining.until) return;
  explaining = { kind, until: now + EXPLAIN_HOLD_MS };
  explainer?.(offlineWriteMessage(kind));
}

/**
 * The one-line gate for a write handler: `if (blockOfflineWrite('save')) return;`
 * Offline -> explains (once) and answers true; online -> false, nothing shown.
 * Read AT PRESS TIME, so a form opened online whose connection dropped since
 * still refuses — and, because the handler returns before touching any state,
 * the user's input stays exactly as typed.
 */
export function blockOfflineWrite(kind: OfflineWriteKind = 'save'): boolean {
  if (!isOfflineNow()) return false;
  explainOfflineWrite(kind);
  return true;
}

/**
 * Wrap a write handler: offline -> explain and do nothing; online -> run it.
 * Checks connectivity AT PRESS TIME (not render time).
 */
export function guardOfflineWrite<A extends unknown[]>(
  fn: ((...args: A) => void) | undefined,
  kind: OfflineWriteKind = 'mark'
): (...args: A) => void {
  return (...args: A) => {
    if (blockOfflineWrite(kind)) return;
    fn?.(...args);
  };
}

/**
 * Props for a write control that is not a `Button` (which takes `offlineKind`):
 * offline -> `aria-disabled`, dimmed by the global `[data-offline-disabled]`
 * rule (styles/globals.css), still focusable so a press can explain. Pair with
 * `blockOfflineWrite` / `guardOfflineWrite` in the handler.
 */
export function offlineDisabledProps(
  offline: boolean
): { 'aria-disabled'?: true; 'data-offline-disabled'?: true } {
  return offline ? { 'aria-disabled': true, 'data-offline-disabled': true } : {};
}

/**
 * THE BACKSTOP (src/lib/api.ts request interceptor): a non-GET request made
 * while offline is never sent and never queued — it rejects at once with this
 * body, shaped like the backend's `{ success: false, error: { code } }` so
 * every existing failure path reads it. The entry points above are what the
 * user sees; this only guarantees nothing slips through one we missed.
 */
export const OFFLINE_WRITE_CODE = 'OFFLINE';

export function offlineWriteRejection(): {
  success: false;
  error: { code: string; message: string };
} {
  return {
    success: false as const,
    error: { code: OFFLINE_WRITE_CODE, message: 'Offline: write not sent' },
  };
}

export function isOfflineWriteRejection(err: unknown): boolean {
  return (err as { error?: { code?: unknown } } | null)?.error?.code === OFFLINE_WRITE_CODE;
}

/** Test helper. */
export function __resetOfflineWriteForTests(): void {
  explaining = null;
}
