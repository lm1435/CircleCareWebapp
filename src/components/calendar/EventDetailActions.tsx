import { type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent } from '@/api/calendarEvents';
import { Button, useToast } from '@/components/ui';
import { useCompleteEvent } from '@/hooks/useCalendarEvents';

// Task 1.6 — the Edit / Delete / Complete action set rendered in the
// EventDetailModal `editActions` slot (gated on canEdit upstream). Complete is
// only offered for task/appointment events (mobile parity). Edit/Delete raise
// callbacks to the page, which OWNS the edit/delete modal state — that modal
// must outlive the detail modal it was launched from.

export interface EventDetailActionsProps {
  circleId: string;
  event: CalendarEvent;
  /** Open the edit form for this event (page closes the detail modal first). */
  onEdit: () => void;
  /** Open the delete dialog for this event. */
  onDelete: () => void;
}

export function EventDetailActions({
  circleId,
  event,
  onEdit,
  onDelete,
}: EventDetailActionsProps): ReactElement {
  const { t } = useTranslation(['calendar', 'common']);
  const { showToast } = useToast();
  const completeEvent = useCompleteEvent(circleId);

  const canComplete =
    (event.event_type === 'task' || event.event_type === 'appointment') && !event.completed_at;

  async function handleComplete(): Promise<void> {
    try {
      await completeEvent.mutateAsync(event.id);
      showToast(t('addEvent.updated'), 'success');
    } catch {
      // useCompleteEvent surfaces its own toasts.
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
          {t('common:confirm')}
        </Button>
      )}
      <Button variant="ghost" onClick={onEdit}>
        {t('addEvent.editTitle')}
      </Button>
      <Button variant="terracotta" onClick={onDelete}>
        {t('deleteEvent.delete')}
      </Button>
    </div>
  );
}
