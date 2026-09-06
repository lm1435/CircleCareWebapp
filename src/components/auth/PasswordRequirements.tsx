import { useEffect, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Eyebrow, Icon } from '@/components/ui';

/** How long to wait for typing to pause before announcing the met count — long
 * enough that a screen reader isn't re-reading it on every keystroke, short
 * enough that it still reads as "live" feedback once typing stops. */
const ANNOUNCE_DEBOUNCE_MS = 500;

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

/**
 * Live password-requirement checklist mirroring mobile's PasswordRequirement
 * card: each rule shows an empty ring → filled moss checkmark as the typed
 * password satisfies it, and each item conveys met/unmet state via its
 * accessible label (not color alone).
 *
 * The count of rules met is announced through a single sr-only live region,
 * DEBOUNCED to `ANNOUNCE_DEBOUNCE_MS` after typing pauses — not
 * `aria-live="polite"` on the visible list itself. Five list items sharing one
 * live region means every keystroke re-announces all five (met AND unmet),
 * which is what the list used to do; a screen reader user typing a full
 * password heard the whole checklist repeated per character.
 */
export function PasswordRequirements({ value }: PasswordRequirementsProps): ReactElement {
  const { t } = useTranslation('auth');
  const metCount = passwordRules.filter((rule) => rule.test(value)).length;
  const [announcedCount, setAnnouncedCount] = useState(metCount);

  useEffect(() => {
    const timer = window.setTimeout(() => setAnnouncedCount(metCount), ANNOUNCE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [metCount]);

  return (
    <Card variant="filled" padding="sm">
      <Eyebrow as="p" className="mb-2">
        {t('resetPassword.requirements.title')}
      </Eyebrow>
      <p role="status" aria-live="polite" className="sr-only">
        {t('resetPassword.requirements.metCount', {
          count: announcedCount,
          total: passwordRules.length,
        })}
      </p>
      <ul className="m-0 grid grid-cols-2 gap-2 p-0">
        {passwordRules.map((rule) => {
          const met = rule.test(value);
          const label = t(`resetPassword.requirements.${rule.key}`);
          return (
            <li
              key={rule.key}
              className={`flex items-center gap-2 text-sm ${met ? 'text-moss' : 'text-ink-3'}`}
            >
              {met ? (
                <Icon name="checkmark-circle" size="inline" className="text-moss" />
              ) : (
                <Icon name="ellipse-outline" size="inline" className="text-ink-3" />
              )}
              <span>{label}</span>
              <span className="sr-only">
                {met ? t('resetPassword.requirements.met') : t('resetPassword.requirements.unmet')}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
