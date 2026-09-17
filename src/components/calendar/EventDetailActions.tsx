import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent } from '@/api/calendarEvents';
import { Button, ConfirmDialog, MoreMenu, useToast, type MoreMenuItem } from '@/components/ui';
import { useCompleteEvent, useMedicationStatus } from '@/hooks/useCalendarEvents';
import { useGuardedSubmit } from '@/hooks/useGuardedSubmit';
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
//
// FOOTER CONVENTION (M2): one filled button, last in DOM order; Edit /
// Discontinue-Reactivate / Delete are SECONDARY actions and live inside a
// `MoreMenu` (Delete always `danger`) rather than as a row of ghost buttons —
// Delete in particular must never render filled at rest. When only ONE of
// those secondary actions would exist (a completed task: Edit is hidden by
// the guard above, leaving only Delete), a one-item menu is pointless — that
// single action renders inline instead, far-left, as a `ghost` button with the
// terracotta-deep warning colour when it is Delete, or a plain `ghost`
// otherwise. Every handler, confirm dialog, and analytics
// call below is unchanged; only where the buttons for Edit/Discontinue/Delete
// render moved.

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
  /**
   * Called after `handleComplete` succeeds, in ADDITION to this component's own
   * local override below, with THE ROW THE SERVER STAMPED (the mutation's
   * response, `completed_at` guaranteed non-null). Wire this to refresh the
   * parent's event snapshot — the detail modal's "Completed on / Completed by"
   * row reads `event.completed_at` off that same stale snapshot, so without it
   * a completion that really persisted only appears after a close/reopen.
   *
   * WHY THE RETURNED ROW AND NOT THE QUERY CACHE. Completing an occurrence past
   * the materializer's horizon makes the server CREATE a physical row for that
   * day, and the id the client posted was the SERIES ROOT — so there is no
   * `calendarEvent(circleId, <posted id>)` cache entry describing the
   * occurrence on screen, and invalidating one cannot produce it. The response
   * is the only source that describes what was actually written.
   */
  onCompleted?: (completed: CalendarEvent) => void;
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
  onCompleted,
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
  // Same class of bug as `locallyReactivated`, same shape of fix: once THIS
  // component has successfully completed the event, its own action set has to
  // reflect that immediately — Mark complete must stop offering a second
  // completion of a row that is already stamped, and a completed TASK's Edit
  // must disappear (completion is terminal) — rather than waiting on a parent
  // that may never refresh the snapshot it handed down. `onCompleted` below
  // covers what this component does NOT render: the modal's own "Completed"
  // row, which is drawn from the parent's copy of the same object.
  const [locallyCompletedAt, setLocallyCompletedAt] = useState<string | null>(null);

  // WCAG 2.4.3 (focus order) / 2.1.2 (no keyboard trap escape). Mark complete
  // is the ONLY control in this row that unmounts while the detail modal STAYS
  // OPEN — Edit, Delete, Discontinue and the two dose confirms all close the
  // modal, and Modal's own cleanup restores focus to the trigger on the way out
  // (`previouslyFocused?.focus()`, Modal.tsx). Here nothing closes: the instant
  // the completion commits, `canComplete` is false, React removes the button
  // that HAD focus, and focus falls to `document.body`.
  //
  // That is not merely untidy — Modal binds its key handling as
  // `onKeyDown` ON THE DIALOG DIV, not on `document`, so a React synthetic
  // event only reaches it when the event target is inside that subtree. With
  // `document.body` focused, Escape stops closing the dialog and the Tab trap
  // dies, dropping the next Tab into the page behind the backdrop (which is
  // NOT `aria-hidden` or `inert` — `aria-modal="true"` is the only background
  // suppression the shell has; see Modal.tsx). Modal's focus effect
  // deliberately runs once, on open ("re-running would steal focus back
  // mid-edit"); its `focusout` + MutationObserver recovery would now pull
  // focus back to the dialog PANEL, which is a floor rather than the right
  // answer — the row below moves it somewhere meaningful instead.
  //
  // The fix is the one this codebase already uses for the same class of bug in
  // NoteRow (a focused control unmounted by its own activation): move focus
  // explicitly, to the region that changed. This ROW is that region, so it is
  // the landing spot — `tabIndex={-1}` below makes it programmatically
  // focusable without adding a tab stop, and it is excluded from Modal's
  // FOCUSABLE_SELECTOR (`[tabindex]:not([tabindex="-1"])`), so the trap's
  // first/last calculation is unchanged.
  //
  // NOT the now-inline Delete: parking focus on a destructive control after a
  // successful action arms an accidental Space/Enter on the one action here
  // that cannot be undone. NOT a disabled button left in place either — a
  // browser BLURS an element the moment it becomes disabled, so focus would
  // land on `document.body` exactly as it does now (jsdom does not, which is
  // precisely how that "fix" would pass a test and still ship the bug), and a
  // disabled control is dropped from FOCUSABLE_SELECTOR anyway.
  //
  // The state change itself is still announced: the success toast is an
  // `aria-live="polite"` region (Toast.tsx), so the user hears the completion
  // while focus lands on the row it changed.
  const actionsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Only the transition into a locally-stamped completion. An event that
    // arrived already completed never sets this, so nothing is stolen on mount.
    if (locallyCompletedAt === null) return;
    actionsRef.current?.focus();
  }, [locallyCompletedAt]);

  // THE FAILURE PATH LOSES FOCUS FOR THE SAME REASON, AND RECOVERED NOTHING.
  //
  // The reasoning above was applied only to the success case, but the blur it
  // describes happens on EVERY press: `disabled={completeEvent.isPending}`
  // lands the instant the request starts, and the browser blurs the button as
  // it becomes disabled. On success the button then unmounts and the effect
  // above lands focus on the row. On FAILURE the button re-enables, nothing
  // moves focus, and it stays on `document.body` — with the consequence spelled
  // out above: Modal's Escape/Tab handling is a React `onKeyDown` on its own
  // div, so from `<body>` Escape stops closing the dialog and the Tab trap is
  // dead (WCAG 2.1.2, 2.4.3).
  //
  // The landing spot here is THE BUTTON THE USER PRESSED, not the row: it is
  // still on screen, still the action they were trying to take, and the retry
  // is one Enter away. It is not destructive, so nothing is armed by parking
  // focus on it. The row stays as the fallback for the ordering where the
  // pending render has not been reverted yet (a disabled element cannot take
  // focus, and `.focus()` on one is a silent no-op that would leave focus on
  // `<body>`).
  //
  // A COUNTER, not a boolean: two consecutive failures are two separate
  // recoveries, and a boolean that is already `true` re-renders nothing and
  // never re-fires the effect.
  const completeButtonRef = useRef<HTMLButtonElement>(null);
  const [completeFailures, setCompleteFailures] = useState(0);
  useEffect(() => {
    if (completeFailures === 0) return;
    const button = completeButtonRef.current;
    if (button && !button.disabled) {
      button.focus();
      return;
    }
    actionsRef.current?.focus();
  }, [completeFailures]);

  // The completion instant as it stands RIGHT NOW: the local stamp wins
  // because it is strictly newer than the snapshot prop.
  const completedAt = locallyCompletedAt ?? event.completed_at ?? null;

  const canComplete =
    (event.event_type === 'task' || event.event_type === 'appointment') && !completedAt;

  // COMPLETED TASKS ARE LOCKED (founder directive): once a task's completion
  // has persisted, its Edit affordance is hidden — same shape as canComplete
  // disappearing above, and mirrors the TasksPage row and mobile's calendar
  // detail modal. Keyed on completed_at alone so a task that were re-opened
  // becomes editable again. Delete is deliberately unchanged. Scoped to
  // event_type === 'task' — completed appointments remain editable.
  const isCompletedTask = event.event_type === 'task' && !!completedAt;

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
      // A VIRTUAL OCCURRENCE — AND ONLY A VIRTUAL ONE — IS ADDRESSED BY ITS
      // ROOT PLUS ITS DATE.
      //
      // The backend synthesises the calendar's later occurrences with a
      // composite id (`${parentId}_${date}`, `is_virtual: true`) that matches
      // no row, so posting `event.id` for one of those could only 404. There is
      // nothing else to send: the root plus the day is the only address that
      // names it.
      //
      // EVERY PHYSICAL ROW IS POSTED BY ITS OWN ID, materialized children
      // included. Routing a child through its root is NOT equivalent: the
      // server's occurrence resolution is gated on the addressed row still
      // recurring (`backend/src/routes/calendarEvents.ts`:
      // `if (addressed.recurrence_rule && !addressed.parent_event_id)`). Clear
      // the rule — "Repeat: Never" in the editor — and that whole block is
      // skipped, leaving `targetEventId = eventId`, so the PARENT row on a
      // DIFFERENT DAY gets stamped completed and the occurrence on screen stays
      // open. `pruneOffPatternFutureChildren` deletes only FUTURE off-pattern
      // children, so the past ones survive that edit and the calendar keeps
      // drawing them. `is_virtual` is therefore the discriminator, not "does
      // this row carry a parent_event_id" — a physical child carries one and is
      // still its own occurrence.
      //
      // ABSENT MEANS PHYSICAL. `is_virtual` is optional on the wire
      // (`api/calendarEvents.ts`) and real rows may arrive without it, so the
      // test is `=== true`, never a truthiness read of a possibly-missing flag.
      const isVirtualOccurrence = event.is_virtual === true;
      const targetEventId = isVirtualOccurrence ? (event.parent_event_id ?? event.id) : event.id;
      // THE RESPONSE IS THE ONLY DESCRIPTION OF WHAT WAS WRITTEN. The complete
      // route returns the stamped row (`.select().single()`), and for a virtual
      // occurrence past the materializer horizon that row was CREATED by this
      // request — a different id from anything the client has ever seen, under
      // no cache key it could invalidate. So the completion is read off the
      // response rather than re-fetched.
      const completed = await completeEvent.mutateAsync({
        eventId: targetEventId,
        // Sent for the virtual case ONLY — it is the half of the address that
        // says WHICH day. A physical row needs no disambiguation, and sending
        // one for it made every materialized child's request differ from the
        // one-off request for no reason. (`targetEventId !== event.id` used to
        // stand in for `is_virtual` here; it is an identity test, not a
        // discriminator.)
        scheduledDate: isVirtualOccurrence ? event.scheduled_date : undefined,
      });
      // `completed_at` is what every "is this done?" read in the UI keys on, so
      // it must not be left empty by a response that omitted it: the write
      // succeeded, and the exact millisecond is cosmetic next to that.
      const stampedAt = completed?.completed_at ?? new Date().toISOString();
      showToast(t('eventDetail.completedToast'), 'success');
      setLocallyCompletedAt(stampedAt);
      onCompleted?.({ ...completed, completed_at: stampedAt });
    } catch {
      // useCompleteEvent surfaces its own toasts. What it cannot do is put
      // focus back — the button that had it was blurred by the browser the
      // moment it went `disabled`. See the effect above.
      setCompleteFailures((count) => count + 1);
    }
  }

  // THE SYNCHRONOUS DOUBLE-SUBMIT GUARD. `completeEvent.isPending` below is the
  // VISUAL guard only: it is state, committed a render AFTER the click, so two
  // clicks dispatched in the same tick both re-enter `handleComplete` with the
  // flag still false and the button not yet disabled — the exact pattern
  // `useGuardedSubmit`'s docstring was written to condemn. The second POST is
  // harmless server-side (the route resolves it to the same row, and handles
  // the 23505 race), but `Analytics.taskCompleted` / `appointmentCompleted`
  // fires twice, and completion counts are this product's retention signal.
  // `handleComplete` awaits the request, so the first (promise-holding) form of
  // the hook is the right one: the guard is held for exactly as long as the
  // request is in flight.
  const guardedComplete = useGuardedSubmit(handleComplete);

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

  function handleEditClick(): void {
    // Inactive meds prompt to reactivate instead of opening the editor.
    if (isMedication && isDiscontinued) {
      setShowInactiveEditPrompt(true);
    } else {
      onEdit();
    }
  }

  // Secondary actions — Edit, Discontinue/Reactivate (medications only), and
  // Delete (always, always `danger`) — in this fixed order. Built as data so
  // the "only one left" case below can render it inline without duplicating
  // any handler.
  const overflowItems: MoreMenuItem[] = [];
  if (!isCompletedTask) {
    overflowItems.push({ id: 'edit', label: t('addEvent.editTitle'), onSelect: handleEditClick });
  }
  if (isMedication) {
    overflowItems.push({
      id: 'discontinue',
      label: isDiscontinued ? t('discontinueMed.reactivate') : t('discontinueMed.discontinue'),
      onSelect: onDiscontinue,
    });
  }
  overflowItems.push({
    id: 'delete',
    label: t('deleteEvent.delete'),
    onSelect: onDelete,
    danger: true,
  });

  // A one-item menu is pointless — render that single action inline instead
  // of behind a click. It goes far-left (`mr-auto` in a `justify-end` row),
  // matching the destructive-far-left placement the convention uses when
  // there's no menu to put it in.
  const soloOverflowItem = overflowItems.length === 1 ? overflowItems[0] : null;
  const useOverflowMenu = overflowItems.length >= 2;

  return (
    <div ref={actionsRef} tabIndex={-1} className="flex flex-wrap items-center justify-end gap-3">
      {soloOverflowItem && (
        <Button
          variant="ghost"
          onClick={soloOverflowItem.onSelect}
          className={
            soloOverflowItem.danger
              ? 'mr-auto text-terracotta-deep hover:bg-terracotta-soft'
              : 'mr-auto'
          }
        >
          {soloOverflowItem.label}
        </Button>
      )}
      {canConfirmDose && (
        <Button variant="secondary" onClick={() => onConfirmDose('skipped')}>
          {t('eventDetail.skipDose')}
        </Button>
      )}
      {canComplete && (
        <Button
          ref={completeButtonRef}
          variant="primary"
          disabled={completeEvent.isPending}
          onClick={() => void guardedComplete()}
        >
          {t('eventDetail.markComplete')}
        </Button>
      )}
      {canConfirmDose && (
        <Button variant="primary" onClick={() => onConfirmDose('taken')}>
          {t('eventDetail.markTaken')}
        </Button>
      )}
      {useOverflowMenu && <MoreMenu items={overflowItems} />}

      {showInactiveEditPrompt && (
        <ConfirmDialog
          icon="repeat-outline"
          iconTone="moss"
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
