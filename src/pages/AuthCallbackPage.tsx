import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { authApi } from '@/api/auth';
import { useAuthStore } from '@/store/authStore';
import { consumePendingInviteCode } from '@/lib/pendingInviteCode';
import { consumePendingAuthMethod } from '@/lib/pendingAuthMethod';
import { Analytics } from '@/lib/analytics';
import { Spinner } from '@/components/ui';
import { AuthShell } from '@/components/auth/AuthShell';

// Task 8b — OAuth redirect callback.
// Supabase's implicit flow returns tokens in the URL FRAGMENT. They are read
// once, scrubbed from the address bar/history IMMEDIATELY (before any network
// call), exchanged with the backend for an httpOnly cookie session, and then
// discarded. Tokens are never logged and never written to any storage.

export default function AuthCallbackPage(): ReactElement {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const signIn = useAuthStore((state) => state.signIn);
  const [failed, setFailed] = useState(false);
  const ranRef = useRef(false);

  useEffect(() => {
    // StrictMode runs effects twice — the URL is scrubbed on the first pass,
    // so the exchange must only ever run once.
    if (ranRef.current) return;
    ranRef.current = true;

    const rawHash = window.location.hash;
    const hashParams = new URLSearchParams(rawHash.startsWith('#') ? rawHash.slice(1) : rawHash);
    const queryParams = new URLSearchParams(window.location.search);

    // Scrub tokens from the URL BEFORE any other work — they must never sit
    // in history, referrers, or logs.
    window.history.replaceState(null, '', '/auth/callback');

    const oauthError =
      hashParams.get('error_description') ||
      queryParams.get('error_description') ||
      hashParams.get('error') ||
      queryParams.get('error');
    const accessToken = hashParams.get('access_token');
    const refreshToken = hashParams.get('refresh_token');

    if (oauthError || !accessToken || !refreshToken) {
      setFailed(true);
      return;
    }

    void (async () => {
      try {
        // Backend validates the access token, moves the refresh token into the
        // httpOnly cookie, and returns a cookie-mode session (no refresh_token).
        const response = await authApi.oauthSession({
          access_token: accessToken,
          refresh_token: refreshToken,
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
        // cannot survive the OAuth full-page redirect) — resume it here.
        const pendingInvite = consumePendingInviteCode();
        navigate(pendingInvite ? `/invite/${pendingInvite}` : '/circles', { replace: true });
      } catch {
        setFailed(true);
      }
    })();
  }, [navigate, signIn]);

  if (failed) {
    return (
      <AuthShell title={t('callback.errorTitle')}>
        <p role="alert" className="m-0 mb-6 text-sm text-ink-2">
          {t('callback.error')}
        </p>
        <Link to="/login" className="btn btn-primary w-full">
          {t('callback.backToLogin')}
        </Link>
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
