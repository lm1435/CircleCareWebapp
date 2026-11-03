import type { AxiosRequestConfig } from 'axios';
import { Analytics } from './analytics';
import { classifyFailureCode } from './apiErrors';
import { isOfflineNow } from '@/hooks/useIsOffline';

/**
 * PORT of mobile/src/api/idempotentWrite.ts — keep the two in step.
 *
 * A create/edit whose RESPONSE was lost (network drop, 15 s timeout, a laptop
 * lid closed mid-save) is retried with the SAME Idempotency-Key, so the retry
 * can never write twice and the caregiver is not told a saved medication
 * "failed". The backend replays the first answer when it landed
 * (backend/src/middleware/idempotency.ts).
 *
 * Web has no JS suspension, but a hidden tab and an offline browser are the
 * same shape: a retry waits until the tab is visible and the browser is online.
 *
 * OLD BACKENDS: never auto-retry a create against a backend that does not
 * dedupe it. The backend sends `Idempotency-Supported: 1` on every /api answer
 * (exposed to script via CORS); until it has been seen, a save goes out exactly
 * as before.
 */

const MAX_RETRIES = 3;
const IS_TEST = typeof process !== 'undefined' && !!process.env?.VITEST;
const RETRY_DELAYS_MS = IS_TEST ? [0, 0, 0] : [1000, 2000, 4000];

const RETRYABLE_SERVER_CODES: ReadonlySet<string> = new Set([
  'SERVER_ERROR',
  'INTERNAL_ERROR',
  'UPSTREAM_TIMEOUT',
  'IDEMPOTENCY_IN_PROGRESS',
]);

export type IdempotentOperation = 'event_create' | 'event_update';

let supported = false;
const replayedBodies = new WeakSet<object>();

/** lib/api.ts: record that this backend dedupes by Idempotency-Key. */
export function noteIdempotencyHeaders(headers: unknown, body?: unknown): void {
  try {
    const h = headers as { get?: (k: string) => unknown; [k: string]: unknown } | null | undefined;
    if (!h) return;
    const read = (k: string) => (typeof h.get === 'function' ? h.get(k) : h[k]);
    if (String(read('idempotency-supported') ?? '') === '1') supported = true;
    if (String(read('idempotent-replayed') ?? '') === 'true' && body && typeof body === 'object') {
      replayedBodies.add(body as object);
    }
  } catch {
    // Never let header bookkeeping break a response.
  }
}

export function isIdempotencySupported(): boolean {
  return supported;
}

/** Test hook. */
export function __setIdempotencySupportedForTests(value: boolean): void {
  supported = value;
}

/** Same rule as mobile: only an answer that does not prove nothing was written. */
export function isRetryableWriteFailure(err: unknown): boolean {
  try {
    const e = err as {
      error?: { code?: unknown };
      code?: unknown;
      isAxiosError?: unknown;
      response?: unknown;
    } | null;
    if (!e || typeof e !== 'object') return false;
    const serverCode = e.error?.code;
    if (typeof serverCode === 'string' && serverCode) return RETRYABLE_SERVER_CODES.has(serverCode);
    if (typeof e.code === 'number') return e.code >= 500 && e.code <= 599;
    if (e.isAxiosError === true && !e.response) return true;
    return e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT' || e.code === 'ERR_NETWORK';
  } catch {
    return false;
  }
}

function isAway(): boolean {
  const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
  return hidden || isOfflineNow();
}

/** Resolve once the tab is visible and the browser is online. */
function waitUntilPresent(): Promise<void> {
  if (!isAway()) return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => {
      if (isAway()) return;
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('online', check);
      resolve();
    };
    document.addEventListener('visibilitychange', check);
    window.addEventListener('online', check);
  });
}

function newIdempotencyKey(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Send a create/edit with one Idempotency-Key per call, retrying an ambiguous
 * failure with the same key. Against an old backend `send(undefined)` is the
 * unchanged request.
 */
export async function sendIdempotentWrite<T>(
  operation: IdempotentOperation,
  send: (config: AxiosRequestConfig | undefined) => Promise<T>
): Promise<T> {
  if (!supported) return send(undefined);

  const keyed: AxiosRequestConfig = { headers: { 'Idempotency-Key': newIdempotencyKey() } };
  let retries = 0;
  let cause = '';
  let backgrounded = false;
  for (;;) {
    try {
      const result = await send(keyed);
      if (retries > 0) {
        Analytics.apiWriteRetried({
          operation,
          cause,
          attempts: retries + 1,
          outcome: 'recovered',
          replayed: !!result && typeof result === 'object' && replayedBodies.has(result as object),
          backgrounded,
        });
      }
      return result;
    } catch (err) {
      if (!isRetryableWriteFailure(err) || retries >= MAX_RETRIES) {
        if (retries > 0) {
          Analytics.apiWriteRetried({
            operation,
            cause,
            attempts: retries + 1,
            outcome: 'failed',
            replayed: false,
            backgrounded,
          });
        }
        throw err;
      }
      if (retries === 0) cause = classifyFailureCode(err);
      if (isAway()) backgrounded = true;
      await waitUntilPresent();
      const delay = RETRY_DELAYS_MS[retries] ?? 0;
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      retries += 1;
    }
  }
}
