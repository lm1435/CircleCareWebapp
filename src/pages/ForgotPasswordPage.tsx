import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { authApi } from '@/api/auth';
import { Button } from '@/components/ui';
import { AuthShell } from '@/components/auth/AuthShell';
import { FormField } from '@/components/auth/FormField';

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

  const emailRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  // Move focus to the inline error when it appears (mirrors LoginPage).
  useEffect(() => {
    if (formError) errorRef.current?.focus();
  }, [formError]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
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
    try {
      await authApi.forgotPassword({ email: trimmedEmail });
      setSent(true);
    } catch {
      // Only transport/server errors land here — the endpoint never reveals
      // whether the account exists.
      setFormError(t('forgotPassword.errors.sendFailed'));
    } finally {
      setIsSending(false);
    }
  };

  if (sent) {
    return (
      <AuthShell
        title={t('forgotPassword.checkEmail')}
        subtitle={t('forgotPassword.resetLinkSent', { email: email.trim() })}
      >
        <p className="m-0 mb-6 text-sm text-ink-2">{t('forgotPassword.checkSpam')}</p>
        <Button
          type="button"
          variant="primary"
          className="w-full"
          onClick={() => navigate('/reset-password', { state: { email: email.trim() } })}
        >
          {t('forgotPassword.enterResetCode')}
        </Button>
        <p className="m-0 mt-4 text-center">
          <Link to="/login" className="text-sm font-medium text-terracotta-deep">
            {t('forgotPassword.backToLogin')}
          </Link>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t('forgotPassword.title')} subtitle={t('forgotPassword.subtitle')}>
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

        <Button type="submit" variant="primary" disabled={isSending} className="w-full">
          {isSending ? t('forgotPassword.sending') : t('forgotPassword.sendResetLink')}
        </Button>
      </form>

      <p className="m-0 mt-6 text-center">
        <Link to="/login" className="text-sm font-medium text-terracotta-deep">
          {t('forgotPassword.backToLogin')}
        </Link>
      </p>
    </AuthShell>
  );
}
