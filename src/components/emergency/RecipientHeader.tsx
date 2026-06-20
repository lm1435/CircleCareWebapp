import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar, Card } from '@/components/ui';

// Care recipient header card shown at the top of Emergency, mirroring mobile
// (mobile/src/screens/emergency/EmergencyInfoScreen.tsx "Care recipient"
// section): Avatar + name + DOB + key conditions.
//
// PHI: name/DOB/conditions are rendered for the reader only — never logged,
// never attached to analytics.

/**
 * Format a date-only `YYYY-MM-DD` string for display. Uses `T12:00:00Z` +
 * `timeZone: 'UTC'` to avoid a timezone date-shift (mobile uses the same
 * pattern in formatDateString). Returns null for blank/malformed input.
 */
function formatDob(dob: string, locale: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}/.test(dob)) return null;
  const d = new Date(`${dob.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

export interface RecipientHeaderProps {
  name: string;
  photoUrl?: string | null;
  /** Date-only `YYYY-MM-DD` string, or null when not on file. */
  dob?: string | null;
  /**
   * Recipient conditions. The backend sends an array of strings
   * (recipient_conditions = z.array(z.string())); we also tolerate a plain
   * string defensively so a shape change can never crash the emergency sheet.
   */
  conditions?: string[] | string | null;
}

/** Normalize conditions (array | string | nullish) to a single display line. */
function formatConditions(conditions: string[] | string | null | undefined): string | null {
  const parts = Array.isArray(conditions) ? conditions : conditions ? [conditions] : [];
  const text = parts
    .map((c) => (typeof c === 'string' ? c.trim() : ''))
    .filter(Boolean)
    .join(', ');
  return text || null;
}

/**
 * Care recipient header card: who this emergency sheet is about. Prints
 * cleanly with the rest of the content (uses the shared `print-card` rules).
 */
export function RecipientHeader({
  name,
  photoUrl,
  dob,
  conditions,
}: RecipientHeaderProps): ReactElement {
  const { t, i18n } = useTranslation('emergency');
  const dobLabel = dob ? formatDob(dob, i18n.language) : null;
  const conditionsText = formatConditions(conditions);

  return (
    <Card className="print-card flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <Avatar name={name} photoUrl={photoUrl} size="lg" />
        <div className="min-w-0">
          <h2 className="serif m-0 text-2xl text-ink">{name}</h2>
          {dobLabel && (
            <p className="m-0 mt-1">
              <span className="mono">{t('recipient.dob')}</span>{' '}
              <span className="text-ink-2">{dobLabel}</span>
            </p>
          )}
        </div>
      </div>
      {conditionsText && (
        <div className="border-t border-line pt-4">
          <dl className="m-0">
            <dt className="mono mb-1">{t('recipient.conditions')}</dt>
            <dd className="m-0 text-base leading-relaxed text-ink">{conditionsText}</dd>
          </dl>
        </div>
      )}
    </Card>
  );
}
