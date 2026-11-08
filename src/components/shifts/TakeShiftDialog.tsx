import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent } from '@/api/calendarEvents';
import type { ShiftScope } from '@/api/shifts';
import { Button, ChipSelect, Modal, RadioGroup, useToast } from '@/components/ui';
import { Analytics } from '@/lib/analytics';
import { useCircle } from '@/hooks/useCircle';
import { useCanTakeFuture, useHandleShiftFailure, useTakeShift } from '@/hooks/useShifts';
import { formatDateForDisplay } from '@/components/calendar/dateMath';
import { ShiftInlineError } from './ShiftInlineError';
import { SHIFT_REMINDER_LEADS, formatShiftReminder, type ShiftReminderLead } from './shiftUtils';

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
  // Starts at the shift's own reminder; sent only when the taker changes it.
  const current = (shift.reminder_lead_minutes ?? null) as ShiftReminderLead;
  const [reminder, setReminder] = useState<ShiftReminderLead>(current);
  // One line ("Reminder · 1 hour before") + Change; Change opens every choice in place and a pick folds it back
  // (approved mock 2026-11-08, mobile TakeShiftSheet).
  const [reminderOpen, setReminderOpen] = useState(false);
  const reminderOptions = SHIFT_REMINDER_LEADS.map((lead) => ({
    value: lead === null ? 'off' : String(lead),
    label: formatShiftReminder(lead, t),
  }));
  const reminderLabel = formatShiftReminder(reminder, t);
  // Focus follows the swap (the control that had it is gone): into the choices on open (the chosen one), back to
  // Change after a pick. Skipped on first render.
  const changeRef = useRef<HTMLButtonElement>(null);
  const choicesRef = useRef<HTMLDivElement>(null);
  const toggled = useRef(false);
  useEffect(() => {
    if (!toggled.current) return;
    if (reminderOpen) {
      choicesRef.current?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus();
    } else {
      changeRef.current?.focus();
    }
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
        ...(reminder !== current ? { reminder } : {}),
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
            className="flex flex-col gap-2 border-t border-line pt-3"
            // A click (or Enter / Space) on any choice, the current one included, folds the row back; arrow keys
            // only move the choice, so a keyboard user is not thrown out after one step.
            onClick={(event) => {
              if ((event.target as HTMLElement).closest('[role="radio"]')) {
                toggled.current = true;
                setReminderOpen(false);
              }
            }}
          >
            <p className="m-0 text-base text-ink-2" id="take-shift-reminder-label">
              {t('shifts:form.reminder')}
            </p>
            <ChipSelect
              id="take_shift_reminder"
              label={t('shifts:form.reminder')}
              allowDeselect={false}
              options={reminderOptions}
              value={reminder === null ? 'off' : String(reminder)}
              onChange={(value) => {
                const next = SHIFT_REMINDER_LEADS.find(
                  (lead) => (lead === null ? 'off' : String(lead)) === value
                );
                if (next !== undefined) setReminder(next);
              }}
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
              ref={changeRef}
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
