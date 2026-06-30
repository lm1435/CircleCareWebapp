import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { z } from 'zod';
import { authApi, getApiError } from '@/api/auth';
import { supabase } from '@/lib/supabase';
import { Analytics } from '@/lib/analytics';
import { Button } from '@/components/ui';
import { validateWithZod, focusFirstError, type FieldErrors } from '@/components/ui/useZodForm';
import { AuthShell } from '@/components/auth/AuthShell';
import { FormField } from '@/components/auth/FormField';
import { OAuthButtons } from '@/components/auth/OAuthButtons';
import { PasswordRequirements } from '@/components/auth/PasswordRequirements';

// Email/password sign-up (mirrors mobile SignUpScreen). The backend creates the
// user and emails a 6-digit OTP but returns NO session, so on success we route
// to /verify-email (which exchanges the OTP for an httpOnly cookie session).
// OAuth follows the same Supabase-broker flow as LoginPage.

type OAuthProvider = 'google' | 'apple';

const TERMS_URL = 'https://circlecare.app/terms';
const PRIVACY_URL = 'https://circlecare.app/privacy';

// Web mirror of mobile's signUpSchema (backend signUpSchema parity).
const signUpSchema = z
  .object({
    first_name: z.string().trim().min(1),
    last_name: z.string().trim().min(1),
    email: z.string().trim().email(),
    password: z
      .string()
      .min(8)
      .regex(/[A-Z]/)
      .regex(/[a-z]/)
      .regex(/[0-9]/)
      .regex(/[^A-Za-z0-9]/),
    confirmPassword: z.string().min(1),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ['confirmPassword'],
  });

const FIELD_ORDER = ['first_name', 'last_name', 'email', 'password', 'confirmPassword'];

export default function SignUpPage(): ReactElement {
  const { t, i18n } = useTranslation('auth');
  const navigate = useNavigate();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const errorRef = useRef<HTMLDivElement>(null);

  // Focus the inline error when it appears (auth failures are inline, not toasts).
  useEffect(() => {
    if (formError) errorRef.current?.focus();
  }, [formError]);

  // Map a Zod issue path to a localized, user-facing message.
  const messageFor = (field: string): string => {
    switch (field) {
      case 'first_name':
        return t('signup.errors.firstNameRequired');
      case 'last_name':
        return t('signup.errors.lastNameRequired');
      case 'email':
        return email.trim() ? t('validation.emailInvalid') : t('validation.emailRequired');
      case 'password':
        return t('signup.errors.passwordRules');
      case 'confirmPassword':
        return confirmPassword
          ? t('validation.passwordsDoNotMatch')
          : t('validation.confirmPasswordRequired');
      default:
        return t('signup.errors.signUpFailed');
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setFormError(null);

    const result = validateWithZod(signUpSchema, {
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      email: email.trim(),
      password,
      confirmPassword,
    });

    if (!result.success) {
      const localized: FieldErrors = {};
      for (const key of Object.keys(result.errors)) {
        localized[key] = messageFor(key);
      }
      setFieldErrors(localized);
      focusFirstError(localized, FIELD_ORDER);
      return;
    }

    setFieldErrors({});
    setIsSubmitting(true);
    Analytics.signupStarted('email');
    try {
      await authApi.signup({
        email: result.data.email,
        password: result.data.password,
        first_name: result.data.first_name,
        last_name: result.data.last_name,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        language: i18n.language === 'es' ? 'es' : 'en',
      });
      Analytics.signupCompleted('email');
      // Email travels in router STATE, never in query params.
      navigate('/verify-email', { state: { email: result.data.email } });
    } catch (err) {
      const apiError = getApiError(err);
      const message = (apiError?.message ?? '').toLowerCase();
      const alreadyExists =
        apiError?.code === 'USER_EXISTS' ||
        message.includes('already') ||
        message.includes('registered');
      // PHI-safe: only the backend error CODE (or a generic fallback), never the
      // email or the full error object.
      Analytics.signupFailed('email', apiError?.code ?? 'SIGNUP_FAILED');
      setFormError(
        alreadyExists ? t('signup.errors.emailExists') : t('signup.errors.signUpFailed')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOAuth = async (provider: OAuthProvider): Promise<void> => {
    setFormError(null);
    Analytics.signupStarted(provider);
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
        Analytics.signupFailed(provider, 'OAUTH_INIT_FAILED');
        setFormError(failureMessage);
      }
    } catch {
      Analytics.signupFailed(provider, 'OAUTH_INIT_FAILED');
      setFormError(failureMessage);
    }
  };

  return (
    <AuthShell title={t('signup.title')} subtitle={t('signup.subtitle')}>
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
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex-1">
            <FormField
              id="first_name"
              name="first_name"
              type="text"
              label={t('signup.firstNameLabel')}
              placeholder={t('signup.firstNamePlaceholder')}
              autoComplete="given-name"
              required
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              error={fieldErrors.first_name}
            />
          </div>
          <div className="flex-1">
            <FormField
              id="last_name"
              name="last_name"
              type="text"
              label={t('signup.lastNameLabel')}
              placeholder={t('signup.lastNamePlaceholder')}
              autoComplete="family-name"
              required
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              error={fieldErrors.last_name}
            />
          </div>
        </div>

        <FormField
          id="email"
          name="email"
          type="email"
          label={t('signup.emailLabel')}
          placeholder={t('signup.emailPlaceholder')}
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldErrors.email}
        />

        <div className="flex flex-col gap-2">
          <FormField
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            label={t('signup.passwordLabel')}
            placeholder={t('signup.passwordPlaceholder')}
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={fieldErrors.password}
          />
          <button
            type="button"
            onClick={() => setShowPassword((current) => !current)}
            aria-pressed={showPassword}
            className="self-start cursor-pointer border-0 bg-transparent p-0 text-sm text-ink-3 underline"
          >
            {showPassword ? t('login.hidePassword') : t('login.showPassword')}
          </button>
          <PasswordRequirements value={password} />
        </div>

        <FormField
          id="confirmPassword"
          name="confirmPassword"
          type={showPassword ? 'text' : 'password'}
          label={t('signup.confirmPasswordLabel')}
          placeholder={t('signup.confirmPasswordPlaceholder')}
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          error={fieldErrors.confirmPassword}
        />

        <Button type="submit" variant="primary" disabled={isSubmitting} className="w-full">
          {isSubmitting ? t('signup.creatingAccount') : t('signup.createAccountButton')}
        </Button>
      </form>

      <p className="m-0 mt-4 text-center text-xs text-ink-3">
        <Trans
          i18nKey="signup.terms"
          ns="auth"
          components={{
            terms: (
              <a
                className="text-terracotta-deep underline"
                href={TERMS_URL}
                target="_blank"
                rel="noreferrer"
              />
            ),
            privacy: (
              <a
                className="text-terracotta-deep underline"
                href={PRIVACY_URL}
                target="_blank"
                rel="noreferrer"
              />
            ),
          }}
        />
      </p>

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
        {t('signup.hasAccount')}{' '}
        <Link to="/login" className="font-medium text-terracotta-deep">
          {t('signup.signIn')}
        </Link>
      </p>
    </AuthShell>
  );
}
