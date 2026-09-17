import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { authApi } from '@/api/auth';
import { Analytics } from '@/lib/analytics';
import { isRateLimitError } from '@/lib/apiErrors';
import { useGuardedSubmit } from '@/hooks/useGuardedSubmit';
import { Button, Card, Text, TextField } from '@/components/ui';
import { AuthShell } from '@/components/auth/AuthShell';
import { AuthTopBar } from '@/components/auth/AuthTopBar';
import { AuthHeader } from '@/components/auth/AuthHeader';
import { TerminalState } from '@/components/auth/TerminalState';

// Task 8d (part 1) — request a password-reset OTP.
// The backend ALWAYS returns success (no account enumeration), so the success
// message is neutral and identical regardless of whether the account exists.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ForgotPasswordPage(): ReactElement {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [isResending, setIsResending] = useState(false);

  const emailRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  // Move focus to the inline error when it appears (mirrors LoginPage).
  useEffect(() => {
    if (formError) errorRef.current?.focus();
  }, [formError]);

  const sendResetCode = async (): Promise<boolean> => {
    try {
      await authApi.forgotPassword({ email: email.trim() });
      return true;
    } catch (err) {
      // Only transport/server errors land here — the endpoint never reveals
      // whether the account exists. A 429 says wait, not "try again".
      setFormError(
        isRateLimitError(err) ? t('rateLimited') : t('forgotPassword.errors.sendFailed')
      );
      return false;
    } finally {
      // Fired once regardless of outcome — the endpoint (and this page) never
      // reveal whether the account exists, so the event can't distinguish
      // "sent" from "account not found" either.
      Analytics.passwordResetRequested();
    }
  };

  // `isSending` / `isResending` are the LOADING states, not the guards: React
  // commits them a render too late to stop a second submit dispatched in the
  // same tick (see `useGuardedSubmit`). Both handlers below hit
  // /auth/forgot-password, which sits on the 5-per-5-minutes `authRateLimit`
  // bucket AND sends a real email, so a double fire costs a limiter slot and
  // mails a second code that invalidates the first.
  const sendResetCodeForm = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setFormError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setFieldError(t('validation.emailRequired'));
      emailRef.current?.focus();
      return;
    }
    if (!EMAIL_RE.test(trimmedEmail)) {
      setFieldError(t('validation.emailInvalid'));
      emailRef.current?.focus();
      return;
    }
    setFieldError(undefined);

    setIsSending(true);
    const ok = await sendResetCode();
    setIsSending(false);
    if (ok) setSent(true);
  };

  const handleSubmit = useGuardedSubmit(sendResetCodeForm);

  const resend = async (): Promise<void> => {
    setIsResending(true);
    await sendResetCode();
    setIsResending(false);
  };

  // A SEPARATE guard from the form's: the two live on different views (the
  // form vs. the "check your email" terminal state), so they can never be in
  // flight at the same time and must not block each other.
  const handleResend = useGuardedSubmit(resend);

  if (sent) {
    return (
      <AuthShell>
        <AuthTopBar
          onBack={() => {
            // Back to the form — a stale send/resend failure from the sent
            // view must never resurface once the user is looking at the form.
            setFormError(null);
            setSent(false);
          }}
        />
        <TerminalState
          icon="mail-outline"
          title={t('forgotPassword.checkEmail')}
          body={
            <>
              {t('forgotPassword.resetLinkSent', { email: email.trim() })}{' '}
              {t('forgotPassword.checkSpam')}
            </>
          }
        >
          {formError ? (
            <div ref={errorRef} role="alert" tabIndex={-1} className="mb-4">
              <Card variant="filled" padding="sm">
                <Text variant="caption" className="text-terracotta-deep!">
                  {formError}
                </Text>
              </Card>
            </div>
          ) : null}
          <Button
            type="button"
            variant="primary"
            size="lg"
            fullWidth
            onClick={() => navigate('/reset-password', { state: { email: email.trim() } })}
          >
            {t('forgotPassword.enterResetCode')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="lg"
            fullWidth
            loading={isResending}
            onClick={() => void handleResend()}
          >
            {t('forgotPassword.resendCode')}
          </Button>
          <Link
            to="/login"
            className="inline-flex min-h-[44px] items-center justify-center text-sm font-semibold text-moss"
          >
            {t('forgotPassword.backToLogin')}
          </Link>
        </TerminalState>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <AuthTopBar onBack={() => navigate('/login')} />
      <AuthHeader title={t('forgotPassword.title')} subtitle={t('forgotPassword.subtitle')} />

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
          id="forgot-email"
          name="email"
          type="email"
          label={t('forgotPassword.emailLabel')}
          placeholder={t('forgotPassword.emailPlaceholder')}
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={fieldError}
        />

        <Button type="submit" variant="primary" size="lg" fullWidth loading={isSending}>
          {isSending ? t('forgotPassword.sending') : t('forgotPassword.sendResetLink')}
        </Button>
      </form>

      <p className="m-0 mt-6 text-center">
        <Link to="/login" className="inline-flex min-h-[44px] items-center text-sm font-semibold text-moss">
          {t('forgotPassword.backToLogin')}
        </Link>
      </p>
    </AuthShell>
  );
}
