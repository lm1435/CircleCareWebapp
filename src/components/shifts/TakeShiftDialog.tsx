import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent } from '@/api/calendarEvents';
import type { ShiftScope } from '@/api/shifts';
import { Button, Modal, RadioGroup, useToast } from '@/components/ui';
import { useCircle } from '@/hooks/useCircle';
import { useCanTakeFuture, useHandleShiftFailure, useTakeShift } from '@/hooks/useShifts';
import { formatDateForDisplay } from '@/components/calendar/dateMath';
import { ShiftInlineError } from './ShiftInlineError';
import { formatShiftReminder } from './shiftUtils';

export interface TakeShiftDialogProps {
  circleId: string;
  shift: CalendarEvent;
  onClose: () => void;
  /** Called after a successful take (the parent may close the detail too). */
  onTaken?: () => void;
}

const NO_CACHED: readonly CalendarEvent[] = [];

/**
 * "Take "Night"". A one-off is a single Take button. A repeating shift
 * adds the choice: "Just this one" (date shown, the default) or "This and every
 * future one". The second is offered ONLY when it can succeed: the series'
 * default is open, or the viewer is the owner / a manager (anyone else gets a
 * 409 SHIFT_ALREADY_TAKEN when the series default is someone else).
 */
export function TakeShiftDialog({
  circleId,
  shift,
  onClose,
  onTaken,
}: TakeShiftDialogProps): ReactElement {
  const { t } = useTranslation(['shifts', 'common']);
  const { showToast } = useToast();
  const { canManageMembers } = useCircle(circleId);
  const take = useTakeShift(circleId);
  const handleFailure = useHandleShiftFailure();
  const [scope, setScope] = useState<ShiftScope>('occurrence');
  const [error, setError] = useState('');

  // Same rule as mobile: offered only when it can succeed (the series default is
  // open, or the viewer is the owner / a manager); the root is fetched when the
  // loaded rows don't say.
  const futureOffered = useCanTakeFuture(circleId, shift, NO_CACHED, canManageMembers);

  const name = shift.title.trim();
  const dateLabel = formatDateForDisplay(shift.scheduled_date, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  async function submit(): Promise<void> {
    setError('');
    try {
      await take.mutateAsync({ shift, scope: futureOffered ? scope : 'occurrence' });
      showToast(t('shifts:toast.taken', { name }), 'success');
      onTaken?.();
      onClose();
    } catch (err) {
      // Classified failures (409 names the winner, gone, not allowed) close with a
      // toast; a network / server failure stays here with the message and a retry.
      const outcome = handleFailure(err, 'take');
      if (outcome.close) onClose();
      else setError(outcome.message);
    }
  }

  return (
    <Modal
      size="sm"
      title={t('shifts:take.title', { name })}
      closeLabel={t('shifts:close')}
      onClose={onClose}
      dismissible={!take.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={take.isPending}>
            {t('common:cancel')}
          </Button>
          <Button onClick={() => void submit()} loading={take.isPending} offlineKind="change">
            {t('shifts:take.confirm')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="m-0 text-base text-ink-2">{dateLabel}</p>
        {futureOffered && (
          <RadioGroup
            label={t('shifts:take.scopeLabel')}
            value={scope}
            onChange={(value) => setScope(value as ShiftScope)}
            options={[
              {
                value: 'occurrence',
                label: t('shifts:take.justThis'),
                hint: dateLabel,
              },
              { value: 'future', label: t('shifts:take.future'), hint: t('shifts:take.futureHint') },
            ]}
          />
        )}
        <ShiftInlineError message={error} testId="take-shift-error" />
        <p className="m-0 text-sm text-ink-3" data-testid="take-shift-reminder">
          {t('shifts:take.reminderRow', {
            when: formatShiftReminder(shift.reminder_lead_minutes, t),
          })}
        </p>
      </div>
    </Modal>
  );
}
