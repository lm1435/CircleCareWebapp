import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { legalUrl } from '@/lib/legalLinks';
import { z } from 'zod';
import { authApi, getApiError } from '@/api/auth';
import { supabase } from '@/lib/supabase';
import { setPendingAuthMethod } from '@/lib/pendingAuthMethod';
import { setPendingTermsConsent } from '@/lib/pendingTermsConsent';
import { Analytics } from '@/lib/analytics';
import { utf8ByteLength } from '@/lib/utf8ByteLength';
import { Button, Card, Icon, Text, TextField } from '@/components/ui';
import { validateWithZod, focusFirstError, type FieldErrors } from '@/components/ui/useZodForm';
import { AuthShell } from '@/components/auth/AuthShell';
import { AuthTopBar } from '@/components/auth/AuthTopBar';
import { AuthHeader } from '@/components/auth/AuthHeader';
import { AuthDivider } from '@/components/auth/AuthDivider';
import { OAuthButtons } from '@/components/auth/OAuthButtons';
import { PasswordRequirements } from '@/components/auth/PasswordRequirements';
import { useAuthBack } from '@/components/auth/useAuthBack';

// Email/password sign-up (mirrors mobile SignUpScreen). The backend creates the
// user and emails a 6-digit OTP but returns NO session, so on success we route
// to /verify-email (which exchanges the OTP for an httpOnly cookie session).
// OAuth follows the same Supabase-broker flow as LoginPage.

type OAuthProvider = 'google' | 'apple';

// Locale-aware: full Spanish versions exist at /es/terms and /es/privacy.

// Sentinel zod message for the password max-length checks below — never
// shown to a user directly. `messageFor` inspects this to pick the dedicated
// "72 characters or fewer" copy instead of the generic passwordRules message
// every other password issue collapses to (see `messageFor`, field
// 'password').
const PASSWORD_MAX_LENGTH_ISSUE = 'password-max-length';

// Web mirror of mobile's signUpSchema (backend signUpSchema parity). The
// password max length matches mobile's `passwordSchema`
// (mobile/src/screens/auth/authValidation.ts): GoTrue/bcrypt rejects
// passwords over 72 UTF-8 BYTES, not 72 JS characters, so a plain
// `.max(72)` on string length is a fast path only — the `.refine` below is
// the actual cap.
const signUpSchema = z
  .object({
    first_name: z.string().trim().min(1),
    last_name: z.string().trim().min(1),
    email: z.string().trim().email(),
    password: z
      .string()
      .min(8)
      .max(72, PASSWORD_MAX_LENGTH_ISSUE)
      .regex(/[A-Z]/)
      .regex(/[a-z]/)
      .regex(/[0-9]/)
      .regex(/[^A-Za-z0-9]/)
      .refine((value) => utf8ByteLength(value) <= 72, PASSWORD_MAX_LENGTH_ISSUE),
    confirmPassword: z.string().min(1),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ['confirmPassword'],
  });

const FIELD_ORDER = ['first_name', 'last_name', 'email', 'password', 'confirmPassword'];

export default function SignUpPage(): ReactElement {
  const { t, i18n } = useTranslation('auth');
  const navigate = useNavigate();
  // /login is always a sensible fallback here, so the back button always
  // renders — history(-1) when there's somewhere to go back to (e.g. the
  // marketing site), '/login' when this is history entry 0.
  const { goBack } = useAuthBack('/login');

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  // REQUIRED consent checkbox — default UNCHECKED; gates both email/password
  // submit and the OAuth buttons (this page is signup-only, so every path out
  // of it creates an account).
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const errorRef = useRef<HTMLDivElement>(null);

  // Focus the inline error when it appears (auth failures are inline, not toasts).
  useEffect(() => {
    if (formError) errorRef.current?.focus();
  }, [formError]);

  // Map a Zod issue path to a localized, user-facing message. `rawMessage` is
  // the raw Zod issue message for that field — only 'password' inspects it
  // (see PASSWORD_MAX_LENGTH_ISSUE), so every other zod message on these
  // fields stays untranslated prose that is never shown.
  const messageFor = (field: string, rawMessage?: string): string => {
    switch (field) {
      case 'first_name':
        return t('signup.errors.firstNameRequired');
      case 'last_name':
        return t('signup.errors.lastNameRequired');
      case 'email':
        return email.trim() ? t('validation.emailInvalid') : t('validation.emailRequired');
      case 'password':
        return rawMessage === PASSWORD_MAX_LENGTH_ISSUE
          ? t('validation.passwordMaxLength')
          : t('signup.errors.passwordRules');
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
        localized[key] = messageFor(key, result.errors[key]);
      }
      setFieldErrors(localized);
      focusFirstError(localized, FIELD_ORDER);
      return;
    }

    // Form-level consent guard. The submit button is disabled until the
    // checkbox is ticked, so this only fires on programmatic/edge submissions —
    // but the account must never be created without explicit consent.
    if (!termsAccepted) {
      setFormError(t('signup.errors.termsRequired'));
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
        termsAccepted: true,
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
    // OAuth signups require the same explicit consent as email/password — the
    // buttons are disabled until the checkbox is ticked; this guard is the
    // belt-and-braces equivalent of the form-level one above.
    if (!termsAccepted) {
      setFormError(t('signup.errors.termsRequired'));
      return;
    }
    // Park the acceptance across the full-page provider redirect so
    // /auth/callback can relay `termsAccepted: true` to the backend, which
    // records users.terms_accepted_at for OAuth signups.
    setPendingTermsConsent();
    Analytics.signupStarted(provider);
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
        Analytics.signupFailed(provider, 'OAUTH_INIT_FAILED');
        setFormError(failureMessage);
      }
    } catch {
      Analytics.signupFailed(provider, 'OAUTH_INIT_FAILED');
      setFormError(failureMessage);
    }
  };

  return (
    <AuthShell>
      <AuthTopBar onBack={goBack} />
      <AuthHeader title={t('signup.title')} subtitle={t('signup.subtitle')} />

      {formError ? (
        <div ref={errorRef} role="alert" tabIndex={-1} className="mb-4">
          <Card variant="filled" padding="sm">
            <Text variant="caption" className="text-terracotta-deep!">
              {formError}
            </Text>
          </Card>
        </div>
      ) : null}

      <OAuthButtons
        disabled={isSubmitting || !termsAccepted}
        appleLabel={t('login.continueWithApple')}
        googleLabel={t('login.continueWithGoogle')}
        onApple={() => void handleOAuth('apple')}
        onGoogle={() => void handleOAuth('google')}
      />

      <AuthDivider label={t('signup.orSignUpWithEmail')} />

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex-1">
            <TextField
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
            <TextField
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

        <TextField
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

        <TextField
          id="password"
          name="password"
          type="password"
          showToggle
          toggleLabels={{ show: t('login.showPassword'), hide: t('login.hidePassword') }}
          label={t('signup.passwordLabel')}
          placeholder={t('signup.passwordPlaceholder')}
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldErrors.password}
        />

        <PasswordRequirements value={password} />

        <TextField
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          showToggle
          toggleLabels={{ show: t('login.showPassword'), hide: t('login.hidePassword') }}
          label={t('signup.confirmPasswordLabel')}
          placeholder={t('signup.confirmPasswordPlaceholder')}
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          error={fieldErrors.confirmPassword}
        />

        {/* Explicit, REQUIRED consent — a real checkbox control (not a passive
            notice): default-unchecked, keyboard operable (native <input>,
            Space toggles). A visually-hidden native checkbox sits inside a
            <label> that wraps BOTH the icon and the sentence (mirrors
            mobile's single TouchableOpacity around icon + text) so clicking
            anywhere in the row — including the sentence, not just the glyph —
            toggles it; the Terms/Privacy <a> links nest inside the label
            without also toggling it (browsers don't forward a label's click
            to its control when the click landed on a nested link/button). It
            gates the submit button below AND the OAuth buttons (both create
            accounts from this page). */}
        <div className="flex items-start gap-3">
          <label
            htmlFor="termsAccepted"
            className="flex min-h-[44px] cursor-pointer items-start gap-3"
          >
            <input
              type="checkbox"
              id="termsAccepted"
              checked={termsAccepted}
              onChange={(event) => setTermsAccepted(event.target.checked)}
              aria-required="true"
              className="peer sr-only"
            />
            <Icon
              name={termsAccepted ? 'checkbox' : 'square-outline'}
              size="chrome"
              className={`mt-0.5 shrink-0 rounded-sm peer-focus-visible:ring-2 peer-focus-visible:ring-moss peer-focus-visible:ring-offset-2 ${
                termsAccepted ? 'text-moss-deep' : 'text-ink-3'
              }`}
            />
            <span className="text-sm leading-snug text-ink-2">
              <Trans
                i18nKey="signup.termsCheckbox"
                ns="auth"
                components={{
                  terms: (
                    <a
                      className="text-terracotta-deep underline"
                      href={legalUrl('terms', i18n.language)}
                      target="_blank"
                      rel="noreferrer"
                    />
                  ),
                  privacy: (
                    <a
                      className="text-terracotta-deep underline"
                      href={legalUrl('privacy', i18n.language)}
                      target="_blank"
                      rel="noreferrer"
                    />
                  ),
                }}
              />
            </span>
          </label>
        </div>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          fullWidth
          loading={isSubmitting}
          disabled={!termsAccepted}
        >
          {isSubmitting ? t('signup.creatingAccount') : t('signup.createAccountButton')}
        </Button>
      </form>

      <p className="m-0 mt-6 text-center text-sm text-ink-3">
        {t('signup.hasAccount')}{' '}
        <Link to="/login" className="inline-flex min-h-[44px] items-center text-sm font-semibold text-moss">
          {t('signup.signIn')}
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
