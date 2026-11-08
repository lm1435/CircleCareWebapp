import { useState, type FormEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent } from '@/api/calendarEvents';
import {
  isShiftEndedError,
  isShiftInvalidDateError,
  isShiftNotFoundError,
} from '@/api/shifts';
import { isShiftTaskOutsideError, isShiftTaskTimeUnsupportedError } from '@/api/shiftTasks';
import { Button, Checkbox, Modal, TextField, TimeField } from '@/components/ui';
import { formatDateForDisplay } from '@/components/calendar/dateMath';
import { useCircle } from '@/hooks/useCircle';
import { useGuardedSubmit } from '@/hooks/useGuardedSubmit';
import { useHourCycle } from '@/hooks/useHourCycle';
import { useAddShiftTask } from '@/hooks/useShiftTasks';
import { useHandleShiftFailure } from '@/hooks/useShifts';
import { Analytics } from '@/lib/analytics';
import { formatTimeOfDay } from '@/utils/timezone';
import { ShiftInlineError } from './ShiftInlineError';
import { shiftEnd, isShiftRepeating } from './shiftUtils';

export type ShiftTaskSource = 'saved_sheet' | 'shift_detail';

export interface ShiftTaskFormModalProps {
  circleId: string;
  /** The shift occurrence the task is added to. */
  shift: CalendarEvent;
  source: ShiftTaskSource;
  onClose: () => void;
  /** The task was saved (the caller toasts and decides where to go next). */
  onAdded: () => void;
}

export const SHIFT_TASK_NAME_MAX = 150;

const hm = (time: string | null | undefined): string => (time ? time.slice(0, 5) : '');
const minutes = (time: string): number => {
  const [h, m] = time.split(':');
  return parseInt(h, 10) * 60 + parseInt(m, 10);
};

/**
 * Is `time` inside the shift's window? Earlier than the shift start means the NEXT day (day offset 1,
 * the server's rule); the window ends inclusive. Mirrors the server so the form answers before a
 * round trip; the server's 400 SHIFT_TASK_OUTSIDE_SHIFT still has the last word.
 */
export function timeInsideShiftWindow(time: string, start: string, durationMinutes: number): boolean {
  if (!time || !start) return false;
  const t = minutes(time);
  const s = minutes(start);
  const at = (t < s ? 1440 : 0) + t;
  return at >= s && at <= s + durationMinutes;
}

/**
 * "Add a task to this shift" (docs/plans/shift-tasks.md section 1): a name, a time inside the
 * window, and, on a repeating shift, an "Only <date>" checkbox. Unchecked, the task repeats with
 * the shift and goes to whoever covers each occurrence. There is NO assignee field.
 */
export function ShiftTaskFormModal({
  circleId,
  shift,
  source,
  onClose,
  onAdded,
}: ShiftTaskFormModalProps): ReactElement | null {
  const { t, i18n } = useTranslation(['shifts', 'common']);
  const { canEdit } = useCircle(circleId);
  const hourCycle = useHourCycle();
  const addTask = useAddShiftTask(circleId);
  const handleFailure = useHandleShiftFailure();

  const start = hm(shift.scheduled_time) || '00:00';
  const duration = shift.duration_minutes ?? 0;
  const end = shiftEnd(shift.scheduled_date, start, duration);
  const repeating = isShiftRepeating(shift);

  const [name, setName] = useState('');
  const [time, setTime] = useState(start);
  const [onlyThisDay, setOnlyThisDay] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; time?: string }>({});
  const [saveError, setSaveError] = useState('');

  const clock = (value: string): string => {
    const [h, m] = value.split(':').map((n) => parseInt(n, 10));
    return formatTimeOfDay(h, m, hourCycle);
  };
  const dateLabel = formatDateForDisplay(
    shift.scheduled_date,
    { weekday: 'short', month: 'short', day: 'numeric' },
    i18n.language
  );

  async function handleSubmit(_event?: FormEvent): Promise<void> {
    setSaveError('');
    const found: { name?: string; time?: string } = {};
    if (!name.trim()) found.name = t('shifts:tasks.form.errorName');
    if (!timeInsideShiftWindow(time, start, duration)) found.time = t('shifts:tasks.form.errorOutside');
    if (found.name || found.time) {
      setErrors(found);
      return;
    }
    try {
      await addTask.mutateAsync({
        shift,
        body: {
          scheduledDate: shift.scheduled_date,
          title: name.trim(),
          scheduled_time: time,
          ...(onlyThisDay ? { only_this_day: true } : {}),
        },
      });
      Analytics.shiftTaskAdded({ source, oneOff: onlyThisDay, shiftRepeats: repeating });
      onAdded();
    } catch (err) {
      if (isShiftTaskOutsideError(err)) {
        setErrors({ time: t('shifts:tasks.form.errorOutside') });
      } else if (isShiftTaskTimeUnsupportedError(err)) {
        setErrors({ time: t('shifts:tasks.form.errorUnsupported', { date: dateLabel }) });
      } else if (isShiftEndedError(err)) {
        setSaveError(t('shifts:tasks.form.errorEnded'));
      } else if (isShiftInvalidDateError(err)) {
        setSaveError(t('shifts:tasks.form.errorInvalidDate'));
      } else if (isShiftNotFoundError(err)) {
        setSaveError(t('shifts:tasks.form.errorGone'));
      } else {
        // View-only, lapsed Premium or a permission change: the shared handling (toast / paywall,
        // and the form closes). Anything else (network, server) stays open with the input kept.
        const outcome = handleFailure(err, 'save');
        if (outcome.close) onClose();
        else setSaveError(t('shifts:tasks.form.errorGeneric'));
      }
    }
  }

  const guardedSubmit = useGuardedSubmit(handleSubmit);
  const busy = addTask.isPending;
  if (!canEdit) return null;

  return (
    <Modal
      size="md"
      title={t('shifts:tasks.form.title')}
      closeLabel={t('shifts:close')}
      onClose={onClose}
      dismissible={!busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('common:cancel')}
          </Button>
          <Button type="submit" form="shift-task-form" loading={busy} offlineKind="save">
            {t('shifts:tasks.form.save')}
          </Button>
        </>
      }
    >
      <form
        id="shift-task-form"
        noValidate
        onSubmit={(event: FormEvent) => void guardedSubmit(event)}
        className="flex flex-col gap-5"
        data-testid="shift-task-form"
      >
        {/* Which shift (one line; a long name truncates). Mobile parity. */}
        <p className="m-0 truncate text-base text-ink-2" data-testid="shift-task-form-shift">
          {shift.title}
        </p>
        <TextField
          id="shift_task_name"
          label={t('shifts:tasks.form.name')}
          required
          value={name}
          maxLength={SHIFT_TASK_NAME_MAX}
          placeholder={t('shifts:tasks.form.namePlaceholder')}
          error={errors.name}
          onChange={(e) => {
            setName(e.target.value);
            setErrors((prev) => ({ ...prev, name: undefined }));
          }}
        />
        <TimeField
          id="shift_task_time"
          label={t('shifts:tasks.form.time')}
          required
          value={time}
          hint={t('shifts:tasks.form.timeHint', { start: clock(start), end: clock(end.time) })}
          error={errors.time}
          onChange={(e) => {
            setTime(e.target.value);
            setErrors((prev) => ({ ...prev, time: undefined }));
          }}
        />
        {repeating ? (
          <Checkbox
            id="shift_task_only_day"
            checked={onlyThisDay}
            onChange={setOnlyThisDay}
            label={t('shifts:tasks.form.onlyDate', { date: dateLabel })}
            hint={t('shifts:tasks.form.onlyDateHint')}
          />
        ) : (
          // A one-off shift has no "Only <date>" choice: say where the task goes (mobile parity; a repeating
          // shift's explanation is the checkbox's own hint).
          <p className="m-0 text-base text-ink-2" data-testid="shift-task-form-explain">
            {t('shifts:tasks.form.explainOnce')}
          </p>
        )}
        <ShiftInlineError message={saveError} />
      </form>
    </Modal>
  );
}
