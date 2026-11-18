import { type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Icon, Sheet, Text } from '@/components/ui';
import { formatDateForDisplay } from '@/components/calendar/dateMath';
import { formatRecurrenceLabel } from '@/components/calendar/recurrenceLabel';
import { useHourCycle } from '@/hooks/useHourCycle';
import type { EmergencyMedications as EmergencyMedicationsData } from '@/hooks/useEmergencyMedications';
import { formatEventTimeCompact, getDateInTimezone } from '@/utils/timezone';
import { EmptySection } from './EmergencySection';

export interface EmergencyMedicationsProps {
  meds: EmergencyMedicationsData;
  /** The recipient's zone (display only; the rows only exist once it is known). */
  timezone: string;
  canEdit: boolean;
  /** Opens the add-medication form (editors only). */
  onAdd: () => void;
}

interface Row {
  key: string;
  name: string;
  /** Dosage · time (or date), the muted line. */
  detail: string;
  /** The cadence ("Daily") or the stop label ("Stopped Nov 3"). */
  pill: string | null;
  stopped: boolean;
}

const DATE_OPTIONS: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };

/**
 * Current medications on Emergency info (1.4.3, mobile parity: EmergencyInfoScreen's
 * "1. Current Medications"): recurring meds with their cadence and time, as-needed meds, then
 * "Recent (last 30 days)" one-time meds and stopped meds, each stopped row ALWAYS labelled with
 * the date it stopped (never mistaken for one still being taken). Read-only rows; an editor gets
 * Add (the add-medication form), a viewer sees the list or "No current medications".
 */
export function EmergencyMedications({
  meds,
  timezone,
  canEdit,
  onAdd,
}: EmergencyMedicationsProps): ReactElement {
  const { t } = useTranslation(['emergency', 'calendar', 'common']);
  const hourCycle = useHourCycle();

  const date = (d: string): string => formatDateForDisplay(d, DATE_OPTIONS);
  const join = (...parts: Array<string | null | undefined>): string =>
    parts.filter(Boolean).join(' · ');
  const nameOf = (e: { medication_name?: string | null; title: string }): string =>
    e.medication_name || e.title;

  const current: Row[] = [
    ...meds.active.map((e) => ({
      key: e.id,
      name: nameOf(e),
      detail: join(
        e.medication_dosage,
        e.scheduled_time ? formatEventTimeCompact(e.scheduled_time, timezone, hourCycle) : null
      ),
      pill: formatRecurrenceLabel(e, t),
      stopped: false,
    })),
    ...meds.asNeeded.map((e) => {
      const reason = e.as_needed_reason?.trim();
      return {
        key: e.id,
        name: nameOf(e),
        detail: join(e.medication_dosage),
        pill: reason
          ? t('careSummary.frequency.asNeededFor', { reason })
          : t('careSummary.frequency.asNeeded'),
        stopped: false,
      };
    }),
  ];
  const recent: Row[] = [
    ...meds.recent.map((e) => ({
      key: e.id,
      name: nameOf(e),
      detail: join(e.medication_dosage, date(e.scheduled_date)),
      pill: null,
      stopped: false,
    })),
    ...meds.stopped.map(({ event: e, stoppedAt, endedOn }) => ({
      key: e.id,
      name: nameOf(e),
      detail: join(e.medication_dosage),
      // An ended course's stop date IS its naive end date (PK26); a discontinue instant is
      // resolved to a day in the RECIPIENT's zone before it is formatted.
      pill: t('stoppedOn', {
        date: date(endedOn ?? getDateInTimezone(timezone, new Date(stoppedAt))),
      }),
      stopped: true,
    })),
  ];

  const addButton = (
    <Button
      variant="secondary"
      size="sm"
      leftIcon={<Icon name="add-outline" size="row" />}
      onClick={onAdd}
      offlineKind="change"
    >
      {t('edit.addMedication')}
    </Button>
  );

  let body: ReactElement;
  if (meds.isLoading) {
    body = (
      <p role="status" className="m-0 text-sm text-ink-3">
        {t('common:loading')}
      </p>
    );
  } else if (meds.isError) {
    body = (
      <div role="alert" className="flex flex-col items-start gap-3">
        <Text variant="body" className="text-ink-2!">
          {t('medicationsLoadError')}
        </Text>
        <Button variant="secondary" size="sm" onClick={meds.refetch}>
          {t('common:retry')}
        </Button>
      </div>
    );
  } else if (current.length === 0 && recent.length === 0) {
    body = (
      <EmptySection
        message={t('empty.noMedications')}
        action={canEdit ? addButton : undefined}
      />
    );
  } else {
    const renderRow = (row: Row): ReactElement => (
      <li
        key={row.key}
        data-testid="emergency-med-row"
        className="flex flex-col gap-0.5 border-t border-line-2 px-[18px] py-3 first:border-t-0"
      >
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-md font-medium text-ink">{row.name}</span>
          {row.pill ? (
            <Badge variant={row.stopped ? 'default' : 'accent'} size="sm">
              {row.pill}
            </Badge>
          ) : null}
        </span>
        {row.detail ? <span className="text-sm text-ink-2">{row.detail}</span> : null}
      </li>
    );
    body = (
      <>
        <Sheet padding="none" className="print-card">
          {current.length > 0 ? (
            <ul className="m-0 list-none p-0">{current.map(renderRow)}</ul>
          ) : null}
          {recent.length > 0 ? (
            <div className={current.length > 0 ? 'border-t border-line-2' : undefined}>
              <Text variant="label" as="h3" className="px-[18px] pt-3">
                {t('recentMedications')}
              </Text>
              <ul className="m-0 list-none p-0">{recent.map(renderRow)}</ul>
            </div>
          ) : null}
        </Sheet>
        {canEdit ? <div className="no-print">{addButton}</div> : null}
      </>
    );
  }

  return (
    <section id="medications" aria-labelledby="medications-heading" className="scroll-mt-28">
      <Text variant="h2" as="h2" id="medications-heading" className="mb-3">
        {t('sections.medications')}
      </Text>
      <div className="grid gap-4">{body}</div>
    </section>
  );
}
