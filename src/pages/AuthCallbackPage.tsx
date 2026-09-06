import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { authApi, getApiError } from '@/api/auth';
import { useAuthStore } from '@/store/authStore';
import { peekPendingInviteCode } from '@/lib/pendingInviteCode';
import { consumePendingAuthMethod } from '@/lib/pendingAuthMethod';
import { consumePendingTermsConsent } from '@/lib/pendingTermsConsent';
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
      try {
        // Backend validates the access token, moves the refresh token into the
        // httpOnly cookie, and returns a cookie-mode session (no refresh_token).
        const response = await authApi.oauthSession({
          access_token: accessToken,
          refresh_token: refreshToken,
          ...(termsAccepted ? { termsAccepted: true as const } : {}),
        });
        signIn(response.data.session, response.data.user);
        // Fire the OAuth completion event exactly once, only on success. The
        // provider was parked in sessionStorage before the redirect (this
        // closure never saw it); fall back to the generic 'oauth' method when
        // it's absent rather than guessing a provider.
        //
        // NOTE: we always emit login_completed, never signup_completed, for web
        // OAuth. The backend /auth/oauth-session response (backend/src/routes/
        // auth.ts) exposes no new-vs-returning-user flag, so distinguishing
        // first-time sign-up from returning login would require a backend change
        // that's out of scope here.
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
