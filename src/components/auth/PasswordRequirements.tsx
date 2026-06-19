import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

export interface PasswordRequirementsProps {
  /** The current password value. */
  value: string;
}

/** The five rules, matching mobile + the backend Zod policy exactly. */
export const passwordRules = [
  { key: 'minLength', test: (v: string): boolean => v.length >= 8 },
  { key: 'uppercase', test: (v: string): boolean => /[A-Z]/.test(v) },
  { key: 'lowercase', test: (v: string): boolean => /[a-z]/.test(v) },
  { key: 'number', test: (v: string): boolean => /[0-9]/.test(v) },
  { key: 'special', test: (v: string): boolean => /[^A-Za-z0-9]/.test(v) },
] as const;

function CheckIcon(): ReactElement {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <circle cx="8" cy="8" r="8" className="fill-moss" />
      <path
        d="M4.5 8.2l2.2 2.2 4.8-4.8"
        stroke="white"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EmptyCircleIcon(): ReactElement {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <circle cx="8" cy="8" r="7.25" className="stroke-line" strokeWidth="1.5" />
    </svg>
  );
}

/**
 * Live password-requirement checklist mirroring mobile's PasswordRequirement
 * card: each rule shows an empty circle → filled moss checkmark as the typed
 * password satisfies it. The list is wrapped in a polite live region so screen
 * readers announce rules being met, and each item conveys met/unmet state via
 * its accessible label (not color alone).
 */
export function PasswordRequirements({ value }: PasswordRequirementsProps): ReactElement {
  const { t } = useTranslation('auth');

  return (
    <div className="rounded-xl bg-bg-2 p-3">
      <p className="m-0 mb-2 text-sm font-medium text-ink-2">
        {t('resetPassword.requirements.title')}
      </p>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0" aria-live="polite">
        {passwordRules.map((rule) => {
          const met = rule.test(value);
          const label = t(`resetPassword.requirements.${rule.key}`);
          return (
            <li
              key={rule.key}
              className={`flex items-center gap-2 text-sm ${met ? 'text-moss-deep' : 'text-ink-3'}`}
            >
              {met ? <CheckIcon /> : <EmptyCircleIcon />}
              <span>{label}</span>
              <span className="sr-only">{met ? t('resetPassword.requirements.met') : t('resetPassword.requirements.unmet')}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
