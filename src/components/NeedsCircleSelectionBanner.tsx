import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui';
import { useSubscriptionStatus } from '@/hooks/useSubscriptionStatus';
import { CircleSelectionModal } from '@/components/CircleSelectionModal';

/**
 * Persistent, dismissal-free banner shown when GET /subscription-status returns
 * `needsCircleSelection: true` (owner downgraded with 2+ circles and hasn't
 * picked which one to keep). The web now implements the selection flow itself —
 * the "Choose circle" button opens {@link CircleSelectionModal} — so web-only
 * users are no longer sent to the mobile app.
 */
export function NeedsCircleSelectionBanner(): ReactElement | null {
  const { t } = useTranslation('freemium');
  const { data } = useSubscriptionStatus();
  const [open, setOpen] = useState(false);

  if (!data?.needsCircleSelection) return null;

  return (
    <>
      <div
        role="status"
        className="flex flex-wrap items-center justify-between gap-3 border-b border-terracotta/40 bg-terracotta/10 px-4 py-3 text-sm text-terracotta-deep"
      >
        <span>{t('circleSelection.banner')}</span>
        <Button variant="terracotta" size="sm" onClick={() => setOpen(true)}>
          {t('circleSelection.choose')}
        </Button>
      </div>
      {open && <CircleSelectionModal onClose={() => setOpen(false)} />}
    </>
  );
}
