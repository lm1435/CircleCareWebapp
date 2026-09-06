import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Icon } from '@/components/ui';

/**
 * Banner shown when the current user's membership is view-only for a circle
 * (freemium caregiver cap — `view_only` from GET /circles). Plan Task 37;
 * mobile-parity Task 22 (spec §6.7). Copy matches mobile's ViewOnlyBanner
 * (`viewOnly.banner` / `bannerShort`).
 *
 * GET /circles does not return the owner's name, so callers without it get
 * the short copy (same as mobile's ViewOnlyBanner, which uses bannerShort).
 */
export interface ViewOnlyBannerProps {
  /** Circle owner's display name — enables the "Contact [owner]" long copy. */
  ownerName?: string;
  className?: string;
}

export function ViewOnlyBanner({ ownerName, className }: ViewOnlyBannerProps): ReactElement {
  const { t } = useTranslation('freemium');

  return (
    <Card
      variant="filled"
      padding="sm"
      role="status"
      className={['flex items-center gap-2', className].filter(Boolean).join(' ')}
    >
      <Icon name="eye-outline" size="inline" className="shrink-0 text-ink-2" />
      <p className="m-0 text-sm text-ink-2">
        {ownerName ? t('viewOnly.banner', { ownerName }) : t('viewOnly.bannerShort')}
      </p>
    </Card>
  );
}
