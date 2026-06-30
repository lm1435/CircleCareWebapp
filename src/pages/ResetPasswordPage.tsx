import { useRef, useState, type FormEvent, type ReactElement } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { authApi } from '@/api/auth';
import { Button } from '@/components/ui';
import { AuthShell } from '@/components/auth/AuthShell';
import { FormField } from '@/components/auth/FormField';
import { OtpInput } from '@/components/auth/OtpInput';
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

  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);

  // Matches backend's Zod password policy (backend/src/routes/auth.ts).
  const validatePassword = (value: string): string | undefined => {
    if (value.length < 8) return t('validation.passwordMinLength');
    if (!/[A-Z]/.test(value)) return t('validation.passwordUppercase');
    if (!/[a-z]/.test(value)) return t('validation.passwordLowercase');
    if (!/[0-9]/.test(value)) return t('validation.passwordNumber');
    if (!/[^A-Za-z0-9]/.test(value)) return t('validation.passwordSpecial');
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
    } catch {
      // INVALID_CODE / RESET_FAILED — same calm guidance either way.
      setFormError(t('resetPassword.errors.resetFailed'));
    } finally {
      setIsResetting(false);
    }
  };

  // Arrived without an email in router state (deep link, refresh) — mirror
  // mobile: explain and send them back to request a new code.
  if (!email) {
    return (
      <AuthShell title={t('resetPassword.errorTitle')}>
        <p className="m-0 mb-6 text-sm text-ink-2">{t('resetPassword.errorMessage')}</p>
        <Button
          type="button"
          variant="primary"
          className="w-full"
          onClick={() => navigate('/forgot-password')}
        >
          {t('resetPassword.requestNewCode')}
        </Button>
      </AuthShell>
    );
  }

  if (succeeded) {
    return (
      <AuthShell title={t('resetPassword.successTitle')}>
        <p role="status" className="m-0 mb-6 text-sm text-ink-2">
          {t('resetPassword.success')}
        </p>
        <Button
          type="button"
          variant="primary"
          className="w-full"
          onClick={() => navigate('/login', { replace: true })}
        >
          {t('resetPassword.backToLogin')}
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={t('resetPassword.title')}
      subtitle={t('resetPassword.codeSubtitle', { email })}
    >
      {formError ? (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-terracotta-deep/40 bg-bg-2 p-3 text-sm text-terracotta-deep"
        >
          {formError}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink-2">{t('resetPassword.resetCode')}</span>
          <OtpInput
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

        <FormField
          ref={passwordRef}
          id="reset-password"
          name="newPassword"
          type="password"
          label={t('resetPassword.newPasswordLabel')}
          placeholder={t('resetPassword.newPasswordPlaceholder')}
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={fieldErrors.password}
        />

        <PasswordRequirements value={password} />

        <FormField
          ref={confirmPasswordRef}
          id="reset-confirm-password"
          name="confirmPassword"
          type="password"
          label={t('resetPassword.confirmPasswordLabel')}
          placeholder={t('resetPassword.confirmPasswordPlaceholder')}
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          error={fieldErrors.confirmPassword}
        />

        <Button type="submit" variant="primary" disabled={isResetting} className="w-full">
          {isResetting ? t('resetPassword.resetting') : t('resetPassword.resetButton')}
        </Button>
      </form>
    </AuthShell>
  );
}
