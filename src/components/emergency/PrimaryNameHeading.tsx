import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Text } from '@/components/ui';

export interface PrimaryNameHeadingProps {
  name: string;
  isPrimary?: boolean;
}

/**
 * A contact / doctor / insurance card's name, with the soft moss "Primary" pill mobile uses
 * (EmergencyInfoScreen `primaryPill`: moss-soft ground, moss text). Moss, never the error red: a
 * routine "this is the primary one" fact must not read as an alert (owner 2026-11-08).
 *
 * A screen reader hears "<name>, Primary" as ONE heading (mobile's `RowHeading` label); the visible
 * pill is decorative to it so the word is not read twice.
 */
export function PrimaryNameHeading({ name, isPrimary }: PrimaryNameHeadingProps): ReactElement {
  const { t } = useTranslation('emergency');
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <Text variant="h3" as="h3" className="min-w-0 break-words">
        {name}
        {isPrimary ? <span className="sr-only">, {t('primary')}</span> : null}
      </Text>
      {isPrimary ? (
        <Badge variant="primary" aria-hidden="true" data-testid="primary-pill">
          {t('primary')}
        </Badge>
      ) : null}
    </div>
  );
}
