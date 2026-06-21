import { create } from 'zustand';
import { resetRefreshState, setOnAuthFailure, apiClient } from '@/lib/api';
import { tokenAccessor } from '@/lib/tokenAccessor';
import { queryClient } from '@/lib/queryClient';
import { authApi, type AuthSession, type AuthUser } from '@/api/auth';
import { getCurrentUser } from '@/api/users';
import { identifyUser, resetAnalytics } from '@/lib/posthog';
import { Analytics } from '@/lib/analytics';

// Web auth store (Task 9) — mirrors mobile/src/store/authStore.ts adapted to
// the web threat model:
// - Access token lives in tokenAccessor (module memory) ONLY.
// - Refresh token is an httpOnly cookie this store never sees.
// - NO persistence middleware, ever — auth state must never touch
//   localStorage/sessionStorage.
// - Multi-tab sign-out via BroadcastChannel('cc-auth').

export type { AuthSession, AuthUser } from '@/api/auth';

interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  /** true until the boot-time silent cookie refresh attempt resolves */
  isBootstrapping: boolean;
  /** Store an in-memory session after login / OAuth / OTP verification. */
  signIn: (session: AuthSession, user: AuthUser) => void;
  /**
   * Boot-time silent cookie refresh. On success fetches /users/me; on failure
   * (first visit, expired cookie) remains logged out SILENTLY — never surfaces
   * an error. Single-flight: concurrent calls share one attempt.
   */
  bootstrap: () => Promise<void>;
  /**
   * Best-effort POST /auth/logout (clears the httpOnly cookie), then clears
   * tokenAccessor + React Query cache + state and broadcasts to other tabs.
   */
  signOut: () => Promise<void>;
}

const AUTH_CHANNEL_NAME = 'cc-auth';
let channel: BroadcastChannel | null = null;
let bootstrapPromise: Promise<void> | null = null;

/**
 * True when the backend's readable `cc_session` companion cookie is present —
 * our only client-visible signal that a session might exist (the real refresh
 * token is in an httpOnly cookie we can't read). When absent, bootstrap skips
 * the `/auth/refresh` call entirely so logged-out / first-time visitors never
 * hit that rate-limited endpoint on page load. The cookie carries no token and
 * is set/cleared in lockstep with the httpOnly refresh cookie.
 */
function hasSessionHint(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.split('; ').some((entry) => {
    const [name, value] = entry.split('=');
    return name === 'cc_session' && value === '1';
  });
}

/** Local-only teardown (no network, no broadcast) — shared by signOut and the
 *  cross-tab logout listener. */
function clearLocalSession(): void {
  resetRefreshState();
  tokenAccessor.clear();
  queryClient.clear();
  // Drop the analytics identity so the next user on a shared device starts
  // fresh (no-op when PostHog isn't initialized).
  resetAnalytics();
  useAuthStore.setState({ user: null, isAuthenticated: false, isBootstrapping: false });
}

/** Lazily create the cross-tab channel (guarded — jsdom may not provide it). */
function getAuthChannel(): BroadcastChannel | null {
  if (channel) return channel;
  if (typeof BroadcastChannel === 'undefined') return null;
  channel = new BroadcastChannel(AUTH_CHANNEL_NAME);
  channel.onmessage = (event: MessageEvent) => {
    const data = event.data as { type?: string } | null;
    if (data?.type === 'logout') {
      // Another tab signed out — tear down locally, never re-broadcast.
      clearLocalSession();
    }
  };
  return channel;
}

interface RefreshEnvelope {
  success?: boolean;
  data?: { session?: { access_token?: string; expires_at?: number } };
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isBootstrapping: true,

  signIn: (session, user) => {
    // Clear any stale refresh locks from a previous session (mirrors mobile).
    resetRefreshState();
    tokenAccessor.setToken(session.access_token, session.expires_at ?? null);
    identifyUser(user.id);
    set({ user, isAuthenticated: true, isBootstrapping: false });
  },

  bootstrap: () => {
    if (bootstrapPromise) return bootstrapPromise;
    bootstrapPromise = (async () => {
      // No session hint → no point calling the rate-limited /auth/refresh.
      // A logged-out / first-time visitor stays logged out without a network
      // request (mirrors how mobile checks SecureStore before refreshing).
      if (!hasSessionHint()) {
        set({ user: null, isAuthenticated: false, isBootstrapping: false });
        return;
      }
      try {
        // Silent cookie refresh — the apiClient interceptor adds
        // `X-Session-Mode: cookie` + withCredentials on /auth/* calls.
        const response = (await apiClient.post('/auth/refresh', {})) as unknown as RefreshEnvelope;
        const session = response?.data?.session;
        if (!session?.access_token) {
          throw new Error('No session');
        }
        tokenAccessor.setToken(session.access_token, session.expires_at ?? null);

        const user = await getCurrentUser();
        identifyUser(user.id);
        set({
          user: {
            id: user.id,
            email: user.email,
            first_name: user.first_name ?? null,
            last_name: user.last_name ?? null,
          },
          isAuthenticated: true,
          isBootstrapping: false,
        });
      } catch {
        // No cookie / expired session — a normal first visit. Stay logged out
        // quietly; never toast or log here.
        tokenAccessor.clear();
        set({ user: null, isAuthenticated: false, isBootstrapping: false });
      }
    })();
    return bootstrapPromise;
  },

  signOut: async () => {
    // Break any pending refresh deadlocks before tearing down state.
    resetRefreshState();

    // Capture while the identity is still attached (clearLocalSession resets it).
    Analytics.logout();

    // Best-effort server logout (clears httpOnly cookie, revokes session).
    // Idempotent on the backend; a network failure must not block local cleanup.
    try {
      await authApi.logout();
    } catch {
      // ignore — local cleanup still runs
    }

    clearLocalSession();

    // Tell other tabs to sign out too.
    getAuthChannel()?.postMessage({ type: 'logout' });
  },
}));

// Subscribe to cross-tab logout at module init.
getAuthChannel();

// When a 401 survives the deduplicated refresh, the API client clears the
// token and calls this — full sign-out also clears the stale cookie.
setOnAuthFailure(() => useAuthStore.getState().signOut());
