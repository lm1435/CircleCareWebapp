import { apiClient } from '@/lib/api';
import { tokenAccessor } from '@/lib/tokenAccessor';
import { hasTraversalSegment } from '@/lib/routeIds';

/**
 * PK11 (approved 2026-09-30): a POST that survives the page going away.
 *
 * The undo windows (dose answers, task completions) flush their still-pending
 * requests on `pagehide` / the document going hidden. Through axios that is an
 * ordinary XHR, which the browser cancels the moment the page unloads — the
 * caregiver saw "Taken" and the dose was never recorded. `fetch(..., {
 * keepalive: true })` is the request the browser finishes after unload.
 *
 * Used ONLY by those two flushes. Everything else, and the unmount flush,
 * keeps axios (its 401 refresh/retry, timeouts and error shapes).
 *
 * Auth is the in-memory bearer token (never persisted, never a cookie). A
 * keepalive request cannot refresh a 401 and retry, so when there is no token,
 * or it is about to expire, this returns `null` and the caller takes its
 * normal axios path (which can refresh). The body must stay under the 64 KB
 * keepalive budget — also `null` past it. Never throws.
 *
 * @param path  API path relative to the `/api` base, e.g. `/circles/c1/events/e1/complete`.
 */
const MAX_BODY_BYTES = 60 * 1024;
const EXPIRY_MARGIN_MS = 10_000;

export function keepalivePost(path: string, body?: unknown): Promise<Response> | null {
  try {
    if (typeof fetch !== 'function') return null;
    // Same guard as the axios interceptor: no Bearer to a dot-segment path.
    if (hasTraversalSegment(path)) return null;
    const token = tokenAccessor.getAuthToken();
    if (!token) return null;
    const expiresAt = tokenAccessor.getExpiresAt();
    if (expiresAt !== null && expiresAt * 1000 - Date.now() < EXPIRY_MARGIN_MS) return null;
    const payload = body === undefined ? undefined : JSON.stringify(body);
    if (payload !== undefined && payload.length > MAX_BODY_BYTES) return null;
    const base = apiClient.defaults?.baseURL ?? '/api';
    return fetch(`${base}${path}`, {
      method: 'POST',
      keepalive: true,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      ...(payload !== undefined ? { body: payload } : {}),
    });
  } catch {
    return null;
  }
}
