import { create } from 'zustand';
import { resetRefreshState, setOnAuthFailure, apiClient } from '@/lib/api';
import { tokenAccessor } from '@/lib/tokenAccessor';
import { queryClient } from '@/lib/queryClient';
import { authApi, type AuthSession, type AuthUser } from '@/api/auth';
import { getCurrentUser } from '@/api/users';
import { identifyUser, resetAnalytics } from '@/lib/posthog';
import { flushAnalyticsConsentSync } from '@/lib/analyticsConsentSync';
import { clearPendingInviteCode } from '@/lib/pendingInviteCode';
import { Analytics } from '@/lib/analytics';
import i18n from '@/i18n';

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
/** Mirrors SESSION_HINT_COOKIE_NAME in backend/src/middleware/webSession.ts. */
const SESSION_HINT_COOKIE_NAME = 'cc_session';
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
    return name === SESSION_HINT_COOKIE_NAME && value === '1';
  });
}

/**
 * Expire the readable `cc_session` hint cookie from the client.
 *
 * WHY THIS EXISTS. Sign-out's server call is best-effort by design — a network
 * failure must not block local cleanup. But until this, local cleanup could not
 * touch the cookies AT ALL: only the backend's Set-Cookie cleared them. So a
 * logout whose request never landed (offline, or the API edge 502ing) tore down
 * in-memory state, sent the user to /login, and left BOTH cookies intact — and
 * the next page load read the surviving hint, called /auth/refresh with the
 * still-valid 90-day refresh cookie, and signed the user back in. Sign-out
 * appeared to work and silently undid itself. Mobile has no such hole: deleting
 * the SecureStore blob is local and cannot fail this way.
 *
 * `cc_refresh` CANNOT be cleared here — it is httpOnly, which is the whole
 * point of it. So this is mitigation, not revocation: the refresh cookie stays
 * a dormant credential until the server clears it or it expires. Killing the
 * hint is enough to stop the automatic re-login, because bootstrap short-
 * circuits without it.
 *
 * Deleting a cookie only lands when Domain and Path match the ones it was set
 * with. The backend sets Path=/ and Domain=COOKIE_DOMAIN (`.circlecare.app` in
 * production, UNSET in local dev where page and API share a host) — and the
 * client has no env var naming it. So walk the hostname's parent chain and
 * expire each candidate, plus the host-only form for dev. A miss is a silent
 * no-op, never an error, which is exactly why we do not guess a single domain.
 */
function clearSessionHintCookie(): void {
  if (typeof document === 'undefined' || typeof location === 'undefined') return;
  const expired = `${SESSION_HINT_COOKIE_NAME}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/`;

  // Host-only form (local dev: the backend attaches no Domain there).
  document.cookie = expired;

  const host = location.hostname;
  // An IP literal or bare `localhost` has no parent domain to walk.
  if (host === 'localhost' || /^[\d.]+$/.test(host) || host.includes(':')) return;

  const parts = host.split('.');
  // Stop before the public suffix: `my.circlecare.app` yields
  // `.my.circlecare.app` then `.circlecare.app` (the one that matches), and
  // never the unsettable `.app`.
  for (let i = 0; i < parts.length - 1; i++) {
    document.cookie = `${expired}; Domain=.${parts.slice(i).join('.')}`;
  }
}

/** Local-only teardown (no network, no broadcast) — shared by signOut and the
 *  cross-tab logout listener. */
function clearLocalSession(): void {
  resetRefreshState();
  tokenAccessor.clear();
  queryClient.clear();
  // Before anything else that could throw: a surviving hint cookie is what
  // silently restores the session on the next load (see clearSessionHintCookie).
  clearSessionHintCookie();
  // Drop any parked invite code: on a shared tab, user A's un-accepted invite
  // must not silently auto-accept when user B signs in later (the login/
  // callback pages PEEK the code and forward to /invite/:code, which consumes
  // it on any authenticated arrival).
  clearPendingInviteCode();
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

/**
 * Report the browser locale at the first authenticated moment the backend owns
 * — a fresh sign-in and a restored cookie session alike — so a brand-new
 * account's welcome email goes out in the right language (mirrors mobile
 * authStore, which calls it from both signIn and initialize).
 *
 * FIRE AND FORGET: never awaited, never surfaced. The endpoint short-circuits
 * on every later sign-in, and a failure must not touch the sign-in flow.
 */
function reportSessionEstablished(): void {
  try {
    // i18n.language can be region-qualified ('es-MX'); the backend takes the
    // base 'en' | 'es' only.
    const language = i18n.language?.toLowerCase().startsWith('es') ? 'es' : 'en';
    void authApi.sessionEstablished(language).catch(() => {
      // ignore — sign-in must never depend on this
    });
  } catch {
    // ignore — bootstrap calls this inside its own try, so a throw here would
    // otherwise be read as a failed session restore.
  }
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
    identifyUser(user.id, user.email);
    // Deliver a consent decision that failed to reach the server last time.
    void flushAnalyticsConsentSync(user.id);
    set({ user, isAuthenticated: true, isBootstrapping: false });
    reportSessionEstablished();
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
        identifyUser(user.id, user.email);
        // Deliver a consent decision that failed to reach the server last time.
        void flushAnalyticsConsentSync(user.id);
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
        reportSessionEstablished();
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
    const signingOutUserId = useAuthStore.getState().user?.id ?? null;

    // Best-effort server logout (clears httpOnly cookie, revokes session).
    // Idempotent on the backend; a network failure must not block local cleanup.
    try {
      await authApi.logout();
    } catch {
      // ignore — local cleanup still runs
    }

    // One more delivery attempt for this user's own undelivered consent
    // decision, BEFORE tokenAccessor/state get wiped below — this is the last
    // moment the signing-out user's token is still live. Without this, a
    // decision that failed earlier just sits there until this same account
    // signs back in, and on a shared browser a DIFFERENT account signing in
    // next must never be the one to flush (or delete) it — see
    // flushAnalyticsConsentSync's userId check. Best-effort: any failure here
    // just leaves the marker for that later retry.
    if (signingOutUserId) {
      try {
        await flushAnalyticsConsentSync(signingOutUserId);
      } catch {
        // ignore — sign-out must never depend on this
      }
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
