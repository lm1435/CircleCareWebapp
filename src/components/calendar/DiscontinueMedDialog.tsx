import { type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent } from '@/api/calendarEvents';
import { useMedicationStatus } from '@/hooks/useCalendarEvents';
import { getMedSeriesAnalyticsFacts, getSeriesRoot } from '@/utils/medicationGrouping';
import { ConfirmDialog, useToast } from '@/components/ui';
import { Analytics, type MedicationLifecycleSurface } from '@/lib/analytics';

// Stage 4 (Web) — discontinue / reactivate a medication. A LIGHTER confirm than
// delete: discontinue keeps the record for reference but stops reminders +
// materialization (the med drops out of the default Calendar GET). Reactivate
// clears it. Reversible either way, so the confirm is NON-destructive (primary
// button, not the terracotta destructive variant DeleteEventDialog uses).
//
// WHOLE-MEDICATION semantics (mobile parity): the action targets EVERY series
// of this medication (same normalized name + dosage), e.g. an 08:00 series AND
// a 20:00 series toggle together. That resolution happens SERVER-side, in one
// request with `scope: 'medication'` — the client used to enumerate the roots
// from its loaded pool, which meant a series outside the loaded calendar window
// silently kept its old state under a success toast. `events` is now analytics
// only (days_active / had_confirmations); it is never load-bearing for the
// mutation, and its absence changes nothing about what gets toggled.

/** Project-wide documented fallback when a circle has no timezone resolved. */
const DEFAULT_TIMEZONE = 'America/New_York';

export interface DiscontinueMedDialogProps {
  circleId: string;
  event: CalendarEvent;
  /**
   * Loaded events (calendar window or medication roster). ANALYTICS ONLY — they
   * bound `days_active` (earliest known scheduled date) and `had_confirmations`
   * (an honest lower bound). The mutation itself never reads them: the server
   * resolves the medication's series roots. Optional throughout.
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
  /**
   * Which page raised this dialog. Analytics only — the breakdown key on
   * `medication_discontinued` / `medication_reactivated`, so the Calendar and
   * the Medications roster can be told apart from one shared component.
   */
  surface: MedicationLifecycleSurface;
  /**
   * Care recipient's IANA timezone. Analytics only — `days_active` counts whole
   * LOCAL days in that timezone (scheduled dates are naive local dates), so the
   * browser's timezone would give the wrong answer either side of midnight.
   * Optional because it is never load-bearing for the mutation; it falls back
   * to the project's documented default when a caller has not resolved it yet.
   */
  timezone?: string;
  onClose: () => void;
  /** Called after a successful status change (parent closes the detail modal). */
  onChanged?: () => void;
}

export function DiscontinueMedDialog({
  circleId,
  event,
  events,
  groupInactive,
  surface,
  timezone,
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
      // ONE request for the whole medication — the server resolves every series
      // root sharing this med's normalized name + dose.
      const result = await medicationStatus.mutateAsync({
        eventId: getSeriesRoot(event),
        discontinued: discontinue,
        scope: 'medication',
      });
      // CONFIRMED SUCCESS only — the PATCH above has resolved. `capture` is
      // non-throwing (lib/analytics.ts), so this can never divert into the
      // catch below and swallow a successful change as a failure.
      // `series_count` is the SERVER's count of roots actually mutated; the
      // windowed client-side count it replaced could undercount silently.
      if (discontinue) {
        const facts = getMedSeriesAnalyticsFacts(events, event, timezone || DEFAULT_TIMEZONE);
        Analytics.medicationDiscontinued(circleId, {
          surface,
          seriesCount: result.series_count ?? 0,
          daysActive: facts.daysActive,
          hadConfirmations: facts.hadConfirmations,
        });
      } else {
        Analytics.medicationReactivated(circleId, { surface, seriesCount: result.series_count ?? 0 });
      }
      // These two toasts speak for the WHOLE medication ("Medication
      // discontinued" / "Medication reactivated"). That was an overclaim while
      // the client fanned out over a windowed root list; with the server
      // resolving every root it is now simply true.
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
