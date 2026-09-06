import { useRef, useState, type FormEvent, type ReactElement } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { authApi } from '@/api/auth';
import { Analytics } from '@/lib/analytics';
import { utf8ByteLength } from '@/lib/utf8ByteLength';
import { Button, Card, Text, TextField } from '@/components/ui';
import { AuthShell } from '@/components/auth/AuthShell';
import { AuthTopBar } from '@/components/auth/AuthTopBar';
import { AuthHeader } from '@/components/auth/AuthHeader';
import { TerminalState } from '@/components/auth/TerminalState';
import { OtpInput, type OtpInputHandle } from '@/components/auth/OtpInput';
import { PasswordRequirements } from '@/components/auth/PasswordRequirements';

// Task 8d (part 2) — reset password with the emailed 6-digit recovery OTP.
// Backend contract: POST /auth/reset-password { email, otp, new_password }.
// It does NOT sign the user in — success routes back to /login.
// Mirrors mobile's ResetPasswordScreen flow: email arrives via router state
// from ForgotPasswordPage (NEVER via query params); without it we show the
// "request a new code" recovery state, exactly like mobile.

const OTP_LENGTH = 6;

interface FieldErrors {
  otp?: string;
  password?: string;
  confirmPassword?: string;
}

export default function ResetPasswordPage(): ReactElement {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const location = useLocation();

  const email = ((location.state as { email?: string } | null)?.email ?? '').trim();

  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState(false);
  const [succeeded, setSucceeded] = useState(false);

  const otpRef = useRef<OtpInputHandle>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);

  // Matches backend's Zod password policy (backend/src/routes/auth.ts), plus
  // the 72-UTF-8-byte max GoTrue/bcrypt actually enforces (see
  // mobile/src/screens/auth/authValidation.ts's `passwordSchema`: bcrypt
  // counts BYTES, not JS characters, so a 72-character accented password can
  // already be over the server's limit — hence the byte check below in
  // addition to the plain-length fast path).
  const validatePassword = (value: string): string | undefined => {
    if (value.length < 8) return t('validation.passwordMinLength');
    if (value.length > 72) return t('validation.passwordMaxLength');
    if (!/[A-Z]/.test(value)) return t('validation.passwordUppercase');
    if (!/[a-z]/.test(value)) return t('validation.passwordLowercase');
    if (!/[0-9]/.test(value)) return t('validation.passwordNumber');
    if (!/[^A-Za-z0-9]/.test(value)) return t('validation.passwordSpecial');
    if (utf8ByteLength(value) > 72) return t('validation.passwordMaxLength');
    return undefined;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setFormError(null);

    const errors: FieldErrors = {};
    if (otp.length !== OTP_LENGTH) {
      errors.otp = t('verifyOtp.errors.incompleteCode');
    }
    if (!password) {
      errors.password = t('validation.passwordRequired');
    } else {
      errors.password = validatePassword(password);
    }
    if (!confirmPassword) {
      errors.confirmPassword = t('validation.confirmPasswordRequired');
    } else if (confirmPassword !== password) {
      errors.confirmPassword = t('validation.passwordsDoNotMatch');
    }
    setFieldErrors(errors);
    if (errors.otp) {
      otpRef.current?.focus();
      return;
    }
    if (errors.password) {
      passwordRef.current?.focus();
      return;
    }
    if (errors.confirmPassword) {
      confirmPasswordRef.current?.focus();
      return;
    }

    setIsResetting(true);
    try {
      await authApi.resetPassword({ email, otp, new_password: password });
      setSucceeded(true);
      Analytics.passwordResetCompleted();
    } catch {
      // INVALID_CODE / RESET_FAILED — same calm guidance either way.
      setFormError(t('resetPassword.errors.resetFailed'));
      Analytics.passwordResetFailed();
    } finally {
      setIsResetting(false);
    }
  };

  // Arrived without an email in router state (deep link, refresh) — mirror
  // mobile: explain and send them back to request a new code.
  if (!email) {
    return (
      <AuthShell>
        <AuthTopBar onBack={() => navigate('/forgot-password')} />
        <TerminalState
          icon="alert-circle-outline"
          title={t('resetPassword.errorTitle')}
          body={t('resetPassword.errorMessage')}
        >
          <Button
            type="button"
            variant="primary"
            size="lg"
            fullWidth
            onClick={() => navigate('/forgot-password')}
          >
            {t('resetPassword.requestNewCode')}
          </Button>
        </TerminalState>
      </AuthShell>
    );
  }

  if (succeeded) {
    return (
      <AuthShell>
        <AuthTopBar />
        <TerminalState
          icon="checkmark"
          title={t('resetPassword.successTitle')}
          body={<span role="status">{t('resetPassword.success')}</span>}
        >
          <Button
            type="button"
            variant="primary"
            size="lg"
            fullWidth
            onClick={() => navigate('/login', { replace: true })}
          >
            {t('resetPassword.signInNow')}
          </Button>
        </TerminalState>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <AuthTopBar onBack={() => navigate('/forgot-password')} />
      <AuthHeader
        title={t('resetPassword.title')}
        subtitle={t('resetPassword.codeSubtitle', { email })}
      />

      {formError ? (
        <div role="alert" className="mb-4">
          <Card variant="filled" padding="sm">
            <Text variant="caption" className="text-terracotta-deep!">
              {formError}
            </Text>
          </Card>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Text variant="label" as="span">
            {t('resetPassword.resetCode')}
          </Text>
          <OtpInput
            ref={otpRef}
            length={OTP_LENGTH}
            value={otp}
            onChange={setOtp}
            label={t('resetPassword.resetCode')}
            error={fieldErrors.otp}
            errorId="reset-otp-error"
          />
          {fieldErrors.otp ? (
            <p id="reset-otp-error" role="alert" className="m-0 text-sm text-terracotta-deep">
              {fieldErrors.otp}
            </p>
          ) : null}
        </div>

        <TextField
          ref={passwordRef}
          id="reset-password"
          name="newPassword"
          type="password"
          showToggle
          toggleLabels={{ show: t('login.showPassword'), hide: t('login.hidePassword') }}
          label={t('resetPassword.newPasswordLabel')}
          placeholder={t('resetPassword.newPasswordPlaceholder')}
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={fieldErrors.password}
        />

        <PasswordRequirements value={password} />

        <TextField
          ref={confirmPasswordRef}
          id="reset-confirm-password"
          name="confirmPassword"
          type="password"
          showToggle
          toggleLabels={{ show: t('login.showPassword'), hide: t('login.hidePassword') }}
          label={t('resetPassword.confirmPasswordLabel')}
          placeholder={t('resetPassword.confirmPasswordPlaceholder')}
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          error={fieldErrors.confirmPassword}
        />

        <Button type="submit" variant="primary" size="lg" fullWidth loading={isResetting}>
          {isResetting ? t('resetPassword.resetting') : t('resetPassword.resetButton')}
        </Button>
      </form>

      <p className="m-0 mt-6 text-center">
        <Link
          to="/forgot-password"
          className="inline-flex min-h-[44px] items-center text-sm font-semibold text-moss"
        >
          {t('resetPassword.requestNewCode')}
        </Link>
      </p>
      <p className="m-0 mt-4 text-center">
        <Link to="/login" className="inline-flex min-h-[44px] items-center text-sm font-semibold text-moss">
          {t('resetPassword.backToLogin')}
        </Link>
      </p>
    </AuthShell>
  );
}
