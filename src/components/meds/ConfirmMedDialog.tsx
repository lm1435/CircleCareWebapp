import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Modal, RadioGroup, useToast } from '@/components/ui';
import { useConfirmMedication } from '@/hooks/useMedConfirmation';
import type { MedicationConfirmSource } from '@/lib/analytics';
import { useHourCycle } from '@/hooks/useHourCycle';
import { isPermissionDeniedError, type TodaysMedication } from '@/api/medicationConfirmations';
import { isMedicationDiscontinuedError } from '@/lib/apiErrors';
import {
  isDoseConfirmable,
  formatEventTimeCompact,
  getRelativeDateLabel,
  zoneReferenceInstant,
} from '@/utils/timezone';
import { formatDateForDisplay } from '@/components/calendar/dateMath';
import i18n from 'i18next';

/**
 * Taken / Skipped for ONE dose, as a dialog.
 *
 * Built on the shared `Modal` (spec §4.5) rather than its own fixed-position
 * shell: the focus trap, Escape, backdrop, scroll lock and footer layout are
 * the same everywhere or they drift, and this file used to carry a hand-rolled
 * copy of all five.
 *
 * The Today's-Meds cards answer a dose inline now (optimistic, with an undo
 * window). This dialog remains the CALENDAR's confirm surface, where the dose
 * is being answered from a detail view rather than from a row with its own
 * action pair — see `components/calendar/EventDetailActions.tsx`.
 */

export interface ConfirmMedDialogProps {
  circleId: string;
  med: TodaysMedication;
  /** Care recipient's IANA timezone — for displaying the scheduled time. */
  careRecipientTimezone: string;
  initialStatus?: 'taken' | 'skipped';
  /** Which surface opened this dialog — reported with the confirm event. */
  source: MedicationConfirmSource;
  onClose: () => void;
}

export function ConfirmMedDialog({
  circleId,
  med,
  careRecipientTimezone,
  initialStatus = 'taken',
  source,
  onClose,
}: ConfirmMedDialogProps): ReactElement {
  const { t } = useTranslation(['meds', 'common']);

  /**
   * WHICH DAY this confirmation is for.
   *
   * "Needs Attention" draws YESTERDAY's unanswered doses into the same card and
   * routes them through this same dialog, so a daily 08:00 medication produced
   * two rows whose dialogs read identically — "Warfarin — 8:00 AM MT" — inside
   * a card titled "Today's medications". Picking the wrong one files an
   * adherence record against the wrong calendar day, in the log a doctor reads.
   *
   * Resolved in the CARE RECIPIENT's frame, like the time beside it. Shown only
   * when the dose is NOT today: labelling every ordinary confirmation "Today"
   * is noise, and the ambiguity only exists once a second day is on screen.
   */
  const dayLabel = ((): string | null => {
    if (!med.scheduled_date) return null;
    const relative = getRelativeDateLabel(med.scheduled_date, careRecipientTimezone);
    if (relative === 'today') return null;
    if (relative === 'yesterday') return t('dialog.dayYesterday');
    return t('dialog.dayOn', {
      date: formatDateForDisplay(
        med.scheduled_date,
        { month: 'short', day: 'numeric' },
        i18n.language
      ),
    });
  })();
  const { showToast } = useToast();
  // Viewer's 12h/24h clock — every rendered time goes through it.
  const hourCycle = useHourCycle();
  const [status, setStatus] = useState<'taken' | 'skipped'>(initialStatus);
  // 'discontinued' = 409 MEDICATION_DISCONTINUED (inactive med — retry can
  // never succeed, so the message points at reactivation instead).
  const [submitError, setSubmitError] = useState<'generic' | 'discontinued' | 'notDue' | null>(
    null
  );
  const mutation = useConfirmMedication(circleId, source);

  const handleSubmit = (): void => {
    if (!med.scheduled_time || mutation.isPending) return;
    // DEFENSE IN DEPTH, mirroring mobile (CalendarScreen.confirmEventWithStatus
    // re-checks the same predicate before mutating, not just where the pair is
    // rendered). Every web surface gates its confirm affordance on
    // isDoseConfirmable, but a dialog left open across the boundary — or any
    // future caller that forgets the gate — would otherwise POST a dose that
    // was never due and falsify the adherence record the clinician report is
    // built from. The backend does NOT enforce this today; until it does, this
    // is the last line, not a redundant one.
    if (!isDoseConfirmable(med.scheduled_date, med.scheduled_time, careRecipientTimezone)) {
      setSubmitError('notDue');
      return;
    }
    setSubmitError(null);

    mutation.mutate(
      {
        event_id: med.id,
        status,
        scheduled_time: med.scheduled_time,
      },
      {
        onSuccess: () => {
          showToast(
            t(status === 'taken' ? 'dialog.successTaken' : 'dialog.successSkipped'),
            'success'
          );
          onClose();
        },
        onError: (error) => {
          if (isPermissionDeniedError(error)) {
            // The mutation hook already showed the permission toast and
            // refreshed circle access flags — just close.
            onClose();
          } else if (isMedicationDiscontinuedError(error)) {
            // 409: the med was discontinued (likely by another caregiver) —
            // retrying can't succeed, so say what unblocks it.
            setSubmitError('discontinued');
          } else {
            setSubmitError('generic');
          }
        },
      }
    );
  };

  const medName = med.medication_name || med.title;

  return (
    <Modal
      title={t('dialog.title')}
      onClose={onClose}
      closeLabel={t('common:close')}
      size="sm"
      dismissible={!mutation.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            {t('dialog.cancel')}
          </Button>
          <Button variant="primary" onClick={handleSubmit} loading={mutation.isPending}>
            {mutation.isPending ? t('dialog.submitting') : t('dialog.submit')}
          </Button>
        </>
      }
    >
      <p className="m-0 mb-4 text-sm text-ink-3">
        {medName}
        {med.scheduled_time
          ? ` — ${formatEventTimeCompact(
              med.scheduled_time,
              careRecipientTimezone,
              hourCycle,
              // Judged against the day being CONFIRMED, which `dayLabel`
              // right beside it already names ("Yesterday"). Resolving the
              // zone at "now" would contradict that word across a DST
              // transition.
              zoneReferenceInstant(med.scheduled_date)
            )}`
          : ''}
        {dayLabel ? ` · ${dayLabel}` : ''}
      </p>

      <RadioGroup
        label={t('dialog.statusLabel')}
        value={status}
        onChange={(value) => setStatus(value === 'skipped' ? 'skipped' : 'taken')}
        options={[
          { value: 'taken', label: t('dialog.taken') },
          { value: 'skipped', label: t('dialog.skipped') },
        ]}
      />

      {/* Kept OUT of RadioGroup's `error` slot: that slot is silent to a screen
          reader (it only wires aria-describedby), and a submit failure has to
          be announced when it appears, not only when the group is focused. */}
      {submitError && (
        <p role="alert" className="m-0 mt-2 text-sm text-terracotta-deep">
          {t(
            submitError === 'discontinued'
              ? 'dialog.errorDiscontinued'
              : submitError === 'notDue'
                ? 'dialog.errorNotDue'
                : 'dialog.error'
          )}
        </p>
      )}
    </Modal>
  );
}
