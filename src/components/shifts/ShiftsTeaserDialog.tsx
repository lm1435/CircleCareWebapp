import { useEffect, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Avatar, Badge, Button, Card, Modal } from '@/components/ui';
import { Analytics } from '@/lib/analytics';

export interface ShiftsTeaserDialogProps {
  /** Where it was opened from (analytics enum). */
  source: 'toggle' | 'add_menu';
  onClose: () => void;
}

/**
 * Free circle, OWNER ONLY (owner decision 10-18). PREMIUM chip, the pitch, a
 * static decorative preview (filled / filled / open), "See Premium" (-> /upgrade
 * with paywall context 'shifts') and "Not now". There is no "ask the owner"
 * flow: nobody but the owner ever sees this.
 */
export function ShiftsTeaserDialog({ source, onClose }: ShiftsTeaserDialogProps): ReactElement {
  const { t } = useTranslation('shifts');
  const navigate = useNavigate();

  useEffect(() => {
    Analytics.shiftsTeaserShown({ source });
    // Once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = [
    { name: t('teaser.morning'), time: t('teaser.morningTime'), who: t('teaser.personA'), open: false },
    { name: t('teaser.afternoon'), time: t('teaser.afternoonTime'), who: t('teaser.personB'), open: false },
    { name: t('teaser.night'), time: t('teaser.nightTime'), who: '', open: true },
  ];

  return (
    <Modal
      size="sm"
      title={t('teaser.title')}
      closeLabel={t('close')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('teaser.notNow')}
          </Button>
          <Button
            onClick={() => {
              Analytics.shiftsTeaserCtaTapped();
              onClose();
              navigate('/upgrade', { state: { paywallContext: 'shifts' } });
            }}
          >
            {t('teaser.cta')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Badge variant="accent" className="self-start">
          {t('teaser.chip')}
        </Badge>
        <p className="m-0 text-base text-ink-2">{t('teaser.description')}</p>
        {/* Decorative rows (hidden from AT); one description says what they show. */}
        <p className="sr-only">{t('teaser.previewA11y')}</p>
        <ul aria-hidden="true" className="m-0 flex list-none flex-col gap-2 p-0">
          {rows.map((row) => (
            <Card
              as="li"
              key={row.name}
              variant="outlined"
              padding="none"
              className={`flex items-center gap-3 rounded-lg p-3 ${
                row.open ? 'border-line!' : 'border-moss-line! bg-moss-soft!'
              }`}
            >
              {row.open ? (
                <span
                  // card-shell-ok: the empty avatar ring (a circle), not a card
                  className="inline-flex h-9 w-9 shrink-0 rounded-full border-[1.5px] border-line bg-bg"
                />
              ) : (
                <Avatar name={row.who} size="sm" />
              )}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-semibold text-ink">{row.name}</span>
                <span className="text-xs text-ink-2">{row.time}</span>
              </span>
              <span className="text-xs text-ink-2">{row.open ? t('open') : row.who}</span>
            </Card>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
