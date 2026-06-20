import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { env } from './env';
import { tokenAccessor } from './tokenAccessor';
import { API_TIMEOUT } from '@/constants/config';

// PORT of mobile/src/api/client.ts adapted for the web threat model:
// - Access token: in memory only (tokenAccessor). Authorization: Bearer on every call.
// - Refresh token: httpOnly Secure SameSite=Strict cookie set by the backend.
//   Refresh = `POST /api/auth/refresh` with `withCredentials` + `X-Session-Mode: cookie`.
// - Cookie credentials are sent on AUTH endpoints ONLY — data calls stay
//   Bearer-token-only (no CSRF surface on data routes).
// - 401 → single deduplicated refresh, queued originals retried, failure → logout
//   callback (registered via setter to avoid circular deps with the auth store).
// - NEVER log tokens, response bodies, or full error objects.

/**
 * API origin. In a production build this is the same-site api host
 * (`https://api.circlecare.app`). In dev it is EMPTY so every request is
 * relative (`/api/...`) and hits the Vite dev server, which proxies `/api` to
 * VITE_API_URL (see vite.config.ts). That keeps the browser same-origin with
 * the API even when the backend is a Cloudflare tunnel on a different site —
 * without it the httpOnly session cookies would be cross-site and dropped,
 * logging the user out on every reload.
 */
const API_ORIGIN = import.meta.env.DEV ? '' : env.VITE_API_URL;

/** Logout handler registered by the auth store (breaks circular dependency). */
type AuthFailureHandler = () => void | Promise<void>;
let onAuthFailure: AuthFailureHandler | null = null;

export function setOnAuthFailure(handler: AuthFailureHandler | null): void {
  onAuthFailure = handler;
}

/**
 * SECURITY: explicit allowlist of the cookie-mode auth endpoints (plan: Auth
 * Flow + CSRF). ONLY these may carry ambient cookie credentials +
 * `X-Session-Mode: cookie`. Everything else — including other /auth routes —
 * stays Bearer-token-only so the CSRF surface never widens to data routes.
 */
const COOKIE_AUTH_ENDPOINTS = [
  '/auth/login',
  '/auth/refresh',
  '/auth/oauth-session',
  '/auth/logout',
] as const;

/** Path portion of a request url (relative to baseURL), without query/hash. */
function requestPath(url: string | undefined): string {
  if (!url) return '';
  return url.split('?')[0].split('#')[0];
}

function isCookieAuthEndpoint(url: string | undefined): boolean {
  const path = requestPath(url);
  return (COOKIE_AUTH_ENDPOINTS as readonly string[]).includes(path);
}

/** Any auth route (login, signup, verify-otp, ...) — a 401 here must never
 *  trigger a token refresh (the user is mid-auth, not stale). */
function isAuthEndpoint(url: string | undefined): boolean {
  return requestPath(url).startsWith('/auth/');
}

export const apiClient = axios.create({
  baseURL: `${API_ORIGIN}/api`,
  timeout: API_TIMEOUT,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Track if we're currently refreshing to prevent multiple refresh calls
let isRefreshing = false;
let refreshPromise: Promise<void> | null = null;

/**
 * Reset the module-level refresh state.
 * Must be called during signOut/signIn to clear any stale refresh locks
 * left over from a previous session (mirrors mobile's resetRefreshState).
 */
export function resetRefreshState(): void {
  isRefreshing = false;
  refreshPromise = null;
}

interface RefreshResponseBody {
  success?: boolean;
  data?: {
    session?: {
      access_token?: string;
      expires_at?: number;
    };
  };
}

/**
 * Cookie-based session refresh. The httpOnly cookie carries the refresh token;
 * in cookie mode the backend omits refresh_token from the response body and
 * rotates the cookie itself. Uses bare axios (NOT apiClient) so interceptors
 * cannot recurse.
 */
async function refreshAccessToken(): Promise<void> {
  const response = await axios.post<RefreshResponseBody>(
    `${API_ORIGIN}/api/auth/refresh`,
    {},
    {
      timeout: API_TIMEOUT,
      withCredentials: true,
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Mode': 'cookie',
      },
    }
  );

  const session = response.data?.data?.session;
  if (!session?.access_token) {
    throw new Error('Session refresh failed');
  }
  tokenAccessor.setToken(session.access_token, session.expires_at ?? null);
}

/** Single-flight refresh — concurrent callers share one in-flight request. */
function refreshTokenDeduped(): Promise<void> {
  if (isRefreshing && refreshPromise) {
    return refreshPromise;
  }
  isRefreshing = true;
  refreshPromise = refreshAccessToken().finally(() => {
    isRefreshing = false;
    refreshPromise = null;
  });
  return refreshPromise;
}

// Check if token is expired or about to expire (within 5 minutes)
function isTokenExpiredOrExpiring(): boolean {
  const expiresAt = tokenAccessor.getExpiresAt();
  if (!expiresAt) return false;

  const now = Date.now() / 1000; // seconds
  const bufferSeconds = 5 * 60;
  return expiresAt < now + bufferSeconds;
}

async function refreshTokenIfNeeded(): Promise<void> {
  if (!isTokenExpiredOrExpiring()) return;
  return refreshTokenDeduped();
}

// Request interceptor: cookie mode for auth endpoints only + Bearer token
apiClient.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    if (isCookieAuthEndpoint(config.url)) {
      // Cookie-mode auth endpoints ONLY: send the httpOnly session cookie +
      // CSRF custom header (forces a CORS preflight cross-origin attackers fail).
      config.withCredentials = true;
      config.headers.set('X-Session-Mode', 'cookie');
    } else {
      // Data endpoints: Bearer token only — never ambient cookie credentials.
      // Explicitly null the CSRF marker so even a caller-supplied header is
      // stripped (axios omits null headers on the wire).
      config.withCredentials = false;
      config.headers.set('X-Session-Mode', null);
      try {
        await refreshTokenIfNeeded();
      } catch {
        // If pre-refresh fails, continue with the current token.
        // The response interceptor will handle a 401.
      }
    }

    const token = tokenAccessor.getAuthToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor: unwrap `{ success, data, error }` envelope + 401 retry
apiClient.interceptors.response.use(
  (response) => response.data, // Extract envelope from success responses
  async (error: AxiosError) => {
    const originalRequest = error.config as
      | (InternalAxiosRequestConfig & { _retry?: boolean })
      | undefined;

    // 402 Payment Required — no purchase flow on web. The caller's own error
    // handler shows contextual feedback (banner/toast + "open the app" CTA).
    if (error.response?.status === 402) {
      return Promise.reject(error.response?.data || error);
    }

    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      // Never attempt token refresh for auth endpoints — the refresh request
      // itself goes through /auth/refresh, so retrying would create a deadlock.
      if (isAuthEndpoint(originalRequest.url)) {
        return Promise.reject(error.response?.data || error);
      }

      originalRequest._retry = true;

      // Single deduplicated refresh; concurrent 401s await the same promise.
      try {
        await refreshTokenDeduped();

        const newToken = tokenAccessor.getAuthToken();
        if (newToken) {
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
        }

        // Retry the original request
        return apiClient(originalRequest);
      } catch {
        // Only log out if the user actually had a token
        // (don't sign out unauthenticated visitors).
        if (tokenAccessor.getAuthToken()) {
          tokenAccessor.clear();
          await onAuthFailure?.();
        }
      }
    }

    return Promise.reject(error.response?.data || error);
  }
);
