import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/ui';
import { useConfirmMedication } from '@/hooks/useMedConfirmation';
import { useSubmitGuard } from '@/hooks/useGuardedSubmit';
import { isPermissionDeniedError } from '@/api/medicationConfirmations';
import { blockOfflineWrite } from '@/lib/offlineWrite';
import { Analytics } from '@/lib/analytics';
import { toWireTime } from '@/utils/firstMedSaved';

/**
 * "Already given today? Mark it" (onboarding 1.3.1, spec section 1): records ONE Taken for
 * today at the FIRST dose time of a medication that was just saved and whose start rolled to
 * the next dose. One POST to the existing confirm endpoint with the opt-in `mark_first_day`
 * flag; the server moves the root back to today, writes `taken` at the scheduled instant and
 * 409s `NOT_FIRST_DAY` for anything else.
 *
 * It rides `useConfirmMedication`, so a success invalidates exactly what a normal Taken
 * does (today's meds, calendar, confirmations, summary, adherence, activity feed) and fires
 * the normal `medication_confirmed` event. A FAILURE is the generic save error and NEVER
 * partial UI: the caller's line stays and can be tapped again.
 *
 * Guarded twice: `useSubmitGuard` closes the same-tick double tap (the second tap would be a
 * second request), and `done` makes a finished mark inert. Offline presses explain and send
 * nothing (the app-wide rule). Analytics are enums/booleans only, no circle id.
 */
export interface MarkFirstDoseTarget {
  /** The primary dose's event id (the series ROOT). */
  eventId: string;
  /** `HH:MM` or `HH:MM:SS`, recipient frame. */
  time: string;
}

export function useMarkFirstDose(
  circleId: string,
  surface: 'payoff' | 'today'
): {
  mark: (target: MarkFirstDoseTarget) => Promise<boolean>;
  pending: boolean;
  done: boolean;
} {
  const { t } = useTranslation('meds');
  const { showToast } = useToast();
  const confirm = useConfirmMedication(circleId, 'care_profile');
  const guard = useSubmitGuard();
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  const mark = useCallback(
    async (target: MarkFirstDoseTarget): Promise<boolean> => {
      if (done) return false;
      // Offline BEFORE the claim: an offline press explains and must leave nothing claimed.
      if (blockOfflineWrite('mark')) return false;
      if (!guard.claim()) return false;
      setPending(true);
      try {
        await confirm.mutateAsync({
          event_id: target.eventId,
          status: 'taken',
          scheduled_time: toWireTime(target.time),
          mark_first_day: true,
        });
        Analytics.markItTapped(surface, true);
        setDone(true);
        showToast(t('dialog.successTaken'), 'success');
        return true;
      } catch (error) {
        Analytics.markItTapped(surface, false);
        // A permission refusal already toasted (useConfirmMedication); anything else says
        // the generic save error. The line stays either way.
        if (!isPermissionDeniedError(error)) showToast(t('dialog.error'), 'error');
        return false;
      } finally {
        setPending(false);
        guard.release();
      }
    },
    [confirm, done, guard, showToast, surface, t]
  );

  return { mark, pending, done };
}
