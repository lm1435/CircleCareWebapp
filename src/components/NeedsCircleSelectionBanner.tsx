import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card } from '@/components/ui';
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
      <Card
        variant="filled"
        padding="sm"
        role="status"
        className="bg-coral-soft! flex flex-wrap items-center justify-between gap-3"
      >
        {/* Same shape as mobile (2026-11-25): a short title, one line of what to do, then the button. */}
        <div className="min-w-0 flex-1 basis-64">
          <p className="font-semibold text-coral-deep">{t('circleSelection.bannerTitle')}</p>
          <p className="text-sm text-ink-2">{t('circleSelection.bannerBody')}</p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
          {t('circleSelection.choose')}
        </Button>
      </Card>
      {open && <CircleSelectionModal onClose={() => setOpen(false)} />}
    </>
  );
}
