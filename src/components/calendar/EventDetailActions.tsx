import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent } from '@/api/calendarEvents';
import { Button, ConfirmDialog, useToast } from '@/components/ui';
import { useCompleteEvent, useMedicationStatus } from '@/hooks/useCalendarEvents';
import { getSeriesRoot } from '@/utils/medicationGrouping';
import { isDoseConfirmable } from '@/utils/timezone';
import { doseNeedsAnswer } from '@/utils/medicationDose';
import { Analytics } from '@/lib/analytics';

// Task 1.6 — the Edit / Delete / Complete action set rendered in the
// EventDetailModal `editActions` slot (gated on canEdit upstream). Complete is
// only offered for task/appointment events (mobile parity). Edit/Delete raise
// callbacks to the page, which OWNS the edit/delete modal state — that modal
// must outlive the detail modal it was launched from.
//
// GUARD (mobile parity): an INACTIVE (discontinued) medication cannot be
// edited in place. Edit on one prompts to reactivate first; confirming
// reactivates the WHOLE medication — every series sharing name + dosage, the
// mirror image of how discontinue stops them — without opening the editor, the
// same behavior as mobile's MedicationHistoryScreen and CalendarScreen.
//
// That guard fires from the CALENDAR too, not just the medication roster: the
// Calendar GET returns every occurrence due BEFORE the discontinue instant, so
// a historical inactive dose can be opened straight from the week/month grid.
//
// DOSE CONFIRMATION IS NOT PART OF THAT GUARD — and this is a REVERSAL.
// This modal used to render no mark-taken control at all, justified by the
// backend answering 409 MEDICATION_DISCONTINUED to any confirm on an inactive
// medication. That produced a worse bug: a dose that was really given but not
// yet logged when the medication was stopped could never be logged, so it
// counts as scheduled-and-missed in the clinician-facing adherence report
// forever, with no remedy anywhere in the product.
//
// The backend now accepts a confirm for a dose that was genuinely DUE (before
// the stop instant, outside any pause window) and 409s only the rest. The
// client-side predicate follows from what each surface fetches:
//   - CALENDAR surfaces (this modal, TodaysMeds) fetch WITHOUT
//     `includeDiscontinued`, and the backend has already filtered those
//     responses to due-only occurrences. So a medication dose VISIBLE here is
//     confirmable, inactive or not — `discontinued_at` is deliberately NOT part
//     of `canConfirmDose` below.
//   - The MEDICATIONS ROSTER fetches WITH `includeDiscontinued=true` and can
//     hold not-due occurrences, so it carries no dose-confirmation control at
//     all (MedicationsPage / MedicationDetailModal: Edit, Discontinue /
//     Reactivate, Delete — nothing that logs a dose). Do not add one.
// A stale snapshot can still aim at a not-due dose; ConfirmMedDialog maps the
// resulting 409 to its own message rather than a generic failure.
//
// The rest of the action set is unchanged:
//   - Edit → the reactivate-first prompt below (never a failing PATCH).
//   - Delete → always allowed (no discontinue guard on the delete route).
//   - Reactivate → the medication toggle, labelled by `isDiscontinued`.
//   - `canComplete` stays scoped to task/appointment: "complete" is the task
//     verb, and a dose is answered through the confirm dialog, not completed.

export interface EventDetailActionsProps {
  circleId: string;
  event: CalendarEvent;
  /**
   * Care recipient's IANA timezone. `scheduled_date` / `scheduled_time` are
   * NAIVE local values in it, so "has this dose come around yet?" can only be
   * answered against now rendered in the SAME timezone — never the viewer's
   * device clock or device day.
   */
  careRecipientTimezone: string;
  /** Open the edit form for this event (page closes the detail modal first). */
  onEdit: () => void;
  /** Open the delete dialog for this event. */
  onDelete: () => void;
  /**
   * Open the discontinue / reactivate confirm for this medication (page closes
   * the detail modal first). Only invoked for `event_type === 'medication'`.
   */
  onDiscontinue: () => void;
  /**
   * Log this dose (medications only) — the page closes the detail modal and
   * opens ConfirmMedDialog with this initial status, so the confirm dialog is
   * never a modal stacked on a modal.
   */
  onConfirmDose: (initialStatus: 'taken' | 'skipped') => void;
  /**
   * Called after `handleReactivateForEdit` succeeds (WA6), in ADDITION to this
   * component's own local override below. Wire this to refresh the parent's
   * event snapshot (e.g. the calendar page's selected-event state) so the
   * detail modal's own badge — which reads `event.discontinued_at` from that
   * same stale snapshot — also reflects the change without a close/reopen.
   */
  onReactivated?: () => void;
}

export function EventDetailActions({
  circleId,
  event,
  careRecipientTimezone,
  onEdit,
  onDelete,
  onDiscontinue,
  onConfirmDose,
  onReactivated,
}: EventDetailActionsProps): ReactElement {
  const { t } = useTranslation(['calendar', 'common']);
  const { showToast } = useToast();
  const completeEvent = useCompleteEvent(circleId);
  const medicationStatus = useMedicationStatus(circleId);
  const [showInactiveEditPrompt, setShowInactiveEditPrompt] = useState(false);
  // WA6: `event` is a snapshot the parent may not refresh in place (it's set
  // once when the detail modal opens). Once THIS component has successfully
  // reactivated the medication, its own edit-guard + Discontinue/Reactivate
  // label must reflect that immediately — otherwise Edit re-prompts to
  // reactivate a medication that was JUST reactivated, and the toggle button
  // stays mislabeled until the modal is closed and reopened.
  const [locallyReactivated, setLocallyReactivated] = useState(false);

  const canComplete =
    (event.event_type === 'task' || event.event_type === 'appointment') && !event.completed_at;

  // COMPLETED TASKS ARE LOCKED (founder directive): once a task's completion
  // has persisted, its Edit affordance is hidden — same shape as canComplete
  // disappearing above, and mirrors the TasksPage row and mobile's calendar
  // detail modal. Keyed on completed_at alone so a task that were re-opened
  // becomes editable again. Delete is deliberately unchanged. Scoped to
  // event_type === 'task' — completed appointments remain editable.
  const isCompletedTask = event.event_type === 'task' && !!event.completed_at;

  const isMedication = event.event_type === 'medication';
  const isDiscontinued = !locallyReactivated && !!event.discontinued_at;

  // "Still waiting on a human" — shared with TodaysMeds via utils/medicationDose
  // so the two surfaces cannot disagree about the same dose (they did: this one
  // asked, that one did not).
  const needsAnswer = doseNeedsAnswer(event.confirmation);
  // Never offer to log a dose that has not come around yet: that writes a
  // falsified adherence record into the report a clinician may read. The gate
  // is `isDoseConfirmable` — mobile's predicate, ported verbatim into
  // utils/timezone.ts — NOT a day-granularity check: at noon, "the day has
  // arrived" put a live Mark taken on an 8 PM dose. It opens
  // DOSE_EARLY_CONFIRM_WINDOW_MINUTES (2h) before the scheduled moment,
  // because caregivers really do give the 9 PM dose at 8:30, and stays open
  // for anything overdue today or unanswered from a past day.
  // All-day medication rows (no scheduled_time) stay excluded here — the
  // confirm endpoint requires a scheduled_time — so the `!!scheduled_time`
  // guard is kept ALONGSIDE the predicate rather than folded into it
  // (isDoseConfirmable deliberately allows timeless doses on their own day).
  const doseWithinConfirmWindow =
    !!event.scheduled_time &&
    isDoseConfirmable(event.scheduled_date, event.scheduled_time, careRecipientTimezone);
  // NOTE the absence of `discontinued_at`: a dose the calendar shows is a dose
  // the backend already found due, inactive medication or not. See the header.
  const canConfirmDose = isMedication && needsAnswer && doseWithinConfirmWindow;

  async function handleComplete(): Promise<void> {
    try {
      await completeEvent.mutateAsync(event.id);
      showToast(t('eventDetail.completedToast'), 'success');
    } catch {
      // useCompleteEvent surfaces its own toasts.
    }
  }

  async function handleReactivateForEdit(): Promise<void> {
    try {
      // WHOLE-MEDICATION semantics in ONE request. Every discontinue path stops
      // EVERY series sharing normalized name + dosage — one drug at 08:00 and
      // 20:00 is two parent rows — so the reactivate that answers Edit has to
      // bring all of them back. This used to fan out one PATCH per root
      // enumerated from the loaded calendar WINDOW, which could not see a
      // sibling series scheduled outside it: the medication came back
      // half-reactivated under a success toast. `scope: 'medication'` hands the
      // resolution to the server, which matches on the same name+dosage key
      // with no window at all. Passing any instance id is safe (the backend
      // resolves the root), but the root is what we mean.
      const result = await medicationStatus.mutateAsync({
        eventId: getSeriesRoot(event),
        discontinued: false,
        scope: 'medication',
      });
      // CONFIRMED SUCCESS only, and fired exactly ONCE for the whole action.
      // `series_count` is the SERVER's count of roots actually mutated — the
      // client has no trustworthy number of its own. `capture` is non-throwing,
      // so it cannot divert into the catch below.
      Analytics.medicationReactivated(circleId, {
        surface: 'calendar',
        seriesCount: result.series_count ?? 0,
      });
      // Plainly true now: the whole medication is back, every series of it, so
      // the toast no longer has to hedge about schedules outside the window.
      showToast(t('discontinueMed.reactivatedToast'), 'success');
      setLocallyReactivated(true);
      onReactivated?.();
    } catch {
      // useMedicationStatus surfaces its own permission/subscription/save toasts.
    } finally {
      setShowInactiveEditPrompt(false);
    }
  }

  return (
    <div className="flex flex-wrap justify-end gap-3">
      {canComplete && (
        <Button
          variant="primary"
          disabled={completeEvent.isPending}
          onClick={() => void handleComplete()}
        >
          {t('eventDetail.markComplete')}
        </Button>
      )}
      {canConfirmDose && (
        <>
          <Button variant="ghost" onClick={() => onConfirmDose('skipped')}>
            {t('eventDetail.skipDose')}
          </Button>
          <Button variant="primary" onClick={() => onConfirmDose('taken')}>
            {t('eventDetail.markTaken')}
          </Button>
        </>
      )}
      {!isCompletedTask && (
        <Button
          variant="ghost"
          onClick={() => {
            // Inactive meds prompt to reactivate instead of opening the editor.
            if (isMedication && isDiscontinued) {
              setShowInactiveEditPrompt(true);
            } else {
              onEdit();
            }
          }}
        >
          {t('addEvent.editTitle')}
        </Button>
      )}
      {isMedication && (
        <Button variant="ghost" onClick={onDiscontinue}>
          {isDiscontinued
            ? t('discontinueMed.reactivate')
            : t('discontinueMed.discontinue')}
        </Button>
      )}
      <Button variant="terracotta" onClick={onDelete}>
        {t('deleteEvent.delete')}
      </Button>

      {showInactiveEditPrompt && (
        <ConfirmDialog
          title={t('discontinueMed.editInactiveTitle')}
          message={t('discontinueMed.editInactiveMessage')}
          confirmLabel={
            medicationStatus.isPending
              ? t('discontinueMed.working')
              : t('discontinueMed.reactivate')
          }
          cancelLabel={t('common:cancel')}
          closeLabel={t('discontinueMed.close')}
          confirmDisabled={medicationStatus.isPending}
          onConfirm={() => void handleReactivateForEdit()}
          onCancel={() => setShowInactiveEditPrompt(false)}
        />
      )}
    </div>
  );
}
