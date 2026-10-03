import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog, useToast } from '@/components/ui';
import { useConfirmMedication } from '@/hooks/useMedConfirmation';
import { useHourCycle } from '@/hooks/useHourCycle';
import { Analytics, type MedicationConfirmSource } from '@/lib/analytics';
import { isMedicationDiscontinuedError, isOccurrenceRemovedError } from '@/lib/apiErrors';
import { confirmFailureOutcome } from '@/lib/confirmVerify';
import {
  changeAnswerCopy,
  doseAlreadyRecorded,
  doseAlreadyRecordedMessage,
  type DoseAlreadyRecorded,
} from '@/lib/doseAlreadyRecorded';
import { isPermissionDeniedError } from '@/api/medicationConfirmations';
import type { ConfirmableStatus, TodaysMedication } from '@/api/medicationConfirmations';

/**
 * PK29 (approved 2026-09-30): "Change Ana's answer?".
 *
 * Reached from the already-recorded notice's "Change answer" action (the toast
 * on the Today's-meds card, the in-dialog button on the Calendar's confirm
 * dialog). Names who answered and what, and says everyone in the circle will
 * see the change in Activity. Only its confirm re-sends the answer, with
 * `overwrite: true, expected_status: <the answer the caregiver saw>`: the
 * server replaces the answer only while that is still the stored one. If the
 * other caregiver changed it AGAIN meanwhile the server answers a fresh 409
 * and this dialog re-asks with the new facts instead of overwriting blind.
 * Same flow and wording as mobile (`useConfirmFailureAlert`). Push action
 * buttons never overwrite (they cannot confirm) and never reach this.
 */
export interface ChangeAnswerDialogProps {
  circleId: string;
  med: TodaysMedication;
  /** What THIS caregiver tried to record. */
  mine: ConfirmableStatus;
  /** What the other caregiver recorded (from the 409). */
  theirs: DoseAlreadyRecorded;
  source: MedicationConfirmSource;
  onClose: () => void;
}

export function ChangeAnswerDialog({
  circleId,
  med,
  mine,
  theirs: initialTheirs,
  source,
  onClose,
}: ChangeAnswerDialogProps): ReactElement | null {
  const { t } = useTranslation(['meds', 'common']);
  const { showToast } = useToast();
  const hourCycle = useHourCycle();
  const mutation = useConfirmMedication(circleId, source);
  const [theirs, setTheirs] = useState(initialTheirs);

  const copy = changeAnswerCopy(t, theirs, mine, hourCycle);
  if (!copy || !med.scheduled_time) return null;
  const scheduledTime = med.scheduled_time;

  const handleConfirm = async (): Promise<void> => {
    try {
      await mutation.mutateAsync({
        event_id: med.id,
        status: mine,
        scheduled_time: scheduledTime,
        overwrite: true,
        expected_status: theirs.status,
        dose: { scheduled_date: med.scheduled_date, parent_event_id: med.parent_event_id ?? null },
      });
      Analytics.medicationConfirmOverwritten(mine === 'skipped' ? 'skipped' : 'taken', source);
      showToast(
        t(mine === 'skipped' ? 'dialog.successSkipped' : 'dialog.successTaken'),
        'success'
      );
      onClose();
    } catch (error) {
      const fresh = doseAlreadyRecorded(error);
      if (fresh) {
        // Changed again since the caregiver looked: new facts. Ask again if
        // there is still something to change, otherwise just say what stands.
        if (changeAnswerCopy(t, fresh, mine, hourCycle)) {
          setTheirs(fresh);
          return;
        }
        showToast(doseAlreadyRecordedMessage(t, fresh, hourCycle), 'info');
        onClose();
        return;
      }
      // The mutation hook already toasted a permission rejection.
      if (!isPermissionDeniedError(error)) {
        showToast(
          t(
            isMedicationDiscontinuedError(error)
              ? 'dialog.errorDiscontinued'
              : isOccurrenceRemovedError(error)
                ? 'dialog.errorOccurrenceRemoved'
                : confirmFailureOutcome(error) === 'unverified'
                  ? 'dialog.errorUnverified'
                  : 'dialog.error',
            { medication: med.medication_name || med.title }
          ),
          'error'
        );
      }
      onClose();
    }
  };

  return (
    <ConfirmDialog
      title={copy.title}
      message={copy.message}
      confirmLabel={copy.confirm}
      cancelLabel={copy.keep}
      closeLabel={t('common:close')}
      onConfirm={handleConfirm}
      onCancel={onClose}
    />
  );
}
