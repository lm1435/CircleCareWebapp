import { useMemo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Eyebrow,
  Icon,
  Text,
  STATUS_PILL,
  careCardBadgeRow,
  careCardLeading,
  careCardListGap,
  careCardMeta,
  careCardMetaDetail,
  careCardShell,
  careCardTitle,
  careCardTopRow,
} from '@/components/ui';
import { useHourCycle } from '@/hooks/useHourCycle';
import { formatEventTimeCompact, getDeviceTimezone } from '@/utils/timezone';
import { PreviewAnnotation } from './PreviewAnnotation';

/**
 * "See how it works", step 1 — a sample day of doses for a sample recipient
 * (mobile `PreviewMedicationPage`). Pre-auth: no circle, no API, nothing to
 * mutate. The rows use the SAME care-card tokens, status pills and status
 * vocabulary as the real Today's medications card (`components/meds/TodaysMeds`),
 * which itself needs a circle and live queries and so cannot render here.
 *
 * Unlike mobile's page, the rows carry no Take/Skip buttons: the signup page's
 * interactive sample card was retired, and a button that writes nothing would be
 * a control that lies. The annotations say what the buttons would do.
 *
 * Times are FIXED (8 AM, noon, 8 PM) rather than relative to now, so the sample
 * reads the same whenever it is opened.
 */

type DemoStatus = 'taken' | 'unconfirmed' | 'upcoming';

interface DemoDose {
  id: string;
  name: string;
  dosage: string;
  time: string;
  status: DemoStatus;
}

const DOSES: DemoDose[] = [
  { id: 'demo-dose-taken', name: 'Metformin', dosage: '500 mg', time: '08:00:00', status: 'taken' },
  { id: 'demo-dose-due', name: 'Lisinopril', dosage: '10 mg', time: '12:00:00', status: 'unconfirmed' },
  { id: 'demo-dose-upcoming', name: 'Vitamin D', dosage: '1000 IU', time: '20:00:00', status: 'upcoming' },
];

const PILL: Record<DemoStatus, string> = {
  taken: STATUS_PILL.taken,
  unconfirmed: STATUS_PILL.overdue,
  upcoming: STATUS_PILL.upcoming,
};

export interface PreviewMedicationStepProps {
  /** id of the step's <h1>; the page focuses it when the step changes. */
  headingId: string;
}

export function PreviewMedicationStep({ headingId }: PreviewMedicationStepProps): ReactElement {
  const { t, i18n } = useTranslation(['auth', 'meds', 'calendar']);
  const hourCycle = useHourCycle();
  const timezone = getDeviceTimezone();

  const todayLabel = useMemo(
    () =>
      new Date().toLocaleDateString(i18n.language, {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
      }),
    [i18n.language]
  );

  const statusLabel = (status: DemoStatus): string =>
    status === 'taken'
      ? t('meds:status.taken')
      : status === 'unconfirmed'
        ? t('meds:status.unconfirmed')
        : t('calendar:upcoming');

  const renderDose = (dose: DemoDose): ReactElement => {
    const isTaken = dose.status === 'taken';
    return (
      <li key={dose.id} className={careCardShell} data-testid={dose.id}>
        <div className={careCardTopRow}>
          <span
            aria-hidden="true"
            className={`${careCardLeading} ${
              isTaken ? 'border-moss-deep bg-moss-deep text-cream' : 'border-clay'
            }`}
          >
            {isTaken && <Icon name="checkmark" size="meta" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className={`m-0 ${careCardTitle} ${isTaken ? 'text-ink-3 line-through' : ''}`}>
              {dose.name}
            </p>
            <div className={careCardBadgeRow}>
              <span className={PILL[dose.status]}>{statusLabel(dose.status)}</span>
            </div>
            <div className={careCardMeta}>
              <span>{formatEventTimeCompact(dose.time, timezone, hourCycle)}</span>
              <span aria-hidden="true">·</span>
              <span className={careCardMetaDetail}>{dose.dosage}</span>
            </div>
          </div>
        </div>
      </li>
    );
  };

  return (
    <div>
      <Eyebrow>{`${t('auth:preview.demo.today')} · ${todayLabel}`}</Eyebrow>
      <Text
        variant="authTitle"
        id={headingId}
        tabIndex={-1}
        className="mt-1.5 outline-none"
      >
        {t('auth:preview.medicationTitle')}
      </Text>
      <Text variant="bodyMedium" className="mt-1.5 text-ink-2!">
        {t('auth:preview.medicationSubtitle')}
      </Text>

      <PreviewAnnotation text={t('auth:preview.annotations.dailySchedule')} className="mt-5 mb-2" />

      <ul className={`m-0 list-none p-0 ${careCardListGap}`}>
        {renderDose(DOSES[0]!)}
        <li className="list-none">
          <PreviewAnnotation text={t('auth:preview.annotations.confirmedDose')} />
        </li>
        {DOSES.slice(1).map(renderDose)}
      </ul>
    </div>
  );
}
