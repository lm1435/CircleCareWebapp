import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { authApi } from '@/api/auth';
import { useAuthStore } from '@/store/authStore';
import { peekPendingInviteCode } from '@/lib/pendingInviteCode';
import { Analytics } from '@/lib/analytics';
import { isRateLimitError } from '@/lib/apiErrors';
import { useGuardedSubmit } from '@/hooks/useGuardedSubmit';
import { Button, Card, Text, TextField } from '@/components/ui';
import { AuthShell } from '@/components/auth/AuthShell';
import { AuthTopBar } from '@/components/auth/AuthTopBar';
import { AuthHeader } from '@/components/auth/AuthHeader';
import { OtpInput, type OtpInputHandle } from '@/components/auth/OtpInput';
import { useAuthBack } from '@/components/auth/useAuthBack';

// Task 8c — email verification with a 6-digit OTP.
// Six-box code input (auto-advance, paste-aware, autocomplete="one-time-code")
// mirroring mobile. On success the body-mode session returned by verify-otp is
// immediately exchanged via /auth/oauth-session for an httpOnly cookie session
// (auto sign-in); the refresh token is discarded, never stored.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_COOLDOWN_SECONDS = 60;
const OTP_LENGTH = 6;

interface VerifyEmailState {
  email?: string;
  /** set by LoginPage on EMAIL_NOT_VERIFIED — shows the "we sent a new code" notice */
  notVerified?: boolean;
}

export default function VerifyEmailPage(): ReactElement {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const location = useLocation();
  const signIn = useAuthStore((state) => state.signIn);
  // /login is always a sensible fallback here, so the back button always
  // renders — history(-1) when there's somewhere to go back to, '/login'
  // when this is history entry 0.
  const { goBack } = useAuthBack('/login');

  const routerState = (location.state as VerifyEmailState | null) ?? undefined;
  const stateEmail = routerState?.email?.trim() ?? '';
  const hasStateEmail = stateEmail.length > 0;

  const [email, setEmail] = useState(stateEmail);
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(
    routerState?.notVerified ? t('verifyOtp.notVerifiedNotice') : null
  );
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const emailRef = useRef<HTMLInputElement>(null);
  const otpRef = useRef<OtpInputHandle>(null);
  const submittedRef = useRef(false);
  const otpErrorId = 'verify-otp-error';

  // Resend cooldown countdown
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => {
      setCooldown((current) => (current > 1 ? current - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  const validateEmail = (): string | null => {
    const trimmed = email.trim();
    if (!trimmed) return t('validation.emailRequired');
    if (!EMAIL_RE.test(trimmed)) return t('validation.emailInvalid');
    return null;
  };

  const verify = async (code: string): Promise<void> => {
    if (isVerifying || submittedRef.current) return;
    setError(null);
    setNotice(null);

    const emailError = validateEmail();
    if (emailError) {
      setError(emailError);
      emailRef.current?.focus();
      return;
    }
    if (code.length !== OTP_LENGTH) {
      setError(t('verifyOtp.errors.incompleteCode'));
      otpRef.current?.focus();
      return;
    }

    submittedRef.current = true;
    setIsVerifying(true);
    try {
      const response = await authApi.verifyOtp({ email: email.trim(), otp: code });
      const { session, user } = response.data;
      Analytics.otpVerified();
      try {
        // verify-otp responds in body mode — exchange for a cookie session and
        // discard the refresh token (never stored client-side).
        const exchanged = await authApi.oauthSession({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        });
        signIn(exchanged.data.session, exchanged.data.user ?? user);
        // An invite handoff parks its code in sessionStorage (router state is
        // lost across login → signup → verify-email) — detour through the
        // invite page. PEEK, don't consume: InviteLandingPage's own effect
        // does the consume-and-auto-accept, so clearing it here would strand
        // the visitor on a card they have to tap "Accept" on manually.
        const pendingInvite = peekPendingInviteCode();
        navigate(pendingInvite ? `/invite/${pendingInvite}` : '/circles', { replace: true });
      } catch {
        // Verified, but the cookie session couldn't be established —
        // a normal login will work now. Tell LoginPage so it can say so
        // instead of dropping the user on a silent sign-in form.
        navigate('/login', { replace: true, state: { emailVerified: true } });
      }
    } catch (err) {
      // A 429 says wait — "tap Resend" would spend the same limiter bucket.
      setError(isRateLimitError(err) ? t('rateLimited') : t('verifyOtp.errors.invalidCode'));
      Analytics.otpFailed();
      submittedRef.current = false;
    } finally {
      setIsVerifying(false);
    }
  };

  const handleOtpChange = (value: string): void => {
    const digits = value.replace(/\D/g, '').slice(0, OTP_LENGTH);
    setOtp(digits);
    // Auto-submit when the code is complete and the email is already known.
    if (digits.length === OTP_LENGTH && hasStateEmail) {
      void verify(digits);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void verify(otp);
  };

  // `isResending` and `cooldown` are both STATE, so neither can reject a
  // second click dispatched before React commits the first one's render (see
  // `useGuardedSubmit`) — the ref wrapper below is what does. /auth/resend-otp
  // sits on the 10-per-15-minutes `otpRateLimit` bucket and mails a real code
  // that invalidates the previous one, so a double fire both spends a limiter
  // slot and can leave the user typing a code that is already dead.
  //
  // `verify` above needs no wrapper: `submittedRef` is already a synchronous
  // ref checked on its first line, which is this same idiom.
  const resend = async (): Promise<void> => {
    if (cooldown > 0 || isResending) return;
    setError(null);
    setNotice(null);

    const emailError = validateEmail();
    if (emailError) {
      setError(emailError);
      emailRef.current?.focus();
      return;
    }

    setIsResending(true);
    try {
      await authApi.resendOtp({ email: email.trim() });
      setNotice(t('verifyOtp.codeSentMessage'));
      setCooldown(RESEND_COOLDOWN_SECONDS);
      Analytics.otpResent();
    } catch (err) {
      setError(isRateLimitError(err) ? t('rateLimited') : t('verifyOtp.errors.resendFailed'));
    } finally {
      setIsResending(false);
    }
  };

  const handleResend = useGuardedSubmit(resend);

  return (
    <AuthShell>
      <AuthTopBar onBack={goBack} />
      <AuthHeader
        title={t('verifyOtp.title')}
        subtitle={
          hasStateEmail
            ? t('verifyOtp.subtitle', { email: stateEmail })
            : t('verifyOtp.subtitleNoEmail')
        }
      />

      {notice ? (
        <div role="status" className="mb-4">
          <Card variant="filled" padding="sm">
            <Text variant="caption" className="text-ink-2">
              {notice}
            </Text>
          </Card>
        </div>
      ) : null}
      {error ? (
        <div id="verify-otp-error" role="alert" className="mb-4">
          <Card variant="filled" padding="sm">
            <Text variant="caption" className="text-terracotta-deep!">
              {error}
            </Text>
          </Card>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        {!hasStateEmail ? (
          <TextField
            ref={emailRef}
            id="verify-email"
            name="email"
            type="email"
            label={t('verifyOtp.emailLabel')}
            placeholder={t('verifyOtp.emailPlaceholder')}
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        ) : null}

        <div className="flex flex-col gap-1.5">
          <Text variant="label" as="span" id="verify-otp-label">
            {t('verifyOtp.codeLabel')}
          </Text>
          <OtpInput
            ref={otpRef}
            length={OTP_LENGTH}
            value={otp}
            onChange={handleOtpChange}
            label={t('verifyOtp.codeLabel')}
            error={error ?? undefined}
            errorId={otpErrorId}
            disabled={isVerifying}
            autoFocus={hasStateEmail}
          />
        </div>

        <Button type="submit" variant="primary" size="lg" fullWidth loading={isVerifying}>
          {isVerifying ? t('verifyOtp.verifying') : t('verifyOtp.verifyButton')}
        </Button>
      </form>

      <p className="m-0 mt-6 text-center text-sm text-ink-3">
        {t('verifyOtp.didntReceive')}{' '}
        <button
          type="button"
          onClick={() => void handleResend()}
          disabled={cooldown > 0 || isResending}
          className="inline-flex min-h-[44px] cursor-pointer items-center border-0 bg-transparent p-0 text-sm font-semibold text-moss disabled:cursor-not-allowed disabled:text-ink-3"
        >
          {cooldown > 0
            ? t('verifyOtp.resendIn', { seconds: cooldown })
            : t('verifyOtp.resendCode')}
        </button>
      </p>
    </AuthShell>
  );
}
