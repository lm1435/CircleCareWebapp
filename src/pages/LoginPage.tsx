import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { authApi, getApiError } from '@/api/auth';
import { useAuthStore } from '@/store/authStore';
import { supabase } from '@/lib/supabase';
import { Analytics } from '@/lib/analytics';
import { Button } from '@/components/ui';
import { AuthShell } from '@/components/auth/AuthShell';
import { FormField } from '@/components/auth/FormField';
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

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  // AuthGuard preserved the intended location — return there after sign-in.
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
  const destination = from && from !== '/login' ? from : '/circles';

  // Focus the inline error when it appears (auth failures are inline, not toasts).
  useEffect(() => {
    if (formError) errorRef.current?.focus();
  }, [formError]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
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
      navigate(destination, { replace: true });
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
      setFormError(
        apiError?.code === 'LOGIN_FAILED'
          ? t('login.errors.invalidCredentials')
          : t('login.errors.loginFailed')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOAuth = async (provider: OAuthProvider): Promise<void> => {
    setFormError(null);
    Analytics.loginStarted(provider);
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

  return (
    <AuthShell title={t('login.title')} subtitle={t('login.subtitle')}>
      {formError ? (
        <div
          ref={errorRef}
          role="alert"
          tabIndex={-1}
          className="mb-4 rounded-xl border border-terracotta-deep/40 bg-bg-2 p-3 text-sm text-terracotta-deep"
        >
          {formError}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <FormField
          ref={emailRef}
          id="login-email"
          name="email"
          type="email"
          label={t('login.emailLabel')}
          placeholder={t('login.emailPlaceholder')}
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={fieldErrors.email}
        />

        <div className="flex flex-col gap-1.5">
          <FormField
            ref={passwordRef}
            id="login-password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            label={t('login.passwordLabel')}
            placeholder={t('login.passwordPlaceholder')}
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={fieldErrors.password}
          />
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setShowPassword((current) => !current)}
              aria-pressed={showPassword}
              className="cursor-pointer border-0 bg-transparent p-0 text-sm text-ink-3 underline"
            >
              {showPassword ? t('login.hidePassword') : t('login.showPassword')}
            </button>
            <Link to="/forgot-password" className="text-sm font-medium text-terracotta-deep">
              {t('login.forgotPassword')}
            </Link>
          </div>
        </div>

        <Button type="submit" variant="primary" disabled={isSubmitting} className="w-full">
          {isSubmitting ? t('login.signingIn') : t('login.signInButton')}
        </Button>
      </form>

      <div className="my-6 flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
        <span className="text-sm text-ink-3">{t('login.orContinueWith')}</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <OAuthButtons
        disabled={isSubmitting}
        appleLabel={t('login.continueWithApple')}
        googleLabel={t('login.continueWithGoogle')}
        onApple={() => void handleOAuth('apple')}
        onGoogle={() => void handleOAuth('google')}
      />

      <p className="m-0 mt-6 text-center text-sm text-ink-3">
        {t('login.noAccount')}{' '}
        <Link to="/signup" className="font-medium text-terracotta-deep">
          {t('login.createAccount')}
        </Link>
      </p>
    </AuthShell>
  );
}
