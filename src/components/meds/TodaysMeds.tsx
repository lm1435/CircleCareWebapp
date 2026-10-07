import { useMemo, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
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
import { AddEventModal } from '@/components/calendar/AddEventModal';
import { ViewOnlyBanner } from '@/components/ViewOnlyBanner';
import { ReadOnlyCircleBanner } from '@/components/ReadOnlyCircleBanner';
import { useCircles } from '@/hooks/useCircles';
import { useCareRecipientTimezone, useEventsPresence } from '@/hooks/useCalendarEvents';
import { useTodaysMeds, useMedsForDate } from '@/hooks/useMedConfirmation';
import { AsNeededSection } from './AsNeededSection';
import { doseNeedsAnswer } from '@/utils/medicationDose';
import { useHourCycle } from '@/hooks/useHourCycle';
import { isMedicationDiscontinuedError, isOccurrenceRemovedError } from '@/lib/apiErrors';
import { Analytics } from '@/lib/analytics';
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
import { confirmFailureOutcome } from '@/lib/confirmVerify';
import {
  changeAnswerCopy,
  doseAlreadyRecorded,
  doseAlreadyRecordedMessage,
  type DoseAlreadyRecorded,
} from '@/lib/doseAlreadyRecorded';
import { ChangeAnswerDialog } from './ChangeAnswerDialog';

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

const EMPTY_MEDS: TodaysMedication[] = [];

/**
 * Split Today's meds read into scheduled DOSES and the circle's ACTIVE
 * as-needed medications. An as-needed row has no schedule: it is never a dose,
 * so it must never reach `allAnswered`, "needs attention" or any count.
 */
function splitAsNeeded(rows: TodaysMedication[] | undefined): {
  scheduledToday: TodaysMedication[];
  asNeededToday: TodaysMedication[];
} {
  const list = rows ?? EMPTY_MEDS;
  return {
    scheduledToday: list.filter((m) => m.as_needed !== true),
    asNeededToday: list
      .filter((m) => m.as_needed === true && !m.discontinued_at)
      .sort((a, b) => (a.medication_name || a.title).localeCompare(b.medication_name || b.title)),
  };
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
  // ONE read carries today's scheduled doses AND the circle's as-needed (PRN)
  // medications (`includeAsNeeded`): the server returns PRN rows whole, whatever
  // the window, so no second request is needed. They are split apart below.
  const medsQuery = useTodaysMeds(circleId, timezone ?? undefined, { includeAsNeeded: true });
  const { scheduledToday, asNeededToday } = useMemo(() => splitAsNeeded(medsQuery.data), [medsQuery.data]);
  // Yesterday's doses nobody answered. Mobile has surfaced these as "Needs
  // Attention" since it shipped; web had no equivalent, so an unanswered dose
  // simply stopped existing here at midnight — on the surface a caregiver is
  // most likely to be looking at.
  const yesterdayQuery = useMedsForDate(
    circleId,
    timezone ? getYesterdayInTimezone(timezone) : undefined
  );
  // FIRST-RUN PRESENCE. "Nothing today" covers two different circles: one with
  // a weekly dose that is simply not due today, and one that has never had a
  // medication at all. The second needs a door, not a shrug. This is the SAME
  // wide window (30 days back, 180 ahead, recipient's frame) the Get-started
  // checklist already asks for, so whenever that card is on screen this is a
  // cache hit rather than a second fetch. The dates stay empty until the
  // timezone resolves — `useEventsPresence` is disabled on empty dates — so the
  // key only ever matches the checklist's, never a device-local guess. It is a
  // PRESENCE read (booleans), not the 211-day events list it used to download.
  const presenceToday = timezone ? getDateInTimezone(timezone) : '';
  const presence = useEventsPresence(
    circleId ?? '',
    presenceToday ? addDays(presenceToday, -30) : '',
    presenceToday ? addDays(presenceToday, 180) : ''
  );
  // As-needed medications are NOT in the presence read (they are not events on
  // a day), so a circle whose only medication is as-needed must not be told
  // "No medications yet". They also never count toward `allAnswered` below:
  // they have no dose to answer and live in their own section.
  const hasAnyMedication = presence.data?.medication === true || asNeededToday.length > 0;
  const [showAdd, setShowAdd] = useState(false);
  // Viewer's 12h/24h clock — every rendered time goes through it.
  const hourCycle = useHourCycle();
  const [expanded, setExpanded] = useState(false);
  const [attentionExpanded, setAttentionExpanded] = useState(false);

  // PK29: the already-recorded notice's "Change answer" opens this.
  const [changing, setChanging] = useState<{
    med: TodaysMedication;
    mine: ConfirmableStatus;
    theirs: DoseAlreadyRecorded;
  } | null>(null);

  const undoFlow = useMedicationUndo({
    circleId: circleId ?? '',
    source: 'care_profile',
    onConfirmed: (status) => {
      showToast(
        t(status === 'skipped' ? 'dialog.successSkipped' : 'dialog.successTaken'),
        'success'
      );
    },
    onError: (error, status, med) => {
      // 409 DOSE_ALREADY_RECORDED (PK1): ANOTHER caregiver already answered
      // this dose and their answer stands. Not a failure — who and when, calmly.
      // The mutation already refetched the day before settling, so the row now
      // shows their answer and the undo badge is gone.
      const alreadyRecorded = doseAlreadyRecorded(error);
      if (alreadyRecorded) {
        // PK29: offer "Change answer" when the answers differ and the time of
        // theirs is known (otherwise the notice stands alone, as before).
        const canChange = changeAnswerCopy(t, alreadyRecorded, status, hourCycle) !== null;
        showToast(
          doseAlreadyRecordedMessage(t, alreadyRecorded, hourCycle),
          'info',
          canChange
            ? {
                label: t('dialog.changeAnswerAction'),
                onClick: () => setChanging({ med, mine: status, theirs: alreadyRecorded }),
              }
            : undefined
        );
        return;
      }
      // The mutation hook already toasts (and refreshes access flags) for a
      // permission rejection — anything else needs its own word, and a 409 on a
      // stopped medication needs a DIFFERENT word: no retry can ever succeed.
      if (isPermissionDeniedError(error)) return;
      showToast(
        t(
          isMedicationDiscontinuedError(error)
            ? 'dialog.errorDiscontinued'
            : isOccurrenceRemovedError(error)
              ? 'dialog.errorOccurrenceRemoved'
              : confirmFailureOutcome(error) === 'unverified'
                ? 'dialog.errorUnverified'
                : 'dialog.error',
          { medication: med.medication_name || med.title }
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
  // An as-needed row is never a dose: a day cached while it WAS today carried
  // them, and the same entry is read as yesterday after midnight.
  const needsAttention = (yesterdayQuery.data ?? []).filter(
    (med) => med.as_needed !== true && doseNeedsAnswer(med.confirmation)
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

  const skeleton = (
    <div className="flex flex-col gap-2" aria-busy="true">
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
    </div>
  );

  // THE FIRST-RUN RULE. "No medications yet" + "Add a medication" renders only
  // when EVERY read that decides first run — today, yesterday and the presence
  // window — has SUCCEEDED and says nothing exists. Pending, paused (offline:
  // `isPending` with no fetch in flight, where `isLoading` is false) or errored
  // never reach the door. Presence and yesterday only decide the EMPTY copy, so
  // they gate that branch alone: doses that did load always render.
  const nothingListed =
    medsQuery.isSuccess && scheduledToday.length === 0 && needsAttention.length === 0;

  // Yesterday's read FAILED while the card otherwise has something true to say
  // (doses, or "none today"). Its doses would silently vanish from Needs
  // Attention, so the gap is named, with its own retry.
  const yesterdayErrorNotice = yesterdayQuery.isError ? (
    <div className="mb-3">
      <p className="m-0 text-sm text-ink-3">{t('needsAttentionLoadError')}</p>
      <button type="button" onClick={() => void yesterdayQuery.refetch()} className={showAllRow}>
        {t('common:retry')}
      </button>
    </div>
  ) : null;

  let body: ReactElement;
  if (medsQuery.isPending || !circle || !timezone) {
    body = skeleton;
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
  } else if (
    nothingListed &&
    (presence.isError || (yesterdayQuery.isError && !(presence.isSuccess && hasAnyMedication)))
  ) {
    // A FAILED presence read is not a first run. `presence.events` is empty on
    // error, so without this branch a circle that HAS medications was told "No
    // medications yet" and offered "Add a medication" — a duplicate series that
    // doubles the adherence denominator. Neutral copy, no door, and a retry of
    // whichever read failed. (A failed YESTERDAY read with presence saying "has
    // medications" is not ambiguous — "none today" is still true — so that case
    // takes the fact copy below, with the yesterday notice.)
    body = (
      <div>
        <p className="m-0 mb-2 text-sm text-ink-3">{t('presenceLoadError')}</p>
        <button
          type="button"
          onClick={() => {
            if (presence.isError) void presence.refetch();
            if (yesterdayQuery.isError) void yesterdayQuery.refetch();
          }}
          className={showAllRow}
        >
          {t('common:retry')}
        </button>
      </div>
    );
  } else if (nothingListed && (presence.isPending || yesterdayQuery.isPending)) {
    // Still pending or PAUSED offline. The empty copy must not guess — and must
    // never flip from first-run to "none today" after paint.
    body = skeleton;
  } else if (nothingListed && presence.isSuccess && hasAnyMedication) {
    // Split on presence (see above): a circle that HAS medications gets the
    // plain fact.
    body = (
      <>
        {yesterdayErrorNotice}
        <p className="m-0 text-sm text-ink-3">{t('empty')}</p>
      </>
    );
  } else if (nothingListed && presence.isSuccess && yesterdayQuery.isSuccess) {
    // Every deciding read succeeded and found nothing: a genuine first run gets
    // the invitation and, for a writer, the door itself. The modal is hosted
    // here, not on the calendar — Medications is its own page with its own Add,
    // and the old copy sent people to the wrong one.
    body = (
      <div className="flex flex-col items-start gap-3">
        <p className="m-0 text-sm text-ink-3">{t('emptyFirstRun')}</p>
        {canEdit && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              Analytics.homeEmptyCtaTapped('medications');
              setShowAdd(true);
            }}
          >
            {t('addFirst')}
          </Button>
        )}
      </div>
    );
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
      // During the optimistic undo window the pill follows the PENDING answer
      // (what the UndoBadge already says), not the stale server status — else a
      // just-taken dose reads "Not marked" beside a "Taken" badge.
      const shownStatus: MedDisplayStatus = !pendingStatus
        ? status
        : pendingStatus === 'skipped'
          ? 'skipped'
          : 'taken';
      const statusLabel =
        shownStatus === 'pending'
          ? confirmable
            ? t('calendar:dueSoon')
            : t('calendar:upcoming')
          : t(`status.${shownStatus}`);
      const statusPill =
        shownStatus === 'pending' && confirmable
          ? STATUS_PILL.dueSoon
          : STATUS_PILL_CLASS[shownStatus];
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
      ...scheduledToday.filter((med) => doseNeedsAnswer(med.confirmation)),
      ...scheduledToday.filter((med) => !doseNeedsAnswer(med.confirmation)),
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
        {yesterdayErrorNotice}
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

      <AsNeededSection circleId={circleId} meds={asNeededToday} />

      {showAdd && (
        <AddEventModal
          circleId={circleId}
          initialType="medication"
          onClose={() => setShowAdd(false)}
        />
      )}

      {changing && (
        <ChangeAnswerDialog
          circleId={circleId}
          med={changing.med}
          mine={changing.mine}
          theirs={changing.theirs}
          source="care_profile"
          onClose={() => setChanging(null)}
        />
      )}
    </section>
  );
}
