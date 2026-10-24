import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent } from '@/api/calendarEvents';
import { Button, Modal } from '@/components/ui';
import { useCircle } from '@/hooks/useCircle';
import { useHourCycle } from '@/hooks/useHourCycle';
import { formatWeekdayList } from '@/components/calendar/recurrenceLabel';
import { shiftAssignee } from './shiftPeople';
import { formatShiftRange, isShiftOpen, shiftEnd } from './shiftUtils';
import { formatTimeOfDay } from '@/utils/timezone';
import { useAuthStore } from '@/store/authStore';

export interface ShiftSavedDialogProps {
  circleId: string;
  /** The shift just created. */
  shift: CalendarEvent;
  onAddNext: () => void;
  onDone: () => void;
}

/**
 * After a CREATE: "Morning shift saved - 8:00 AM - 2:00 PM, every day. Open for
 * anyone to take." with "Add the next shift - Starts at 2:00 PM · Every day" and
 * Done.
 */
export function ShiftSavedDialog({
  circleId,
  shift,
  onAddNext,
  onDone,
}: ShiftSavedDialogProps): ReactElement {
  const { t, i18n } = useTranslation('shifts');
  const cycle = useHourCycle();
  const { timezone, members } = useCircle(circleId);
  const viewerId = useAuthStore((s) => s.user?.id);

  const repeating = !!shift.recurrence_rule;
  // Mobile's wording: "every day" / "every week" / "on Mon, Wed", and full
  // templates per case below (a person's name is never glued onto a fragment).
  const days = shift.recurrence_days;
  const repeat = !repeating
    ? ''
    : shift.recurrence_rule === 'daily'
      ? t('saved.repeatDaily')
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

  return (
    <Modal
      size="sm"
      title={t('saved.title', { name: shift.title })}
      closeLabel={t('close')}
      onClose={onDone}
      footer={
        <Button variant="secondary" onClick={onDone}>
          {t('saved.done')}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="m-0 text-base text-ink-2">{summary}</p>
        <Button variant="primary" fullWidth onClick={onAddNext}>
          <span className="flex flex-col items-center">
            <span>{t('saved.addNext')}</span>
            <span className="text-xs font-normal">
              {repeating
                ? t('saved.addNextHint', { time: nextStart, repeat })
                : t('saved.addNextHintOnce', { time: nextStart })}
            </span>
          </span>
        </Button>
      </div>
    </Modal>
  );
}
