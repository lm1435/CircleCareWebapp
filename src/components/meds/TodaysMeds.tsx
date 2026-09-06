import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Card,
  Icon,
  Skeleton,
  SectionHeader,
  UndoBadge,
  useToast,
  careCardActionPrimary,
  careCardActionText,
  careCardActionsInline,
  careCardActionsRow,
  careCardBadgeRow,
  careCardLeading,
  careCardListGap,
  careCardMeta,
  careCardMetaDetail,
  careCardShell,
  careCardTitle,
  careCardTopRow,
  STATUS_PILL,
} from '@/components/ui';
import { addDays } from '@/components/calendar/dateMath';
import { ViewOnlyBanner } from '@/components/ViewOnlyBanner';
import { ReadOnlyCircleBanner } from '@/components/ReadOnlyCircleBanner';
import { useCircles } from '@/hooks/useCircles';
import { useCareRecipientTimezone } from '@/hooks/useCalendarEvents';
import { useTodaysMeds, useMedsForDate } from '@/hooks/useMedConfirmation';
import { doseNeedsAnswer } from '@/utils/medicationDose';
import { useHourCycle } from '@/hooks/useHourCycle';
import { isMedicationDiscontinuedError } from '@/lib/apiErrors';
import {
  formatEventTimeCompact,
  getDateInTimezone,
  isDoseConfirmable,
  isEventPastDue,
  zoneReferenceInstant,
} from '@/utils/timezone';
import {
  isPermissionDeniedError,
  type ConfirmableStatus,
  type TodaysMedication,
} from '@/api/medicationConfirmations';
import { useMedicationUndo } from './useMedicationUndo';

// Today's medications (spec §6.3.2 / §4.6): the dose cards a caregiver answers,
// rendered on Home and anywhere else a day's doses belong. "Today" and every
// past-due check use the CARE RECIPIENT'S timezone (circle.timezone) — never
// device-local date math.
//
// Gating: when circle.can_edit === false the actions are hidden (covers both
// view_only and read_only) and the matching banner renders. Backend enforces
// access via requireCircleEditAccess regardless.
//
// INACTIVE MEDICATIONS: this widget fetches through the calendar events
// endpoint WITHOUT `includeDiscontinued`, so every dose it receives is one the
// backend found DUE — including a dose of a medication that was stopped later
// the same day. Those keep their Take/Skip pair (a dose really given has to
// stay loggable, or it counts as missed in the clinician-facing adherence
// report forever); they only gain an "Inactive" marker in TEXT so the state is
// still conveyed without relying on colour (WCAG 2.1 AA 1.4.1). The Medications
// roster is the surface that asks for discontinued rows explicitly and can hold
// NOT-due occurrences — it carries no dose-confirmation control at all.
//
// WHEN a dose may be answered is a SEPARATE question from whether the
// medication is active, and the two predicates compose. Take/Skip are gated on
// `isDoseConfirmable` (mobile's predicate, ported verbatim into
// utils/timezone.ts): the pair opens DOSE_EARLY_CONFIRM_WINDOW_MINUTES (2h)
// before the scheduled moment and stays open once overdue. The row says
// "Upcoming" until the window opens and "Due soon" once it has, mirroring
// mobile's MedicationRow pill so a card never asks to be confirmed and calls
// itself upcoming at the same time.
//
// ANSWERING IS OPTIMISTIC, with a 5-second undo window (mobile parity — see
// useMedicationUndo): the pair collapses into an `UndoBadge` and the request
// only leaves once that window closes. This replaces the old modal, which
// asked a caregiver to re-state in a dialog the thing they had just clicked.

/**
 * How many of yesterday's unanswered doses the Needs Attention group draws
 * before it collapses. Matches mobile's cap so the two surfaces agree on how
 * much of a backlog is worth showing at a glance.
 */
const NEEDS_ATTENTION_LIMIT = 2;

/**
 * Yesterday, as a date string in the CARE RECIPIENT'S timezone.
 *
 * Resolved ENTIRELY in the recipient's frame: take the recipient's today, then
 * step back one calendar day with UTC-based date math.
 *
 * This previously did `yesterday.setDate(yesterday.getDate() - 1)` and then
 * formatted the result in the recipient's zone. `setDate` is DEVICE-LOCAL
 * calendar arithmetic, so on the caregiver's own DST-transition days it shifts
 * the instant by 23h or 25h, not 24h — and when the recipient's local clock is
 * within that slack of midnight, reformatting lands on the wrong day. A Denver
 * caregiver on fall-back (a 25h step) looking at a Bangkok recipient whose
 * local time is just past midnight got the day BEFORE yesterday, quietly
 * dropping a day of unanswered doses out of Needs Attention.
 *
 * Stepping the recipient's own date string has no such slack: a calendar day
 * back is a calendar day back, DST or not.
 */
export function getYesterdayInTimezone(timezone: string): string {
  return addDays(getDateInTimezone(timezone), -1);
}

type MedDisplayStatus = 'taken' | 'missed' | 'pending' | 'skipped' | 'unconfirmed';

/** Status → pill tone. The pill is the ONE state signal on a dose card. */
const STATUS_PILL_CLASS: Record<MedDisplayStatus, string> = {
  taken: STATUS_PILL.taken,
  missed: STATUS_PILL.overdue,
  skipped: STATUS_PILL.skipped,
  unconfirmed: STATUS_PILL.overdue,
  pending: STATUS_PILL.upcoming,
};

function getMedDisplayStatus(
  med: TodaysMedication,
  careRecipientTimezone: string
): MedDisplayStatus {
  const confirmation = med.confirmation;
  if (confirmation) {
    if (confirmation.status === 'taken' || confirmation.status === 'taken_late') return 'taken';
    if (confirmation.status === 'skipped') return 'skipped';
    return 'missed'; // explicitly recorded 'missed' (incl. legacy auto-marked)
  }
  // Past due with NO recorded confirmation — we don't know what happened, so
  // show a neutral "Not confirmed" instead of asserting it was missed.
  return isEventPastDue(med.scheduled_date, med.scheduled_time ?? null, careRecipientTimezone)
    ? 'unconfirmed'
    : 'pending';
}

export interface TodaysMedsProps {
  circleId?: string;
  /**
   * When set, only the first N meds show by default with a "Show all" toggle that
   * expands the rest in place — keeps a long med day from dominating a dashboard
   * card while keeping every confirm/skip action one click away.
   */
  limit?: number;
}

export function TodaysMeds({ circleId, limit }: TodaysMedsProps): ReactElement | null {
  const { t } = useTranslation(['meds', 'calendar', 'common']);
  const { showToast } = useToast();
  const { data: circles } = useCircles();
  const circle = circles?.find((c) => c.id === circleId);
  // The care recipient's timezone is NOT on the circles list — it comes from
  // GET /circles/:circleId. All "today"/past-due math must use it.
  const { timezone } = useCareRecipientTimezone(circleId ?? '');
  const medsQuery = useTodaysMeds(circleId, timezone ?? undefined);
  // Yesterday's doses nobody answered. Mobile has surfaced these as "Needs
  // Attention" since it shipped; web had no equivalent, so an unanswered dose
  // simply stopped existing here at midnight — on the surface a caregiver is
  // most likely to be looking at.
  const yesterdayQuery = useMedsForDate(
    circleId,
    timezone ? getYesterdayInTimezone(timezone) : undefined
  );
  // Viewer's 12h/24h clock — every rendered time goes through it.
  const hourCycle = useHourCycle();
  const [expanded, setExpanded] = useState(false);
  const [attentionExpanded, setAttentionExpanded] = useState(false);

  const undoFlow = useMedicationUndo({
    circleId: circleId ?? '',
    source: 'care_profile',
    onConfirmed: (status) => {
      showToast(
        t(status === 'skipped' ? 'dialog.successSkipped' : 'dialog.successTaken'),
        'success'
      );
    },
    onError: (error) => {
      // The mutation hook already toasts (and refreshes access flags) for a
      // permission rejection — anything else needs its own word, and a 409 on a
      // stopped medication needs a DIFFERENT word: no retry can ever succeed.
      if (isPermissionDeniedError(error)) return;
      showToast(
        t(
          isMedicationDiscontinuedError(error)
            ? 'dialog.errorDiscontinued'
            : 'dialog.error'
        ),
        'error'
      );
    },
  });

  if (!circleId) return null;

  // Default to no edit affordances until access flags are known.
  const canEdit = circle ? circle.can_edit !== false : false;

  // Yesterday's doses that still need a human answer. An auto-`missed` row is
  // the cron recording that nobody replied, NOT a reply — `doseNeedsAnswer`
  // keeps those asking, exactly as mobile does.
  const needsAttention = (yesterdayQuery.data ?? []).filter((med) =>
    doseNeedsAnswer(med.confirmation)
  );

  function handleConfirm(med: TodaysMedication, status: ConfirmableStatus): void {
    // DEFENSE IN DEPTH, mirroring mobile (CalendarScreen.confirmEventWithStatus
    // re-checks the same predicate before mutating, not just where the pair is
    // rendered). The pair is already gated on `isDoseConfirmable`, but a card
    // left on screen across the boundary would otherwise POST a dose that was
    // never due and falsify the adherence record the clinician report is built
    // from. The backend does NOT enforce this today; until it does, this is the
    // last line, not a redundant one.
    if (!isDoseConfirmable(med.scheduled_date, med.scheduled_time ?? null, timezone ?? '')) {
      showToast(t('dialog.errorNotDue'), 'error');
      return;
    }
    undoFlow.confirm(med, status);
  }

  const showAllRow =
    'flex w-full items-center justify-center gap-1 min-h-[44px] py-3 text-md font-medium text-dusk';

  let body: ReactElement;
  if (medsQuery.isPending || !circle || !timezone) {
    body = (
      <div className="flex flex-col gap-2" aria-busy="true">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  } else if (medsQuery.isError) {
    body = (
      <div>
        <p className="m-0 mb-2 text-sm text-ink-3">{t('loadError')}</p>
        <button
          type="button"
          onClick={() => void medsQuery.refetch()}
          className={showAllRow}
        >
          {t('common:retry')}
        </button>
      </div>
    );
  } else if (medsQuery.data.length === 0 && needsAttention.length === 0) {
    body = <p className="m-0 text-sm text-ink-3">{t('empty')}</p>;
  } else {
    /**
     * One dose card. Extracted from the today list so the Needs Attention group
     * draws the identical row — a dose must not look like a different thing
     * depending on which day it belongs to.
     */
    const renderMed = (med: TodaysMedication): ReactElement => {
      const status = getMedDisplayStatus(med, timezone);
      // A dose that has not come around yet has not happened — marking it
      // taken would falsify the adherence record. Deliberately NOT gated
      // on `discontinued_at` (see the note above): inactive-ness and
      // timing are independent questions, and both must be satisfied.
      const confirmable = isDoseConfirmable(
        med.scheduled_date,
        med.scheduled_time ?? null,
        timezone
      );
      const pendingStatus = undoFlow.pending[med.id];
      // `doseNeedsAnswer`, not `!med.confirmation`: an auto-`missed` row is
      // the cron saying nobody answered, not an answer — so the dose can
      // still be corrected here rather than only on the calendar.
      const showActions =
        canEdit && !pendingStatus && doseNeedsAnswer(med.confirmation) && confirmable;
      // The pre-due badge splits the way mobile's pill does: "Due soon"
      // exactly when the Take/Skip pair is live, "Upcoming" while it is
      // still too early to answer. Every other status keeps its own label.
      const statusLabel =
        status === 'pending'
          ? confirmable
            ? t('calendar:dueSoon')
            : t('calendar:upcoming')
          : t(`status.${status}`);
      const statusPill =
        status === 'pending' && confirmable ? STATUS_PILL.dueSoon : STATUS_PILL_CLASS[status];
      const inactive = !!med.discontinued_at;
      // A pending answer reads as done immediately — that is the whole point of
      // the optimistic window.
      const isTaken = status === 'taken' || pendingStatus === 'taken';
      const isSkipped = status === 'skipped' || pendingStatus === 'skipped';
      const isDone = isTaken || isSkipped;
      const medName = med.medication_name || med.title;

      // The action pair renders TWICE by design (see careCard.ts): inline at
      // the end of the meta line at default card width, and stacked into its
      // own right-aligned row once the CARD's own content box narrows below
      // 360px. Container queries hide whichever one is not in play, so exactly
      // one is ever in the accessibility tree.
      //
      // Each button is NAMED after its medication, the same way the UndoBadge
      // that replaces it takes `itemLabel` and the roster's overflow trigger
      // takes the medication name. A day of doses otherwise offers a screen
      // reader four buttons all called "Confirm", with the drug each answers
      // knowable only from the surrounding card — and answering the wrong one
      // writes the wrong medication into the adherence record a doctor reads.
      // The visible word is the FIRST word of the accessible name in both
      // locales ("Confirm"/"Confirmar", "Skip"/"Omitir"), so SC 2.5.3 Label in
      // Name holds and voice control still works on the visible label.
      const actionPair = (
        <>
          <button
            type="button"
            onClick={() => handleConfirm(med, 'skipped')}
            aria-label={t('skipLabel', { name: medName })}
            className={careCardActionText}
          >
            {t('skip')}
          </button>
          <button
            type="button"
            onClick={() => handleConfirm(med, 'taken')}
            aria-label={t('confirmLabel', { name: medName })}
            className={careCardActionPrimary}
          >
            {t('confirm')}
          </button>
        </>
      );

      return (
        <li key={med.id} className={careCardShell}>
          <div className={careCardTopRow}>
            {/* The status circle is FUNCTIONAL — it is why this row carries no
                decorative icon tile. Filled moss with a checkmark when taken,
                hollow line when skipped, hollow clay while it still asks. */}
            <span
              aria-hidden="true"
              className={`${careCardLeading} ${
                isTaken
                  ? 'border-moss-deep bg-moss-deep text-cream'
                  : isSkipped
                    ? 'border-line'
                    : 'border-clay'
              }`}
            >
              {isTaken && <Icon name="checkmark" size="meta" />}
            </span>

            <div className="min-w-0 flex-1">
              <p className={`m-0 ${careCardTitle} ${isDone ? 'text-ink-3 line-through' : ''}`}>
                {medName}
              </p>

              <div className={careCardBadgeRow}>
                <span className={statusPill}>{statusLabel}</span>
                {/* The medication is inactive; the dose is still answerable.
                    Text, not colour — the same word the calendar chips and the
                    Meds roster use. */}
                {inactive && (
                  <span className={STATUS_PILL.inactive}>
                    {t('calendar:discontinueMed.inactiveBadge')}
                  </span>
                )}
              </div>

              <div className={careCardMeta}>
                {med.scheduled_time && (
                  <span>
                    {formatEventTimeCompact(
                      med.scheduled_time,
                      timezone,
                      hourCycle,
                      // The DOSE's own day. This list puts yesterday's
                      // unanswered doses beside today's, and the day after a
                      // DST transition those two days sit in different offsets
                      // — so judging at "now" labels a dose against a day it is
                      // not on.
                      zoneReferenceInstant(med.scheduled_date)
                    )}
                  </span>
                )}
                {med.scheduled_time && med.medication_dosage ? (
                  <span aria-hidden="true">·</span>
                ) : null}
                {med.medication_dosage && (
                  <span className={careCardMetaDetail}>{med.medication_dosage}</span>
                )}
                {showActions && <span className={careCardActionsInline}>{actionPair}</span>}
                {pendingStatus && (
                  <span className="ml-auto">
                    <UndoBadge
                      kind={pendingStatus === 'skipped' ? 'skipped' : 'taken'}
                      label={t(
                        pendingStatus === 'skipped' ? 'status.skipped' : 'status.taken'
                      )}
                      undoLabel={t('undo')}
                      itemLabel={medName}
                      onUndo={() => undoFlow.undo(med.id)}
                    />
                  </span>
                )}
              </div>
            </div>
          </div>

          {showActions && <div className={careCardActionsRow}>{actionPair}</div>}
        </li>
      );
    };

    // Doses still waiting on a human come FIRST, each group in clock order.
    //
    // This is the bug the cap exposed: `limit` collapses the tail, and with a
    // purely chronological list the collapsed tail is wherever the unanswered
    // doses happen to fall. A morning already answered would push every dose
    // that still needs a caregiver behind "Show all" — a control hiding exactly
    // what it exists to surface. Answered doses are kept (a desktop card can
    // afford the record of the day, where a phone cannot) but they can never
    // displace one that is outstanding.
    const allMeds = [
      ...medsQuery.data.filter((med) => doseNeedsAnswer(med.confirmation)),
      ...medsQuery.data.filter((med) => !doseNeedsAnswer(med.confirmation)),
    ];
    const collapsed = limit != null && !expanded && allMeds.length > limit;
    const visibleMeds = collapsed ? allMeds.slice(0, limit) : allMeds;

    const attentionCollapsed =
      !attentionExpanded && needsAttention.length > NEEDS_ATTENTION_LIMIT;
    const visibleAttention = attentionCollapsed
      ? needsAttention.slice(0, NEEDS_ATTENTION_LIMIT)
      : needsAttention;

    // Nothing left to answer today, and there WAS something — mobile's
    // all-done card, so a finished day reads as finished rather than as an
    // ordinary list of struck-through rows.
    const allAnswered =
      allMeds.length > 0 &&
      needsAttention.length === 0 &&
      allMeds.every((med) => !doseNeedsAnswer(med.confirmation));

    body = (
      <>
        {needsAttention.length > 0 && (
          <section aria-labelledby="meds-needs-attention" className="mb-4">
            <h3
              id="meds-needs-attention"
              className="m-0 text-sm font-semibold text-terracotta-deep"
            >
              {t('needsAttention')}
            </h3>
            <p className="m-0 mb-2 text-xs text-ink-3">{t('needsAttentionHint')}</p>
            <ul className={`m-0 list-none p-0 ${careCardListGap}`}>
              {visibleAttention.map(renderMed)}
            </ul>
            {needsAttention.length > NEEDS_ATTENTION_LIMIT && (
              <button
                type="button"
                onClick={() => setAttentionExpanded((v) => !v)}
                className={showAllRow}
              >
                {attentionExpanded
                  ? t('showLess')
                  : t('showAll', { count: needsAttention.length })}
              </button>
            )}
          </section>
        )}

        {allAnswered && (
          <Card
            variant="filled"
            padding="sm"
            className="mb-3 flex items-center justify-center gap-2 text-moss"
          >
            <Icon name="checkmark-circle" size="row" />
            {t('allDone')}
          </Card>
        )}

        <ul className={`m-0 list-none p-0 ${careCardListGap}`}>{visibleMeds.map(renderMed)}</ul>

        {limit != null && allMeds.length > limit && (
          <button type="button" onClick={() => setExpanded((v) => !v)} className={showAllRow}>
            {expanded ? t('showLess') : t('showAll', { count: allMeds.length })}
          </button>
        )}
      </>
    );
  }

  return (
    <section aria-labelledby="todays-meds-heading" className="flex flex-col gap-2">
      {/* Shared header — this used to be a bespoke <h2> with a px-1 offset,
          leaving this card's heading 4px off from its neighbours'. */}
      <SectionHeader id="todays-meds-heading" title={t('title')} tone="clay" />

      {circle &&
        !canEdit &&
        (circle.view_only ? (
          <ViewOnlyBanner />
        ) : circle.read_only ? (
          <ReadOnlyCircleBanner isOwner={circle.role === 'owner'} />
        ) : null)}

      {body}
    </section>
  );
}
