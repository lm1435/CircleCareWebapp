import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent } from '@/api/calendarEvents';
import { Button, ConfirmDialog, useToast } from '@/components/ui';
import { useCompleteEvent, useMedicationStatus } from '@/hooks/useCalendarEvents';

// Task 1.6 — the Edit / Delete / Complete action set rendered in the
// EventDetailModal `editActions` slot (gated on canEdit upstream). Complete is
// only offered for task/appointment events (mobile parity). Edit/Delete raise
// callbacks to the page, which OWNS the edit/delete modal state — that modal
// must outlive the detail modal it was launched from.
//
// GUARD (mobile parity): an INACTIVE (discontinued) medication cannot be
// edited in place. Edit on one prompts to reactivate first; confirming runs
// the reactivate (backend resolves this event's series root) without opening
// the editor — same behavior as mobile's MedicationHistoryScreen.

export interface EventDetailActionsProps {
  circleId: string;
  event: CalendarEvent;
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
  onEdit,
  onDelete,
  onDiscontinue,
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
      await medicationStatus.mutateAsync({ eventId: event.id, discontinued: false });
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
