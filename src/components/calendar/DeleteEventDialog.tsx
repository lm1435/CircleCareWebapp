import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent } from '@/api/calendarEvents';
import { useDeleteEvent } from '@/hooks/useCalendarEvents';
import { Button, ConfirmDialog, Modal, RadioGroup, useToast } from '@/components/ui';

// Task 1.5 — delete an event. MIRRORS mobile's scoped-delete semantics:
//   - Non-recurring → a simple confirm, DELETE with no scope params.
//   - Recurring → a 3-way choice (this event only / this & future / cancel) →
//     DELETE .../events/:eventId?deleteScope=single|future&scheduledDate=.
// The scoped DELETE always targets the PARENT series id (parent_event_id || id)
// and passes the INSTANCE's scheduled_date so the backend can split the series.

export interface DeleteEventDialogProps {
  circleId: string;
  event: CalendarEvent;
  onClose: () => void;
  /** Called after a successful delete (parent typically closes the detail modal). */
  onDeleted?: () => void;
}

type DeleteScopeChoice = 'single' | 'future';

export function DeleteEventDialog({
  circleId,
  event,
  onClose,
  onDeleted,
}: DeleteEventDialogProps): ReactElement {
  const { t } = useTranslation(['calendar', 'common']);
  const { showToast } = useToast();
  const deleteEvent = useDeleteEvent(circleId);

  const isRecurring = !!event.recurrence_rule || !!event.parent_event_id;
  const [scope, setScope] = useState<DeleteScopeChoice>('single');

  // Deletes target the parent series; pass the instance's scheduled_date.
  const targetEventId = event.parent_event_id || event.id;
  const title = event.medication_name || event.title;

  async function runDelete(options: Parameters<typeof deleteEvent.mutateAsync>[0]): Promise<void> {
    try {
      await deleteEvent.mutateAsync(options);
      showToast(t('deleteEvent.deleted'), 'success');
      onDeleted?.();
      onClose();
    } catch {
      // useDeleteEvent surfaces its own permission/subscription/save toasts.
    }
  }

  if (!isRecurring) {
    return (
      <ConfirmDialog
        title={t('deleteEvent.title')}
        message={t('deleteEvent.confirmMessage', { title })}
        confirmLabel={deleteEvent.isPending ? t('deleteEvent.deleting') : t('deleteEvent.delete')}
        cancelLabel={t('common:cancel')}
        closeLabel={t('deleteEvent.close')}
        destructive
        confirmDisabled={deleteEvent.isPending}
        onConfirm={() => void runDelete({ eventId: event.id })}
        onCancel={onClose}
      />
    );
  }

  return (
    <Modal
      title={t('deleteEvent.title')}
      onClose={onClose}
      closeLabel={t('deleteEvent.close')}
      size="sm"
      closeOnBackdropClick={false}
      footer={
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose} disabled={deleteEvent.isPending}>
            {t('common:cancel')}
          </Button>
          <Button
            variant="terracotta"
            disabled={deleteEvent.isPending}
            onClick={() =>
              void runDelete({
                eventId: targetEventId,
                deleteScope: scope,
                scheduledDate: event.scheduled_date,
              })
            }
          >
            {deleteEvent.isPending ? t('deleteEvent.deleting') : t('deleteEvent.delete')}
          </Button>
        </div>
      }
    >
      <p className="m-0 text-base text-ink-2">{t('deleteEvent.recurringMessage', { title })}</p>
      <RadioGroup
        label={t('deleteEvent.title')}
        value={scope}
        onChange={(value) => setScope(value as DeleteScopeChoice)}
        options={[
          { value: 'single', label: t('deleteEvent.scopeSingle') },
          { value: 'future', label: t('deleteEvent.scopeFuture') },
        ]}
      />
    </Modal>
  );
}
