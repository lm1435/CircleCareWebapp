import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent } from '@/api/calendarEvents';
import type { ShiftScope } from '@/api/shifts';
import { Button, Modal, RadioGroup, useToast } from '@/components/ui';
import { Analytics } from '@/lib/analytics';
import { useCircle } from '@/hooks/useCircle';
import { useCanTakeFuture, useHandleShiftFailure, useTakeShift } from '@/hooks/useShifts';
import { formatDateForDisplay } from '@/components/calendar/dateMath';
import { ShiftInlineError } from './ShiftInlineError';
import { ShiftReminderChoices } from './ShiftReminderChoices';
import {
  formatShiftReminders,
  sameShiftLeads,
  shiftReminderLeads,
  shiftReminderStateFrom,
  shiftRemindersForSave,
  type ShiftReminderState,
} from './shiftUtils';

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
  // Starts at the shift's own reminders; sent only when the taker changes the set.
  const current = shiftReminderLeads(shift);
  const [picked, setPicked] = useState<ShiftReminderState>(() => shiftReminderStateFrom(current));
  const pickedLeads = shiftRemindersForSave(picked);
  // One line ("Reminder · 1 hour before") + Change; Change opens the Reminders card in place (toggle + one
  // checkbox per lead, several allowed since 1.4.2; mobile TakeShiftSheet).
  const [reminderOpen, setReminderOpen] = useState(false);
  const reminderLabel = formatShiftReminders(pickedLeads, t);
  // Focus follows the swap (Change is gone once open): into the card, on its first checked row (else the
  // toggle). Skipped on first render.
  const choicesRef = useRef<HTMLDivElement>(null);
  const toggled = useRef(false);
  useEffect(() => {
    if (!toggled.current || !reminderOpen) return;
    const root = choicesRef.current;
    (
      root?.querySelector<HTMLElement>('[role="checkbox"][aria-checked="true"]') ??
      root?.querySelector<HTMLElement>('[role="switch"]')
    )?.focus();
  }, [reminderOpen]);

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
      await take.mutateAsync({
        shift,
        scope: futureOffered ? scope : 'occurrence',
        ...(sameShiftLeads(pickedLeads, current) ? {} : { reminders: pickedLeads }),
      });
      showToast(t('shifts:toast.taken'), 'success');
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
              // No date hint: the date is the line right above (a hint would only restate it).
              { value: 'occurrence', label: t('shifts:take.justThis') },
              { value: 'future', label: t('shifts:take.future'), hint: t('shifts:take.futureHint') },
            ]}
          />
        )}
        <ShiftInlineError message={error} testId="take-shift-error" />
        {reminderOpen ? (
          <div
            ref={choicesRef}
            data-testid="take-shift-reminder"
            className="flex flex-col gap-3 border-t border-line pt-3"
          >
            <p className="m-0 text-base text-ink-2" id="take-shift-reminder-label">
              {t('shifts:form.reminder')}
            </p>
            <ShiftReminderChoices
              value={picked}
              onChange={setPicked}
              disabled={take.isPending}
              idPrefix="take_shift_reminder"
              testIdPrefix="take-shift-reminder-select"
            />
          </div>
        ) : (
          <div
            data-testid="take-shift-reminder"
            className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-t border-line"
          >
            <p className="m-0 text-base text-ink-2" data-testid="take-shift-reminder-value">
              {t('shifts:form.reminder')} · <span className="font-medium text-ink">{reminderLabel}</span>
            </p>
            <button
              type="button"
              data-testid="take-shift-reminder-change"
              aria-label={`${t('shifts:take.changeReminder')}, ${reminderLabel}`}
              aria-expanded={false}
              disabled={take.isPending}
              onClick={() => {
                toggled.current = true;
                setReminderOpen(true);
                Analytics.shiftTakeReminderExpanded();
              }}
              className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center border-0 bg-transparent px-2 text-base font-semibold text-moss-deep underline-offset-2 hover:underline"
            >
              {t('shifts:take.change')}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
