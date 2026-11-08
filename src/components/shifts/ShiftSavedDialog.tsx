import { useId, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent } from '@/api/calendarEvents';
import { Button, Modal } from '@/components/ui';
import { useCircle } from '@/hooks/useCircle';
import { useHourCycle } from '@/hooks/useHourCycle';
import { formatWeekdayList } from '@/components/calendar/recurrenceLabel';
import { shiftAssignee } from './shiftPeople';
import { parseCycleRule } from './shiftRotation';
import { formatShiftRange, isShiftOpen, shiftEnd } from './shiftUtils';
import { formatTimeOfDay } from '@/utils/timezone';
import { useAuthStore } from '@/store/authStore';
import { Analytics } from '@/lib/analytics';

export interface ShiftSavedDialogProps {
  circleId: string;
  /** The shift just created. */
  shift: CalendarEvent;
  onAddNext: () => void;
  /** "Add a task to this shift": opens the task form for the shift just created. */
  onAddTask: () => void;
  onDone: () => void;
}

/**
 * After a CREATE: ""Morning" saved", the summary ("8:00 AM - 2:00 PM, every day." / "... · Ana is on it."),
 * then the follow-ups (one filled, see below) and Done. "Starts at 2:00 PM · every day" is the add-next
 * button's description for assistive tech.
 */
export function ShiftSavedDialog({
  circleId,
  shift,
  onAddNext,
  onAddTask,
  onDone,
}: ShiftSavedDialogProps): ReactElement {
  const { t, i18n } = useTranslation(['shifts', 'calendar']);
  const cycle = useHourCycle();
  const { timezone, members } = useCircle(circleId);
  const viewerId = useAuthStore((s) => s.user?.id);
  const hintId = useId();

  const repeating = !!shift.recurrence_rule;
  // Mobile's wording: "every day" / "every week" / "on Mon, Wed", and full
  // templates per case below (a person's name is never glued onto a fragment).
  const days = shift.recurrence_days;
  const rule = shift.recurrence_rule ?? '';
  const rotation = parseCycleRule(rule);
  const repeat = !repeating
    ? ''
    : rule === 'daily'
      ? t('saved.repeatDaily')
      : rule === 'every_other_day'
        ? t('saved.repeatEveryOtherDay')
        : rule === 'monthly'
          ? t('saved.repeatMonthly')
          : rule === 'yearly'
            ? t('saved.repeatYearly')
            : rotation
              ? t('repeat.cycle', { on: rotation.on, off: rotation.off })
              : days && days.length > 0
                ? t('saved.repeatDays', { days: formatWeekdayList(days, i18n.language) })
                : t('saved.repeatWeekly');
  // The composer only mounts this after the form (which is gated on the circle),
  // so the zone is known; never guess one.
  if (!timezone) return <></>;
  const range = formatShiftRange(shift, timezone, cycle);
  const assignee = shiftAssignee(shift, members, viewerId);
  const who = assignee && !assignee.isYou ? assignee.name || t('someone') : '';
  const end = shiftEnd(shift.scheduled_date, shift.scheduled_time ?? '00:00', shift.duration_minutes ?? 15);
  const [eh, em] = end.time.split(':').map((n) => parseInt(n, 10));
  const nextStart = formatTimeOfDay(eh, em, cycle);

  const summary = isShiftOpen(shift)
    ? repeating
      ? t('saved.summaryOpen', { range, repeat })
      : t('saved.summaryOpenOnce', { range })
    : assignee?.isYou
      ? repeating
        ? t('saved.summarySelf', { range, repeat })
        : t('saved.summarySelfOnce', { range })
      : repeating
        ? t('saved.summaryAssigned', { range, repeat, who })
        : t('saved.summaryAssignedOnce', { range, who });

  const nextHint = repeating
    ? t('saved.addNextHint', { time: nextStart, repeat })
    : t('saved.addNextHintOnce', { time: nextStart });
  const addNextLabel = repeating ? t('saved.addAnother') : t('saved.addNext');
  // EXACTLY ONE filled button (approved mock 2026-11-08, mobile ShiftSavedSheet): a one-off leads with
  // "Add the next shift"; a repeating shift already covers its next days, so "Add a task to this shift" leads
  // and "Add another shift" follows. Done is the quiet neutral text button, last.
  const addNext = (
    <Button
      key="next"
      variant={repeating ? 'secondary' : 'primary'}
      fullWidth
      aria-describedby={hintId}
      data-testid="shift-saved-add-next"
      onClick={onAddNext}
    >
      {addNextLabel}
    </Button>
  );
  const addTask = (
    <Button
      key="task"
      variant={repeating ? 'primary' : 'secondary'}
      fullWidth
      offlineKind="change"
      data-testid="shift-saved-add-task"
      onClick={() => {
        Analytics.shiftSavedSheetAction({ action: 'add_task', repeating });
        onAddTask();
      }}
    >
      {t('tasks.addTask')}
    </Button>
  );

  return (
    <Modal size="sm" title={t('saved.title', { name: shift.title })} closeLabel={t('close')} onClose={onDone}>
      <div className="flex flex-col gap-3">
        <p className="m-0 mb-1 text-base text-ink-2" data-testid="shift-saved-summary">
          {summary}
        </p>
        {repeating ? [addTask, addNext] : [addNext, addTask]}
        <span id={hintId} className="sr-only">
          {nextHint}
        </span>
        <Button
          variant="ghost"
          tone="neutral"
          fullWidth
          data-testid="shift-saved-done"
          onClick={() => {
            Analytics.shiftSavedSheetAction({ action: 'done', repeating });
            onDone();
          }}
        >
          {t('saved.done')}
        </Button>
      </div>
    </Modal>
  );
}
