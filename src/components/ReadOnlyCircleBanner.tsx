import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Card, Icon } from '@/components/ui';

/**
 * Banner shown when a circle is read-only (`read_only` from GET /circles —
 * owner on free tier with 2+ circles and this one not selected on downgrade).
 * Plan Task 38; mobile-parity Task 22 (spec §6.7). Owners additionally get an
 * "Upgrade" link to /upgrade so the banner offers a way out, not just a lock.
 */
export interface ReadOnlyCircleBannerProps {
  /** True when the current user owns the circle (circle.role === 'owner'). */
  isOwner: boolean;
  className?: string;
}

export function ReadOnlyCircleBanner({ isOwner, className }: ReadOnlyCircleBannerProps): ReactElement {
  const { t } = useTranslation('freemium');

  return (
    <Card
      variant="filled"
      padding="sm"
      role="status"
      className={['flex items-center gap-2', className].filter(Boolean).join(' ')}
    >
      <Icon name="lock-closed-outline" size="inline" className="shrink-0 text-ink-2" />
      <p className="m-0 text-sm text-ink-2">
        {isOwner ? t('readOnly.ownerBanner') : t('readOnly.memberBanner')}
      </p>
      {isOwner ? (
        <Button
          as={Link}
          to="/upgrade"
          // A lapsed owner going looking for the paywall — GENERAL, mobile's
          // bucket for "the user sought it out" rather than a limit they hit.
          state={{ paywallContext: 'general' }}
          variant="ghost"
          size="sm"
          className="ml-auto shrink-0"
        >
          {t('readOnly.ownerUpgradeCta')}
        </Button>
      ) : null}
    </Card>
  );
}
