import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { authApi, getApiError } from '@/api/auth';
import { useAuthStore } from '@/store/authStore';
import { peekPendingInviteCode } from '@/lib/pendingInviteCode';
import { consumePendingAuthMethod } from '@/lib/pendingAuthMethod';
import { clearPendingTermsConsent, consumePendingTermsConsent } from '@/lib/pendingTermsConsent';
import { consumePendingAnalyticsConsent } from '@/lib/pendingAnalyticsConsent';
import { recordAnalyticsConsentDecision } from '@/lib/analyticsConsentDecision';
import { queueAnalyticsConsentForSignup } from '@/lib/analyticsConsentSync';
import { Analytics } from '@/lib/analytics';
import { Button, Spinner } from '@/components/ui';
import { AuthShell } from '@/components/auth/AuthShell';
import { AuthTopBar } from '@/components/auth/AuthTopBar';
import { TerminalState } from '@/components/auth/TerminalState';

// Task 8b — OAuth redirect callback.
// Supabase's implicit flow returns tokens in the URL FRAGMENT. They are read
// once, scrubbed from the address bar/history IMMEDIATELY (before any network
// call), exchanged with the backend for an httpOnly cookie session, and then
// discarded. Tokens are never logged and never written to any storage.

export default function AuthCallbackPage(): ReactElement {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const signIn = useAuthStore((state) => state.signIn);
  const [failure, setFailure] = useState<'error' | 'cancelled' | null>(null);
  const ranRef = useRef(false);

  useEffect(() => {
    // StrictMode runs effects twice — the URL is scrubbed on the first pass,
    // so the exchange must only ever run once.
    if (ranRef.current) return;
    ranRef.current = true;

    // Capture the raw fragment + query SYNCHRONOUSLY, then scrub tokens from
    // the URL IMMEDIATELY — before any parsing, await, analytics call, or
    // identify — so they never sit in history, referrers, session replay, or
    // logs. Everything below reads ONLY from these captured strings; nothing
    // may touch window.location.hash/search again.
    const rawHash = window.location.hash;
    const rawSearch = window.location.search;
    window.history.replaceState(null, '', '/auth/callback');

    const hashParams = new URLSearchParams(rawHash.startsWith('#') ? rawHash.slice(1) : rawHash);
    const queryParams = new URLSearchParams(rawSearch);

    const oauthError =
      hashParams.get('error_description') ||
      queryParams.get('error_description') ||
      hashParams.get('error') ||
      queryParams.get('error');
    const accessToken = hashParams.get('access_token');
    const refreshToken = hashParams.get('refresh_token');

    if (oauthError || !accessToken || !refreshToken) {
      // access_denied means the user deliberately cancelled the provider's
      // consent screen — that deserves a shrug, not a failure message.
      const cancelled =
        hashParams.get('error') === 'access_denied' ||
        queryParams.get('error') === 'access_denied' ||
        oauthError === 'access_denied';
      // Consumed on EVERY exit path, not just the happy one: the module's
      // contract is read-and-clear so a stale provider can never be attributed
      // to a later, unrelated sign-in.
      const method = consumePendingAuthMethod() ?? 'oauth';
      // Same read-and-clear contract for the parked ANALYTICS answer, and for
      // the same reason: no account was created here, so nothing is recorded —
      // but the parked value must not survive to be attributed to a later,
      // unrelated sign-in (this browser can be signed in as a different
      // account minutes from now). A retry re-renders the signup page with the
      // box unticked and parks a fresh answer.
      consumePendingAnalyticsConsent();
      // …and for the parked TERMS acceptance. Left behind, the next successful
      // callback in this tab (e.g. a returning user's OAuth LOGIN from /login,
      // which parks no terms of its own) consumed it and relayed
      // `termsAccepted: true` for an account that ticked nothing. The exchange
      // path below consumes it before its try, so its failures clear it too.
      clearPendingTermsConsent();
      if (!cancelled) {
        // Until now this branch reported NOTHING, so a broken web OAuth login
        // was invisible in the funnel: login_started fired at the button, the
        // browser left for the provider, and no terminal event ever landed.
        //
        // A STABLE CODE, never `oauthError`: that string is provider prose
        // (`error_description` is free text and can name the account), which is
        // both a user-text leak and an unbounded analytics dimension. The two
        // codes mirror mobile's OAuthErrorCode members so a `login_failed`
        // breakdown reads across platforms.
        Analytics.loginFailed(method, oauthError ? 'OAUTH_PROVIDER_ERROR' : 'OAUTH_NO_TOKENS');
      }
      setFailure(cancelled ? 'cancelled' : 'error');
      return;
    }

    void (async () => {
      // SignUpPage parked the consent-checkbox acceptance before the OAuth
      // redirect (the checkbox state itself cannot survive it) — relay it so
      // the backend records users.terms_accepted_at for OAuth SIGNUPS. Absent
      // for LoginPage-initiated OAuth (returning users); the backend only ever
      // fills a NULL, never overwrites an existing consent timestamp.
      const termsAccepted = consumePendingTermsConsent();
      // Consumed HERE, before the exchange, so it is cleared on every outcome
      // — a failed exchange must not leave an answer parked for a later,
      // unrelated sign-in. Held in a local and only RECORDED below, on
      // success: no account, no decision. `null` means nothing was parked (an
      // OAuth LOGIN, not a signup).
      const analyticsAnswer = consumePendingAnalyticsConsent();
      try {
        // Backend validates the access token, moves the refresh token into the
        // httpOnly cookie, and returns a cookie-mode session (no refresh_token).
        const response = await authApi.oauthSession({
          access_token: accessToken,
          refresh_token: refreshToken,
          ...(termsAccepted ? { termsAccepted: true as const } : {}),
        });
        // RECORD THE PARKED ANALYTICS ANSWER BEFORE `signIn`. The store's
        // `signIn` calls `identifyUser`, and `identifyUser` refuses unless the
        // mode is 'full' — so recording after it would leave a brand-new
        // CONSENTING user unidentified for the rest of the session, silently,
        // with the Profile toggle reading ON. `null` means nothing was parked
        // (an OAuth LOGIN, not a signup): record nothing and leave whatever
        // decision this browser already holds alone.
        //
        // …AND ONLY FOR AN ACCOUNT THIS SIGN-IN CREATED. The Sign-up page's
        // provider buttons work for EXISTING accounts too, and its analytics
        // box defaults to unticked, so a returning user who taps "Sign up with
        // Google" arrives here with a parked DECLINE they never chose. Recorded,
        // its server half withdraws their consent and deletes their PostHog
        // person and events — including a mobile user grandfathered ON. The
        // backend decides new-vs-returning from GoTrue's own timestamps; only
        // an explicit `true` counts. A missing field (a backend older than the
        // flag) is treated as RETURNING: losing a new user's answer is
        // recoverable from Profile, deleting a returning user's history is not.
        // The parked value was already consumed above, so it is cleared either
        // way and cannot leak into a later sign-in.
        if (analyticsAnswer !== null && response.data.is_new_user === true) {
          recordAnalyticsConsentDecision(analyticsAnswer, {
            id: response.data.user.id,
          });
          // The SERVER half of the same answer, and it has to be written HERE,
          // before `signIn`: `signIn` runs `flushAnalyticsConsentSync`, which
          // is what DELIVERS this marker. Recorded after it (or written
          // asynchronously and not awaited) the decision races its own flush
          // and is dropped for exactly the signups that go through a provider —
          // mobile shipped that bug and found it by mutation.
          //
          // Queued rather than POSTed from here: `signIn` has not run yet, so
          // this page's own request would carry whatever token the browser
          // already holds — and /auth/callback is public, so on a shared
          // browser that is somebody else's account. Delivery happens one line
          // below under the arriving user's own token.
          queueAnalyticsConsentForSignup(analyticsAnswer, response.data.user.id);
        }
        signIn(response.data.session, response.data.user);
        // Fire the OAuth completion event exactly once, only on success. The
        // provider was parked in sessionStorage before the redirect (this
        // closure never saw it); fall back to the generic 'oauth' method when
        // it's absent rather than guessing a provider.
        //
        // NOTE: we always emit login_completed, never signup_completed, for web
        // OAuth. /auth/oauth-session now returns `is_new_user` (used above for
        // the consent gate), but switching this event on it is a funnel change
        // left for a separate decision.
        Analytics.loginCompleted(consumePendingAuthMethod() ?? 'oauth');
        // An invite handoff parks its code in sessionStorage (router state
        // cannot survive the OAuth full-page redirect) — detour through the
        // invite page. PEEK, don't consume: InviteLandingPage's own effect
        // does the consume-and-auto-accept, so clearing it here would strand
        // the visitor on a card they have to tap "Accept" on manually.
        const pendingInvite = peekPendingInviteCode();
        navigate(pendingInvite ? `/invite/${pendingInvite}` : '/circles', { replace: true });
      } catch (err) {
        // The token exchange itself failed (backend rejected the tokens, or the
        // request never landed). Report the backend's own error CODE when there
        // is one — `getApiError` reads `err.error.code` and returns nothing for
        // a raw network rejection, which falls back to the mobile-matching
        // SESSION_FAILED shape. Never the message: it is server prose.
        Analytics.loginFailed(
          consumePendingAuthMethod() ?? 'oauth',
          getApiError(err)?.code ?? 'OAUTH_SESSION_FAILED'
        );
        setFailure('error');
      }
    })();
  }, [navigate, signIn]);

  if (failure === 'cancelled') {
    return (
      <AuthShell>
        <AuthTopBar />
        <TerminalState
          icon="alert-circle-outline"
          title={t('callback.errorTitle')}
          body={<span role="status">{t('callback.cancelled')}</span>}
        >
          <Button as={Link} to="/login" variant="primary" size="lg" fullWidth>
            {t('callback.backToLogin')}
          </Button>
        </TerminalState>
      </AuthShell>
    );
  }

  if (failure === 'error') {
    return (
      <AuthShell>
        <AuthTopBar />
        <TerminalState
          icon="alert-circle-outline"
          title={t('callback.errorTitle')}
          body={<span role="alert">{t('callback.error')}</span>}
        >
          <Button as={Link} to="/login" variant="primary" size="lg" fullWidth>
            {t('callback.backToLogin')}
          </Button>
        </TerminalState>
      </AuthShell>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg p-6">
      <Spinner size={32} />
      <p role="status" aria-live="polite" className="m-0 text-sm text-ink-3">
        {t('callback.signingIn')}
      </p>
    </main>
  );
}
