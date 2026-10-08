import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { DailyUpdateData } from '@/api/dailyUpdate';
import { Eyebrow, Icon, Text } from '@/components/ui';
import { DailyUpdateSections } from './DailyUpdateSections';
import {
  DAILY_UPDATE_ENTER,
  DAILY_UPDATE_HAIRLINE,
  DAILY_UPDATE_LINK,
  DAILY_UPDATE_QUIET,
  DAILY_UPDATE_SURFACE,
} from './surface';

export interface DailyUpdateCardViewProps {
  data: DailyUpdateData;
  /** `id` of the heading, for the region's `aria-labelledby`. */
  headingId: string;
  /** `/circles/:id/daily-update` */
  openTo: string;
  /** `/circles/:id/members` — rendered only for a solo owner (D10). */
  inviteTo: string | null;
  onDismiss: () => void;
  onInvite?: () => void;
  onTurnOff: () => void;
  turnOffDisabled?: boolean;
  /** Skip the entrance (the harness takes still screenshots). */
  animate?: boolean;
}

/**
 * The Home card, drawn (docs/plans/daily-update.md "Design (Fable)").
 *
 * Pure presentation: `DailyUpdateCard` decides WHETHER it shows and wires
 * the preferences, storage and analytics; this draws it. Split so the e2e
 * harness can mount the exact production markup on fixture data.
 *
 * Reading order: eyebrow → heading → dismiss → "Today so far" → "Still to do"
 * → See the full update → (Invite someone) → Turn off. The X is the only
 * icon on the card and it is a labelled 44px button; every row is plain text.
 */
export function DailyUpdateCardView({
  data,
  headingId,
  openTo,
  inviteTo,
  onDismiss,
  onInvite,
  onTurnOff,
  turnOffDisabled = false,
  animate = true,
}: DailyUpdateCardViewProps): ReactElement {
  const { t } = useTranslation('dailyUpdate');
  const name = data.recipient_name?.trim();
  const heading = name ? t('heading', { name }) : t('headingSelfFallback');

  return (
    <section
      aria-labelledby={headingId}
      data-testid="daily-update-card"
      className={`${DAILY_UPDATE_SURFACE} px-5 py-5 ${animate ? DAILY_UPDATE_ENTER : ''}`}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <Eyebrow color="moss" deep dot>
            {t('eyebrow')}
          </Eyebrow>
          <Text variant="h2" id={headingId} className="mt-1">
            {heading}
          </Text>
        </div>
        <button
          type="button"
          aria-label={t('dismissA11y')}
          onClick={onDismiss}
          className="-mr-2 -mt-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-2 transition-colors duration-fast hover:bg-moss-soft hover:text-ink"
        >
          <Icon name="close-outline" size="chrome" />
        </button>
      </div>

      <div className="mt-5">
        <DailyUpdateSections data={data} past={false} headingLevel="h3" />
      </div>

      <div
        className={`mt-4 flex flex-wrap items-center gap-x-5 border-t ${DAILY_UPDATE_HAIRLINE} pt-2`}
      >
        <Link to={openTo} state={{ dailyUpdateSource: 'card' }} className={DAILY_UPDATE_LINK}>
          {t('open')}
        </Link>
        {inviteTo ? (
          <Link to={inviteTo} onClick={onInvite} className={DAILY_UPDATE_LINK}>
            {t('soloInvite')}
          </Link>
        ) : null}
        <button
          type="button"
          onClick={onTurnOff}
          disabled={turnOffDisabled}
          className={DAILY_UPDATE_QUIET}
        >
          {t('turnOff')}
        </button>
      </div>
    </section>
  );
}
