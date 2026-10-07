import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { authApi } from '@/api/auth';
import { Analytics } from '@/lib/analytics';
import { isEmailRateLimitError, isRateLimitError } from '@/lib/apiErrors';
import { useGuardedSubmit } from '@/hooks/useGuardedSubmit';
import { Button, Card, Text, TextField } from '@/components/ui';
import { AuthShell } from '@/components/auth/AuthShell';
import { AuthTopBar } from '@/components/auth/AuthTopBar';
import { AuthHeader } from '@/components/auth/AuthHeader';
import { useAuthBack } from '@/components/auth/useAuthBack';

// "Have a verification code?" — the way back to an unentered email code for
// someone who signed up and never verified (mobile twin: VerifyRequestScreen).
//
// Asks for the address (prefilled from router state when Login had one), sends a
// fresh code through POST /auth/resend-otp, then hands off to /verify-email with
// the address in router STATE (never the query string).
//
// NO ACCOUNT ENUMERATION. /resend-otp answers 200 for an unknown address, a
// confirmed one and an unverified one alike, so this page cannot tell them apart
// and never tries: every non-error outcome moves on to the code page with the
// same neutral notice. The one distinct branch is Supabase's per-address send
// cooldown (EMAIL_RATE_LIMIT), only reachable for an address that was JUST sent
// a code — its copy ("we just sent one") says nothing the caller doesn't know.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function VerifyRequestPage(): ReactElement {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const location = useLocation();
  const { goBack } = useAuthBack('/login');

  const stateEmail = ((location.state as { email?: string } | null)?.email ?? '').trim();
  const [email, setEmail] = useState(stateEmail);
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  const emailRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  // Move focus to the inline error when it appears (mirrors ForgotPasswordPage).
  useEffect(() => {
    if (formError) errorRef.current?.focus();
  }, [formError]);

  // `isSending` is the LOADING state, not the guard (see `useGuardedSubmit`):
  // /auth/resend-otp mails a real code on the 10-per-15-minutes OTP bucket.
  const send = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setFormError(null);

    const trimmed = email.trim();
    if (!trimmed) {
      setFieldError(t('validation.emailRequired'));
      emailRef.current?.focus();
      return;
    }
    if (!EMAIL_RE.test(trimmed)) {
      setFieldError(t('validation.emailInvalid'));
      emailRef.current?.focus();
      return;
    }
    setFieldError(undefined);

    setIsSending(true);
    try {
      await authApi.resendOtp({ email: trimmed });
      Analytics.otpResent();
      navigate('/verify-email', { state: { email: trimmed, notice: 'sent' } });
    } catch (err) {
      if (isEmailRateLimitError(err)) {
        // A code was sent a moment ago: go enter it.
        navigate('/verify-email', { state: { email: trimmed, notice: 'rateLimited' } });
      } else {
        setFormError(
          isRateLimitError(err) ? t('rateLimited') : t('verifyRequest.errors.sendFailed')
        );
      }
    } finally {
      setIsSending(false);
    }
  };

  const handleSubmit = useGuardedSubmit(send);

  return (
    <AuthShell>
      <AuthTopBar onBack={goBack} />
      <AuthHeader title={t('verifyRequest.title')} subtitle={t('verifyRequest.subtitle')} />

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
          id="verify-request-email"
          name="email"
          type="email"
          label={t('verifyRequest.emailLabel')}
          placeholder={t('verifyRequest.emailPlaceholder')}
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={fieldError}
        />
        <Button type="submit" variant="primary" size="lg" fullWidth loading={isSending}>
          {isSending ? t('verifyRequest.sending') : t('verifyRequest.sendButton')}
        </Button>
      </form>
    </AuthShell>
  );
}
