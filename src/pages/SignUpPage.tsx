import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { legalUrl } from '@/lib/legalLinks';
import { z } from 'zod';
import { authApi, getApiError } from '@/api/auth';
import { supabase } from '@/lib/supabase';
import { setPendingAuthMethod } from '@/lib/pendingAuthMethod';
import { setPendingTermsConsent, clearPendingTermsConsent } from '@/lib/pendingTermsConsent';
import {
  setPendingAnalyticsConsent,
  clearPendingAnalyticsConsent,
} from '@/lib/pendingAnalyticsConsent';
import { recordAnalyticsConsentDecision } from '@/lib/analyticsConsentDecision';
import { setAnalyticsConsentOwner } from '@/lib/analyticsConsent';
import { queueAnalyticsConsentForSignup } from '@/lib/analyticsConsentSync';
import { Analytics } from '@/lib/analytics';
import { isRateLimitError } from '@/lib/apiErrors';
import { useGuardedSubmit } from '@/hooks/useGuardedSubmit';
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
  // OPTIONAL analytics consent — the web app's only consent moment, and the
  // reason the stored state can now say "declined" rather than only defaulting
  // to it (lib/analyticsConsent.ts). Deliberately NOT bundled with the Terms
  // checkbox above and deliberately not gating anything: analytics is not a
  // condition of having an account. Default UNCHECKED, and never seeded from a
  // stored decision either — a pre-ticked box is not consent, and signup means
  // a NEW person may be at a browser where somebody else already said yes.
  const [analyticsAccepted, setAnalyticsAccepted] = useState(false);
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

  // `isSubmitting` is the LOADING state, not the guard: React commits it a
  // render too late to stop a second submit dispatched in the same tick (see
  // `useGuardedSubmit`). Signup sits on the 5-per-5-minutes `authRateLimit`
  // bucket and the second request would 400 USER_EXISTS against the account
  // the first one just created — two of five slots spent to show the user an
  // "email already registered" error for their own brand-new account.
  const submitSignUp = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
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
      const response = await authApi.signup({
        email: result.data.email,
        password: result.data.password,
        first_name: result.data.first_name,
        last_name: result.data.last_name,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        language: i18n.language === 'es' ? 'es' : 'en',
        termsAccepted: true,
      });
      // RECORD THE ANALYTICS ANSWER — either answer — and record it HERE:
      //
      //  - After the account exists, so a failed attempt (USER_EXISTS, a
      //    network blip) stamps nothing and the visitor is still owed the
      //    question when they retry.
      //  - Before `signupCompleted`, so the single most important event in the
      //    activation funnel is captured under the mode the user just chose
      //    rather than the one they arrived in.
      //
      // No user id is passed: this endpoint returns an OTP, not a session, so
      // there is nobody to identify yet — the auth store does that at verify
      // time, and by then consent is recorded and `identifyAllowed` says yes.
      //
      // ONLY ONCE AN ACCOUNT PROVABLY EXISTS — the record lives inside the
      // `newUserId` check below. A blocked-domain signup gets a fake 200 with
      // no `data`; recording before that check stored an OWNERLESS answer
      // that the next account to sign in on this browser adopted.
      //
      // …and the SERVER half of the same answer. Recording only the client
      // half left `analytics_consent_withdrawn_at` NULL, and NULL means
      // CAPTURE ALLOWED: a decliner was silent in this browser while the
      // backend went on capturing against their user id (a RevenueCat webhook
      // is usually the first, which creates the PostHog person they refused).
      //
      // QUEUED, NOT SENT. There is no session yet — the response carries a
      // user but no token — and /signup is a public route, so a request fired
      // here would go out under whatever token this browser already holds and
      // stamp somebody else's account. The marker is written under the NEW
      // user's id and delivered by `flushAnalyticsConsentSync` inside
      // `authStore.signIn`, which /verify-email reaches minutes later at most.
      //
      // Optional chaining, not confidence: a signup from a blocked domain gets
      // a fake 200 with no `data` envelope at all (backend/src/routes/auth.ts),
      // and no account means nothing to record.
      const newUserId = response?.data?.user?.id;
      if (newUserId) {
        recordAnalyticsConsentDecision(analyticsAccepted);
        // Stamp the CLIENT half with the same id. The answer above was
        // recorded without a session, so it is ownerless until now — and an
        // ownerless answer is adopted by whichever account signs in next,
        // which on a shared browser need not be this one. The account exists
        // by this line even though its session does not.
        setAnalyticsConsentOwner(newUserId);
        queueAnalyticsConsentForSignup(analyticsAccepted, newUserId);
      }
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
        isRateLimitError(err)
          ? t('rateLimited')
          : alreadyExists
            ? t('signup.errors.emailExists')
            : t('signup.errors.signUpFailed')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = useGuardedSubmit(submitSignUp);

  // Guarded for the same reason, and more urgently: nothing here sets
  // `isSubmitting`, so two clicks fired two `signup_started` events and two
  // `signInWithOAuth` redirects. One guard covers both providers.
  const startOAuth = async (provider: OAuthProvider): Promise<void> => {
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
    // Park the ANALYTICS answer across the same redirect, for the same reason:
    // most signups are Google/Apple, so a consent moment that only worked on
    // the email form would be skipped by the majority of new accounts. Both
    // answers are parked (see lib/pendingAnalyticsConsent) — a decline that
    // does not survive the redirect is indistinguishable from never asking.
    // Nothing is recorded locally yet: AuthCallbackPage does that, and only on
    // a completed sign-in, since this handshake can still fail or be cancelled.
    setPendingAnalyticsConsent(analyticsAccepted);
    Analytics.signupStarted(provider);
    // Park the provider so /auth/callback can fire an accurate completion event
    // with the right method after the full-page OAuth redirect (router state
    // and this closure are both gone by then).
    setPendingAuthMethod(provider);
    const failureMessage =
      provider === 'google' ? t('login.errors.googleFailed') : t('login.errors.appleFailed');
    // THE HANDSHAKE NEVER STARTED — UNPARK EVERYTHING.
    //
    // `AuthCallbackPage` clears both parked values on every path IT reaches,
    // which covers a handshake that got as far as the provider. It cannot
    // cover this one: when `signInWithOAuth` fails before the redirect
    // (offline, a Supabase 5xx, a blocked popup) the browser stays on this
    // page, no callback ever runs, and the parked values survive for the life
    // of the TAB — across an SPA navigation to /login, where an OAuth sign-in
    // for a different, possibly RETURNING, account consumes them.
    //
    // For the analytics answer that is destructive, not merely untidy: the
    // stale value is '0' (the default — the box is unticked), the callback
    // records it as a decline, and the server half of a decline calls
    // `deletePostHogPerson(userId)` with `delete_events=true`. A returning
    // user's whole analytics record, deleted on the strength of a box they
    // never touched. For the terms acceptance it is a false legal record:
    // /login parks no terms consent of its own, so the leftover would relay
    // `termsAccepted: true` and stamp `users.terms_accepted_at`.
    const unparkHandshake = (): void => {
      clearPendingAnalyticsConsent();
      clearPendingTermsConsent();
    };
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
        unparkHandshake();
        Analytics.signupFailed(provider, 'OAUTH_INIT_FAILED');
        setFormError(failureMessage);
      }
    } catch {
      unparkHandshake();
      Analytics.signupFailed(provider, 'OAUTH_INIT_FAILED');
      setFormError(failureMessage);
    }
  };

  const handleOAuth = useGuardedSubmit(startOAuth);

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

        {/* OPTIONAL analytics consent — the consent moment this app never had.
            Same control mechanics as the Terms checkbox above (visually-hidden
            native <input> inside a <label> wrapping icon + sentence, so the
            whole row is a 44px target and Space toggles it), with three
            deliberate differences:

            1. It gates NOTHING. Submit and the OAuth buttons stay bound to
               `termsAccepted` alone — analytics must never be a condition of
               signing up.
            2. No `aria-required`, so assistive tech does not announce it as
               something that must be answered to proceed.
            3. Declining is at least as easy as accepting: accepting costs one
               click, declining costs none — and BOTH are written down when the
               signup completes, which is what finally makes "declined"
               distinguishable from "never asked".

            The full disclosure sits in an always-visible paragraph rather than
            behind a "what's shared?" disclosure: material terms of a consent
            should not be the part you have to go looking for. It is wired with
            `aria-describedby` so a screen reader reads it with the control. */}
        <div className="flex flex-col gap-2">
          <label
            htmlFor="analyticsAccepted"
            className="flex min-h-[44px] cursor-pointer items-start gap-3"
          >
            <input
              type="checkbox"
              id="analyticsAccepted"
              checked={analyticsAccepted}
              onChange={(event) => setAnalyticsAccepted(event.target.checked)}
              aria-describedby="analyticsConsentDetail"
              className="peer sr-only"
            />
            <Icon
              name={analyticsAccepted ? 'checkbox' : 'square-outline'}
              size="chrome"
              className={`mt-0.5 shrink-0 rounded-sm peer-focus-visible:ring-2 peer-focus-visible:ring-moss peer-focus-visible:ring-offset-2 ${
                analyticsAccepted ? 'text-moss-deep' : 'text-ink-3'
              }`}
            />
            <span className="text-sm leading-snug text-ink-2">
              {t('signup.analytics.label')}
            </span>
          </label>
          <p id="analyticsConsentDetail" className="m-0 pl-8 text-xs leading-relaxed text-ink-3">
            {t('signup.analytics.detail')}
          </p>
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
