import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent, EventType } from '@/api/calendarEvents';
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
// deleted?") rather than reusing the dialog title ("Delete medication" etc.) a second
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
  /**
   * Whether `event` IS the dose/occurrence the user picked (default `true`).
   *
   * The "This dose only / This and all future" picker anchors on
   * `event.scheduled_date`, which is only a real choice when the user tapped
   * that occurrence (the calendar). A Meds page CARD passes its group's
   * REPRESENTATIVE row — the series root, whose date is the START date the
   * caregiver never saw — so "future" deleted the whole medication and "single"
   * removed the recorded start-date dose (test-gap audit #1, proven live).
   *
   * `false` (a card) skips the picker and goes to the whole-medication confirm
   * that says the recorded history goes too, plus the Discontinue hint; the
   * DELETE targets the series root with NO scope and NO date. Mirrors mobile's
   * `useMedicationActions` `doseScoped` (2026-09-27).
   */
  doseScoped?: boolean;
  onClose: () => void;
  /** Called after a successful delete (parent typically closes the detail modal). */
  onDeleted?: () => void;
}

type DeleteScopeChoice = 'single' | 'future';

/** The per-type half of the dialog's copy (see `copyByType` below). */
interface DeleteCopy {
  title: string;
  scopeSingle: string;
  scopeFuture: string;
  deleted: string;
}

export function DeleteEventDialog({
  circleId,
  event,
  surface,
  doseScoped = true,
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

  // Every item type names itself: a medication says "medication"/"dose", a
  // task "task", an appointment "appointment" — never the generic "event"
  // (matches mobile). Only the title, the two scope options and the success
  // toast are per-type; the messages, scope label, buttons and close label stay
  // shared in `deleteEvent.*`, whose own title/scope/toast are the fallback for
  // a missing or unknown `event_type`. LITERAL keys, not a built template, so
  // every one is resolved by the static translation-key scan.
  const copyByType: Record<EventType, DeleteCopy> = {
    medication: {
      title: t('deleteMedication.title'),
      scopeSingle: t('deleteMedication.scopeSingle'),
      scopeFuture: t('deleteMedication.scopeFuture'),
      deleted: t('deleteMedication.deleted'),
    },
    task: {
      title: t('deleteTask.title'),
      scopeSingle: t('deleteTask.scopeSingle'),
      scopeFuture: t('deleteTask.scopeFuture'),
      deleted: t('deleteTask.deleted'),
    },
    appointment: {
      title: t('deleteAppointment.title'),
      scopeSingle: t('deleteAppointment.scopeSingle'),
      scopeFuture: t('deleteAppointment.scopeFuture'),
      deleted: t('deleteAppointment.deleted'),
    },
  };
  const copy: DeleteCopy = copyByType[event.event_type] ?? {
    title: t('deleteEvent.title'),
    scopeSingle: t('deleteEvent.scopeSingle'),
    scopeFuture: t('deleteEvent.scopeFuture'),
    deleted: t('deleteEvent.deleted'),
  };

  async function runDelete(options: Parameters<typeof deleteEvent.mutateAsync>[0]): Promise<void> {
    try {
      const result = await deleteEvent.mutateAsync(options);
      // CONFIRMED SUCCESS only, and MEDICATIONS only. No `deleteScope` means no
      // scope picker was shown (non-recurring), so the single record IS the
      // whole series. `capture` is non-throwing, so this cannot divert into the
      // catch below and report a successful delete as a failure.
      if (event.event_type === 'medication' && surface) {
        Analytics.medicationDeleted(circleId, {
          surface,
          scope: options.deleteScope ?? 'series',
          historyKept: result?.historyKept,
        });
      }
      showToast(copy.deleted, 'success');
      onDeleted?.();
      onClose();
    } catch {
      // useDeleteEvent surfaces its own permission/subscription/save toasts.
    }
  }

  if (!doseScoped) {
    // WHOLE-MEDICATION delete (a Meds page card). No picker, no date: the
    // server resolves the whole series from its root id alone. Never
    // `event.scheduled_date` here — on a card that is a day nobody chose.
    // PK3: the copy says the recorded doses stay in the adherence reports (the backend
    // keeps them when any were recorded, and hard-deletes a med with none), and points at
    // Discontinue for a med the caregiver wants to keep in the Inactive list.
    return (
      <ConfirmDialog
        title={copy.title}
        message={
          <div className="flex flex-col gap-3">
            <p className="m-0 text-base text-ink-2">
              {t('deleteMedication.wholeMessage', { title })}
            </p>
            <p className="m-0 text-base text-ink-2">{t('deleteMedication.discontinueHint')}</p>
          </div>
        }
        confirmLabel={t('deleteEvent.delete')}
        cancelLabel={t('common:cancel')}
        closeLabel={t('deleteEvent.close')}
        destructive
        loading={deleteEvent.isPending}
        loadingLabel={t('deleteEvent.deleting')}
        // Returned, not discarded — see the non-recurring branch below.
        onConfirm={() => runDelete({ eventId: targetEventId })}
        onCancel={onClose}
      />
    );
  }

  if (!isRecurring) {
    return (
      <ConfirmDialog
        title={copy.title}
        message={t('deleteEvent.confirmMessage', { title })}
        confirmLabel={t('deleteEvent.delete')}
        cancelLabel={t('common:cancel')}
        closeLabel={t('deleteEvent.close')}
        destructive
        loading={deleteEvent.isPending}
        loadingLabel={t('deleteEvent.deleting')}
        // The PROMISE is returned, not discarded: `ConfirmDialog` holds its
        // double-submit guard for as long as it is pending, so a second press
        // is refused for the whole request rather than only for the tick.
        onConfirm={() => runDelete({ eventId: event.id })}
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
      title={copy.title}
      message={
        <div className="flex flex-col gap-4">
          <p className="m-0 text-base text-ink-2">{t('deleteEvent.recurringMessage', { title })}</p>
          <RadioGroup
            label={t('deleteEvent.scopeLabel')}
            value={scope}
            onChange={(value) => setScope(value as DeleteScopeChoice)}
            options={[
              { value: 'single', label: copy.scopeSingle },
              { value: 'future', label: copy.scopeFuture },
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
      // Returned, not discarded — see the non-recurring branch above. This is
      // the path that matters most: delete-one-occurrence is one of the three
      // backend routes that insert against the partial unique index with no
      // 23505 recovery, so a second DELETE that races the first is answered
      // with a 500 over a delete that already worked.
      onConfirm={() =>
        runDelete({
          eventId: targetEventId,
          deleteScope: scope,
          scheduledDate: event.scheduled_date,
        })
      }
      onCancel={onClose}
    />
  );
}
