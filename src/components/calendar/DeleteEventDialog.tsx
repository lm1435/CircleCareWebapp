import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent } from '@/api/calendarEvents';
import { useDeleteEvent } from '@/hooks/useCalendarEvents';
import { ConfirmDialog, RadioGroup, useToast } from '@/components/ui';
import { Analytics, type MedicationLifecycleSurface } from '@/lib/analytics';

// Task 1.5 — delete an event. MIRRORS mobile's scoped-delete semantics:
//   - Non-recurring → a simple confirm, DELETE with no scope params.
//   - Recurring → a 3-way choice (this event only / this & future / cancel) →
//     DELETE .../events/:eventId?deleteScope=single|future&scheduledDate=.
// The scoped DELETE always targets the PARENT series id (parent_event_id || id)
// and passes the INSTANCE's scheduled_date so the backend can split the series.
//
// M2: both paths now render through the SAME `ConfirmDialog` footer shape
// (one filled destructive button, one ghost cancel) instead of the recurring
// path hand-rolling its own `Modal` + footer. The scope picker is the
// `RadioGroup` `EditCirclePage` already uses — passed as the ReactNode
// `message` — with its OWN label (`deleteEvent.scopeLabel`, "What should be
// deleted?") rather than reusing the dialog title ("Delete event") a second
// time as the group's accessible name: reusing it gave the dialog two
// headings that said the same thing.

export interface DeleteEventDialogProps {
  circleId: string;
  event: CalendarEvent;
  /**
   * Which page raised this dialog. Analytics only — the breakdown key on
   * `medication_deleted`. This dialog also deletes tasks/appointments, which
   * stay uninstrumented (a separate question), so the event is emitted only for
   * `event_type === 'medication'`.
   *
   * `null` for a surface that can only ever delete a non-medication (the Tasks
   * page). That is deliberately not a made-up member of
   * `MedicationLifecycleSurface` — the enum mirrors mobile's and must keep
   * meaning "a surface where medications live", so a value there would corrupt
   * the breakdown the moment someone did emit from it.
   */
  surface: MedicationLifecycleSurface | null;
  onClose: () => void;
  /** Called after a successful delete (parent typically closes the detail modal). */
  onDeleted?: () => void;
}

type DeleteScopeChoice = 'single' | 'future';

export function DeleteEventDialog({
  circleId,
  event,
  surface,
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
      // CONFIRMED SUCCESS only, and MEDICATIONS only. No `deleteScope` means no
      // scope picker was shown (non-recurring), so the single record IS the
      // whole series. `capture` is non-throwing, so this cannot divert into the
      // catch below and report a successful delete as a failure.
      if (event.event_type === 'medication' && surface) {
        Analytics.medicationDeleted(circleId, {
          surface,
          scope: options.deleteScope ?? 'series',
        });
      }
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
        confirmLabel={t('deleteEvent.delete')}
        cancelLabel={t('common:cancel')}
        closeLabel={t('deleteEvent.close')}
        destructive
        loading={deleteEvent.isPending}
        loadingLabel={t('deleteEvent.deleting')}
        onConfirm={() => void runDelete({ eventId: event.id })}
        onCancel={onClose}
      />
    );
  }

  // Recurring: the same ConfirmDialog shape, with the intro sentence + scope
  // RadioGroup passed as the (ReactNode) message. A ReactNode message renders
  // full-width/left-aligned rather than the centered short-copy treatment, so
  // the picker isn't squeezed.
  return (
    <ConfirmDialog
      title={t('deleteEvent.title')}
      message={
        <div className="flex flex-col gap-4">
          <p className="m-0 text-base text-ink-2">{t('deleteEvent.recurringMessage', { title })}</p>
          <RadioGroup
            label={t('deleteEvent.scopeLabel')}
            value={scope}
            onChange={(value) => setScope(value as DeleteScopeChoice)}
            options={[
              { value: 'single', label: t('deleteEvent.scopeSingle') },
              { value: 'future', label: t('deleteEvent.scopeFuture') },
            ]}
          />
        </div>
      }
      confirmLabel={t('deleteEvent.delete')}
      cancelLabel={t('common:cancel')}
      closeLabel={t('deleteEvent.close')}
      destructive
      loading={deleteEvent.isPending}
      loadingLabel={t('deleteEvent.deleting')}
      onConfirm={() =>
        void runDelete({
          eventId: targetEventId,
          deleteScope: scope,
          scheduledDate: event.scheduled_date,
        })
      }
      onCancel={onClose}
    />
  );
}
