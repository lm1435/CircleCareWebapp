import { type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent } from '@/api/calendarEvents';
import { useMedicationStatus } from '@/hooks/useCalendarEvents';
import { getSeriesRootsForMed } from '@/utils/medicationGrouping';
import { ConfirmDialog, useToast } from '@/components/ui';

// Stage 4 (Web) — discontinue / reactivate a medication. A LIGHTER confirm than
// delete: discontinue keeps the record for reference but stops reminders +
// materialization (the med drops out of the default Calendar GET). Reactivate
// clears it. Reversible either way, so the confirm is NON-destructive (primary
// button, not the terracotta destructive variant DeleteEventDialog uses).
//
// WHOLE-MEDICATION semantics (mobile parity): the action targets EVERY series
// of this medication (same normalized name + dosage), e.g. an 08:00 series AND
// a 20:00 series toggle together. `events` supplies the loaded events used to
// resolve the distinct roots; the tapped event's own root is always included,
// so the dialog still works when `events` is missing or partial. Each PATCH
// resolves its own series root server-side (any instance id is safe).

export interface DiscontinueMedDialogProps {
  circleId: string;
  event: CalendarEvent;
  /**
   * Loaded events (calendar window or medication roster) used to resolve every
   * series root of this medication. Optional — omitting it degrades to the
   * tapped event's own series only.
   */
  events?: CalendarEvent[];
  /**
   * Explicit direction override (WA3). Pass the caller's aggregate/group
   * "inactive" flag when the tapped `event` is only a REPRESENTATIVE of a
   * whole-medication group (e.g. MedicationsPage's MedGroup) — the
   * representative's own `discontinued_at` can disagree with the group's
   * overall state in a mixed-state group (one series discontinued, a sibling
   * series of the same name+dose still active), which previously made the
   * dialog silently REACTIVATE when the user had clicked "Discontinue" on an
   * overall-active card. When omitted, direction derives from
   * `event.discontinued_at` as before — correct for single-event callers
   * (e.g. the Calendar detail flow) where there is no group to disagree with.
   */
  groupInactive?: boolean;
  onClose: () => void;
  /** Called after a successful status change (parent closes the detail modal). */
  onChanged?: () => void;
}

export function DiscontinueMedDialog({
  circleId,
  event,
  events,
  groupInactive,
  onClose,
  onChanged,
}: DiscontinueMedDialogProps): ReactElement {
  const { t } = useTranslation(['calendar', 'common']);
  const { showToast } = useToast();
  const medicationStatus = useMedicationStatus(circleId);

  const isDiscontinued = groupInactive ?? !!event.discontinued_at;
  // Requesting the OPPOSITE of the current state.
  const discontinue = !isDiscontinued;
  const title = event.medication_name || event.title;

  async function handleConfirm(): Promise<void> {
    try {
      // One PATCH per DISTINCT series root of this medication (name + dose).
      const roots = getSeriesRootsForMed(events, event);
      await Promise.all(
        roots.map((rootId) =>
          medicationStatus.mutateAsync({ eventId: rootId, discontinued: discontinue })
        )
      );
      showToast(
        discontinue
          ? t('discontinueMed.discontinuedToast')
          : t('discontinueMed.reactivatedToast'),
        'success'
      );
      onChanged?.();
      onClose();
    } catch {
      // useMedicationStatus surfaces its own permission/subscription/save toasts.
    }
  }

  return (
    <ConfirmDialog
      title={discontinue ? t('discontinueMed.title') : t('discontinueMed.reactivateTitle')}
      message={
        discontinue
          ? t('discontinueMed.confirmMessage', { title })
          : t('discontinueMed.reactivateMessage', { title })
      }
      confirmLabel={
        medicationStatus.isPending
          ? t('discontinueMed.working')
          : discontinue
            ? t('discontinueMed.discontinue')
            : t('discontinueMed.reactivate')
      }
      cancelLabel={t('common:cancel')}
      closeLabel={t('discontinueMed.close')}
      confirmDisabled={medicationStatus.isPending}
      onConfirm={() => void handleConfirm()}
      onCancel={onClose}
    />
  );
}
