import { baseLanguage } from '@/i18n/locales';
import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, EmptyState, Skeleton, Text, STATUS_PILL } from '@/components/ui';
import { useMedicationConfirmations } from '@/hooks/useMedConfirmation';
import { useHourCycle } from '@/hooks/useHourCycle';
import type { HourCycle } from '@/utils/hourCycle';
import {
  formatEventTimeCompact,
  getCachedDateTimeFormat,
  getDateInTimezone,
  getRelativeDateLabel,
  zoneReferenceInstant,
} from '@/utils/timezone';
import { Analytics } from '@/lib/analytics';
import { fullNameOf, formatInstantClock } from '@/lib/asNeeded';
import { useCircleAsNeededDoses } from '@/hooks/useAsNeeded';
import type { AsNeededDoseWithEvent } from '@/api/medicationAsNeeded';
import type { TimeLanguage } from '@/utils/timezone';
import { historyParams, type HistoryConfirmation } from './historyQuery';
import { doseMedicationName, mergeHistoryDays } from './historyMerge';

/**
 * The History tab's list (spec §6.4; mobile `renderDateGroup` +
 * `renderConfirmation`): every recorded dose in the last 30 days, grouped by
 * the day it was scheduled for, newest day first.
 *
 * EVERY DATE AND TIME HERE IS IN THE CARE RECIPIENT'S ZONE. A history list is
 * mostly PAST doses, so each row is judged at its OWN day
 * (`zoneReferenceInstant`) rather than at "now" — Phoenix and Denver share a
 * clock in January and differ in July, and a screen opened in January must not
 * relabel a July dose.
 */

export interface HistoryListProps {
  circleId: string;
  /** Care recipient's IANA timezone (`useCircle(circleId).timezone`). */
  timezone: string;
  /**
   * Narrow to one medication by NAME, or `null` for all. See `MedicationFilter`
   * for why this is a name and not an `event_id`.
   */
  medicationName: string | null;
}

/**
 * Which of the three pills a recorded status wears.
 *
 * The labels are passed in already translated — a `t(variableKey)` here would
 * be invisible to the static translation-key audit
 * (`src/i18n/__tests__/translationKeys.test.ts`), which is how a renamed key
 * ships as raw text.
 */
function pillFor(
  status: string,
  labels: { taken: string; takenLate: string; skipped: string; notMarked: string }
): { className: string; label: string } {
  if (status === 'taken') {
    return { className: STATUS_PILL.taken, label: labels.taken };
  }
  if (status === 'taken_late') {
    return { className: STATUS_PILL.taken, label: labels.takenLate };
  }
  if (status === 'skipped') {
    // Neutral grey on purpose: a deliberate skip is an answer, not an alarm.
    return { className: STATUS_PILL.skipped, label: labels.skipped };
  }
  // Legacy `missed` rows (auto-miss was removed): nobody marked the dose.
  return { className: STATUS_PILL.overdue, label: labels.notMarked };
}

/** "Ana Ruiz" · "ana" · "Someone" — never a bare user id. */
function confirmedByName(confirmation: HistoryConfirmation, fallback: string): string {
  const user = confirmation.confirmed_by_user;
  const full = [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim();
  if (full) return full;
  const email = user?.email;
  if (email) return email.split('@')[0];
  return fallback;
}

/**
 * The wall-clock HH:MM an INSTANT lands on in a timezone.
 *
 * Through the shared formatter cache, not `new Intl.DateTimeFormat(...)`: this
 * runs once per CARD, and constructing a formatter is the expensive half of the
 * API (it resolves locale and zone data) while `.format()` is cheap. A month of
 * history is ~150 cards, so building one per row is the exact cost
 * `getCachedDateTimeFormat` exists to remove.
 */
function instantWallClock(iso: string, timezone: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  try {
    return getCachedDateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(at);
  } catch {
    return null;
  }
}

/**
 * Group title: "Today" · "Yesterday" · "Monday, September 1".
 *
 * The date string is anchored at NOON UTC before formatting, the pattern the
 * rest of this codebase uses for a naive YYYY-MM-DD. Mobile builds a
 * DEVICE-LOCAL `new Date(y, m - 1, d)` and then formats it with a `timeZone`
 * override, which is midnight in the viewer's zone re-read somewhere else —
 * off by a day for any viewer east of the recipient.
 */
function formatDayTitle(
  date: string,
  timezone: string,
  language: string,
  today: string,
  labels: { today: string; yesterday: string }
): string {
  const relative = getRelativeDateLabel(date, timezone);
  if (relative === 'today') return labels.today;
  if (relative === 'yesterday') return labels.yesterday;
  // Cached per (language, option shape) — one per DAY GROUP otherwise, and the
  // month name means the LOCALE is part of the identity, not just the zone.
  return getCachedDateTimeFormat(language, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    ...(date.slice(0, 4) !== today.slice(0, 4) ? { year: 'numeric' as const } : null),
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
}

function ConfirmationCard({
  confirmation,
  timezone,
  hourCycle,
  dayKey,
}: {
  confirmation: HistoryConfirmation;
  timezone: string;
  hourCycle: HourCycle;
  dayKey: string;
}): ReactElement {
  const { t } = useTranslation('meds');
  const pill = pillFor(confirmation.status, {
    taken: t('history.statusTaken'),
    takenLate: t('history.statusTakenLate'),
    skipped: t('history.statusSkipped'),
    notMarked: t('history.statusNotMarked'),
  });
  const name = confirmation.event?.medication_name || confirmation.event?.title || '';
  const dosage = confirmation.event?.medication_dosage;

  const scheduled = confirmation.scheduled_time
    ? formatEventTimeCompact(
        confirmation.scheduled_time,
        timezone,
        hourCycle,
        zoneReferenceInstant(dayKey)
      )
    : t('history.notTaken');

  // Per status: taken -> "Taken at / Taken by"; skipped -> "Skipped at /
  // Skipped by"; legacy `missed` (nobody marked it) -> the time and actor cells
  // are HIDDEN, because no one acted and `confirmed_at` is not a dose time.
  const wasTaken = confirmation.status === 'taken' || confirmation.status === 'taken_late';
  const wasSkipped = confirmation.status === 'skipped';
  const wasAnswered = wasTaken || wasSkipped;
  const answeredWallClock = wasAnswered
    ? instantWallClock(confirmation.confirmed_at, timezone)
    : null;
  const answeredAt = answeredWallClock
    ? formatEventTimeCompact(
        answeredWallClock,
        timezone,
        hourCycle,
        new Date(confirmation.confirmed_at)
      )
    : t('history.notTaken');

  return (
    <Card as="li" className="px-5 py-[18px]">
      <div className="flex flex-col gap-1.5">
        <span className={`${pill.className} self-start`}>{pill.label}</span>
        <p className="m-0 flex flex-wrap items-baseline gap-1.5">
          <span className="text-md font-medium text-ink">{name}</span>
          {dosage && <span className="text-sm text-ink-2">{dosage}</span>}
        </p>
      </div>

      <hr className="my-3.5 border-line-2" />

      <dl className="m-0 grid grid-cols-2 gap-3">
        <div>
          <Text variant="mono" as="dt">
            {t('history.scheduledLabel')}
          </Text>
          <dd className="m-0 text-md text-ink">{scheduled}</dd>
        </div>
        {wasAnswered && (
          <>
            <div>
              <Text variant="mono" as="dt">
                {wasSkipped ? t('history.skippedAtLabel') : t('history.takenAtLabel')}
              </Text>
              <dd className="m-0 text-md text-ink">{answeredAt}</dd>
            </div>
            <div className="col-span-2">
              <Text variant="mono" as="dt">
                {wasSkipped ? t('history.skippedByLabel') : t('history.takenByLabel')}
              </Text>
              <dd className="m-0 text-md text-ink">
                {confirmedByName(confirmation, t('history.someone'))}
              </dd>
            </div>
          </>
        )}
      </dl>
    </Card>
  );
}

/**
 * A logged as-needed dose: "Given" pill, medication + dosage, "{time} · by {name}"
 * in the RECIPIENT's zone, the note. A removed dose is STRUCK THROUGH (muted) and
 * says who removed it — the same tombstone the per-medication log shows.
 */
function DoseCard({
  dose,
  timezone,
  hourCycle,
}: {
  dose: AsNeededDoseWithEvent;
  timezone: string;
  hourCycle: HourCycle;
}): ReactElement {
  const { t, i18n } = useTranslation('meds');
  const language: TimeLanguage = baseLanguage(i18n.language);
  const removed = !!dose.removed_at;
  const name = doseMedicationName(dose);
  const dosage = dose.event?.medication_dosage;
  const by = fullNameOf(dose.given_by_user) ?? t('asNeeded.history.someone');
  const time = formatInstantClock(new Date(dose.given_at), timezone, hourCycle, language);
  const removedBy = removed
    ? t('asNeeded.history.removedBy', {
        name: fullNameOf(dose.removed_by_user) ?? t('asNeeded.history.someone'),
      })
    : null;
  const strike = removed ? 'line-through' : '';
  const label = [t('asNeeded.history.rowLabel', { medication: name, name: by }), removedBy]
    .filter(Boolean)
    .join(', ');

  return (
    <Card
      as="li"
      className="px-5 py-[18px]"
      aria-label={label}
      data-testid="history-dose-row"
      data-removed={removed ? 'true' : 'false'}
    >
      <div className={`flex flex-col gap-1.5 ${removed ? 'opacity-70' : ''}`}>
        <span className={`${STATUS_PILL.taken} self-start`}>{t('asNeeded.history.given')}</span>
        <p className={`m-0 flex flex-wrap items-baseline gap-1.5 ${strike}`}>
          <span className="text-md font-medium text-ink">{name}</span>
          {dosage && <span className="text-sm text-ink-2">{dosage}</span>}
        </p>
        <p className={`m-0 text-sm text-ink ${strike}`}>
          {t('asNeeded.history.timeBy', { time, name: by })}
        </p>
        {dose.note && (
          <p className={`m-0 break-words text-sm text-ink-2 ${strike}`}>“{dose.note}”</p>
        )}
      </div>
      {removedBy && <p className="m-0 mt-1.5 text-sm text-ink-2">{removedBy}</p>}
    </Card>
  );
}

export function HistoryList({
  circleId,
  timezone,
  medicationName,
}: HistoryListProps): ReactElement {
  const { t, i18n } = useTranslation(['meds', 'common']);
  const hourCycle = useHourCycle();
  const query = useMedicationConfirmations(circleId, historyParams(timezone));

  const confirmations = useMemo(
    () => (query.data?.confirmations ?? []) as HistoryConfirmation[],
    [query.data]
  );

  // AS-NEEDED doses, same 30-day window, removed ones included (struck through).
  // SOFT-FAIL: a failed dose read leaves `doses` empty, so the scheduled history
  // still renders — it never blanks the tab.
  const { doses } = useCircleAsNeededDoses(circleId, historyParams(timezone), {
    includeRemoved: true,
  });

  const groups = useMemo(
    () => mergeHistoryDays(confirmations, doses, timezone, medicationName),
    [confirmations, doses, medicationName, timezone]
  );

  // ONCE per visit (this list mounts with the tab) when PRN rows are on screen.
  const viewedReported = useRef(false);
  const showsDoses = groups.some((g) => g.doses.length > 0);
  useEffect(() => {
    if (!showsDoses || viewedReported.current) return;
    viewedReported.current = true;
    Analytics.asNeededHistoryViewed({ scope: 'all' });
  }, [showsDoses]);

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <span className="sr-only">{t('meds:history.loading')}</span>
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <Card className="text-center">
        <p className="m-0 font-medium text-ink">{t('meds:history.errorTitle')}</p>
        <Button variant="ghost" className="mt-4" onClick={() => void query.refetch()}>
          {t('common:retry')}
        </Button>
      </Card>
    );
  }

  if (groups.length === 0) {
    return (
      <EmptyState
        icon="medkit-outline"
        tone="clay"
        title={t('meds:history.emptyTitle')}
        description={t('meds:history.emptyHint')}
      />
    );
  }

  const today = getDateInTimezone(timezone);
  const dayLabels = { today: t('meds:history.today'), yesterday: t('meds:history.yesterday') };

  return (
    <div>
      {groups.map((group, index) => (
        <section key={group.date} className={index === 0 ? undefined : 'mt-7'}>
          <Text variant="sectionTitle" as="h3" className="mb-1 px-2">
            {formatDayTitle(group.date, timezone, i18n.language, today, dayLabels)}
          </Text>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {group.confirmations.map((confirmation) => (
              <ConfirmationCard
                key={confirmation.id}
                confirmation={confirmation}
                timezone={timezone}
                hourCycle={hourCycle}
                dayKey={group.date}
              />
            ))}
            {group.doses.map((dose) => (
              <DoseCard key={dose.id} dose={dose} timezone={timezone} hourCycle={hourCycle} />
            ))}
          </ul>
        </section>
      ))}

      {/* THE LIST PAGES (mobile parity — its `useInfiniteQuery` fetches the
          next page on end-reached). Without this the "last 30 days" quietly
          stopped at the first page: a circle on five daily medications answers
          ~150 doses a month, so a fortnight of it simply did not exist on web,
          with nothing on screen admitting it. A button rather than an
          intersection observer, because the reader here is auditing a record
          and should decide when to go further back. */}
      {query.hasNextPage && (
        <div className="mt-7 flex justify-center">
          <Button
            variant="secondary"
            loading={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {t('meds:history.loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
}
