import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { authApi, getApiError } from '@/api/auth';
import { useAuthStore } from '@/store/authStore';
import { peekPendingInviteCode } from '@/lib/pendingInviteCode';
import { setPendingAuthMethod } from '@/lib/pendingAuthMethod';
import { supabase } from '@/lib/supabase';
import { Analytics } from '@/lib/analytics';
import { isRateLimitError } from '@/lib/apiErrors';
import { useGuardedSubmit } from '@/hooks/useGuardedSubmit';
import { Button, Card, Text, TextField } from '@/components/ui';
import { AuthShell } from '@/components/auth/AuthShell';
import { AuthTopBar } from '@/components/auth/AuthTopBar';
import { AuthHeader } from '@/components/auth/AuthHeader';
import { AuthDivider } from '@/components/auth/AuthDivider';
import { OAuthButtons } from '@/components/auth/OAuthButtons';

// Task 8 — email/password login (cookie mode) + Google/Apple OAuth broker.
// The apiClient request interceptor adds `X-Session-Mode: cookie` +
// withCredentials to /auth/* calls, so the refresh token lands in the
// httpOnly cookie and never appears in the response body.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type OAuthProvider = 'google' | 'apple';

interface FieldErrors {
  email?: string;
  password?: string;
}

export default function LoginPage(): ReactElement {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const location = useLocation();
  const signIn = useAuthStore((state) => state.signIn);
  // No sensible fallback route for Login — when there's no prior history
  // (AuthGuard redirected here with `replace`, making /login history entry 0),
  // hide the back control instead of rendering a dead/site-exiting button.

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  // AuthGuard preserved the intended location — return there after sign-in.
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
  const stateDestination = from && from !== '/login' ? from : null;

  // VerifyEmailPage lands here when the OTP verified but the auto sign-in
  // session couldn't be established — acknowledge the verification instead of
  // showing a silent login form.
  const emailVerified = Boolean(
    (location.state as { emailVerified?: boolean } | null)?.emailVerified
  );

  // Focus the inline error when it appears (auth failures are inline, not toasts).
  useEffect(() => {
    if (formError) errorRef.current?.focus();
  }, [formError]);

  // `isSubmitting` below is the LOADING state, not the guard — see
  // `useGuardedSubmit` for why a state flag cannot stop a second submit
  // dispatched before React commits the first one's render (three
  // `login_started` events in 52 ms on 2026-09-03, three of five limiter
  // attempts burned, RATE_LIMIT 1.5 s later). The wrapper below is the guard.
  const submitLogin = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setFormError(null);

    const trimmedEmail = email.trim();
    const errors: FieldErrors = {};
    if (!trimmedEmail) {
      errors.email = t('validation.emailRequired');
    } else if (!EMAIL_RE.test(trimmedEmail)) {
      errors.email = t('validation.emailInvalid');
    }
    if (!password) {
      errors.password = t('validation.passwordRequired');
    }
    setFieldErrors(errors);
    if (errors.email) {
      emailRef.current?.focus();
      return;
    }
    if (errors.password) {
      passwordRef.current?.focus();
      return;
    }

    setIsSubmitting(true);
    Analytics.loginStarted('email');
    try {
      const response = await authApi.login({ email: trimmedEmail, password });
      signIn(response.data.session, response.data.user);
      Analytics.loginCompleted('email');
      // Router state wins when present (the invite landing page clears its
      // pending code once authenticated). With no state — e.g. an invitee who
      // bounced through /signup and came back — fall back to any invite code
      // parked in sessionStorage. Peek, don't consume: the invite landing
      // page's auto-accept effect needs to find the code still parked.
      const pendingInvite = stateDestination ? null : peekPendingInviteCode();
      navigate(
        stateDestination ?? (pendingInvite ? `/invite/${pendingInvite}` : '/circles'),
        { replace: true }
      );
    } catch (err) {
      const apiError = getApiError(err);
      // PHI-safe: only the backend error CODE, never the email or full error.
      Analytics.loginFailed('email', apiError?.code ?? 'LOGIN_FAILED');
      if (apiError?.code === 'EMAIL_NOT_VERIFIED') {
        const verifyEmail = apiError.email || trimmedEmail;
        // Best-effort fresh code before the verify screen (mirrors mobile).
        authApi.resendOtp({ email: verifyEmail }).catch(() => undefined);
        // Email travels in router state, NEVER in query params.
        navigate('/verify-email', { state: { email: verifyEmail, notVerified: true } });
        return;
      }
      // A 429 must say WAIT, not "try again": every retry during the limiter
      // window is another hit on the same bucket and extends the lockout.
      setFormError(
        isRateLimitError(err)
          ? t('rateLimited')
          : apiError?.code === 'LOGIN_FAILED'
            ? t('login.errors.invalidCredentials')
            : t('login.errors.loginFailed')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = useGuardedSubmit(submitLogin);

  // Guarded for the same reason, and more urgently: nothing here sets
  // `isSubmitting`, so the OAuth buttons were never even visually disabled
  // while a handshake was starting — two clicks fired two `login_started`
  // events and two `signInWithOAuth` redirects. One guard covers both
  // providers: only one handshake can be in flight at a time.
  const startOAuth = async (provider: OAuthProvider): Promise<void> => {
    setFormError(null);
    Analytics.loginStarted(provider);
    // Park the provider so /auth/callback can fire an accurate completion event
    // with the right method after the full-page OAuth redirect (router state
    // and this closure are both gone by then).
    setPendingAuthMethod(provider);
    const failureMessage =
      provider === 'google' ? t('login.errors.googleFailed') : t('login.errors.appleFailed');
    try {
      // Supabase is an OAuth handshake broker ONLY — the browser redirects to
      // the provider and returns to /auth/callback, where the tokens are
      // exchanged with our backend for an httpOnly cookie session.
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          skipBrowserRedirect: false,
        },
      });
      if (error) {
        Analytics.loginFailed(provider, 'OAUTH_INIT_FAILED');
        setFormError(failureMessage);
      }
    } catch {
      Analytics.loginFailed(provider, 'OAUTH_INIT_FAILED');
      setFormError(failureMessage);
    }
  };

  const handleOAuth = useGuardedSubmit(startOAuth);

  return (
    <AuthShell>
      {/* Login is the root of the signed-out flow: no back control. */}
      <AuthTopBar />
      <AuthHeader title={t('login.title')} subtitle={t('login.subtitle')} />

      {emailVerified && !formError ? (
        <div role="status" className="mb-4">
          <Card variant="filled" padding="sm">
            <Text variant="caption" className="text-ink-2">
              {t('verifyOtp.verifiedSignInNotice')}
            </Text>
          </Card>
        </div>
      ) : null}
      {formError ? (
        <div ref={errorRef} role="alert" tabIndex={-1} className="mb-4">
          <Card variant="filled" padding="sm">
            <Text variant="caption" className="text-terracotta-deep!">
              {formError}
            </Text>
          </Card>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <TextField
          ref={emailRef}
          id="login-email"
          name="email"
          type="email"
          label={t('login.emailLabel')}
          placeholder={t('login.emailPlaceholder')}
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={fieldErrors.email}
        />

        <div className="flex flex-col gap-1.5">
          <TextField
            ref={passwordRef}
            id="login-password"
            name="password"
            type="password"
            showToggle
            toggleLabels={{ show: t('login.showPassword'), hide: t('login.hidePassword') }}
            label={t('login.passwordLabel')}
            placeholder={t('login.passwordPlaceholder')}
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={fieldErrors.password}
          />
          <div className="flex items-center justify-end">
            <Link
              to="/forgot-password"
              className="inline-flex min-h-[44px] items-center text-sm font-semibold text-moss"
            >
              {t('login.forgotPassword')}
            </Link>
          </div>
        </div>

        <Button type="submit" variant="primary" size="lg" fullWidth loading={isSubmitting}>
          {isSubmitting ? t('login.signingIn') : t('login.signInButton')}
        </Button>
      </form>

      <AuthDivider label={t('login.orContinueWith')} />

      <OAuthButtons
        disabled={isSubmitting}
        appleLabel={t('login.continueWithApple')}
        googleLabel={t('login.continueWithGoogle')}
        onApple={() => void handleOAuth('apple')}
        onGoogle={() => void handleOAuth('google')}
      />

      <p className="m-0 mt-6 text-center text-sm text-ink-3">
        {t('login.noAccount')}{' '}
        <Link to="/signup" className="inline-flex min-h-[44px] items-center text-sm font-semibold text-moss">
          {t('login.createAccount')}
        </Link>
      </p>

      <a
        href="https://circlecare.app/help/"
        className="mt-6 inline-flex min-h-[44px] w-full items-center justify-center text-sm text-ink-3 underline"
      >
        {t('needHelp')}
      </a>
    </AuthShell>
  );
}
