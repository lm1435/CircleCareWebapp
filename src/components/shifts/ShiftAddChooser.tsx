import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent } from '@/api/calendarEvents';
import { formatDateForDisplay } from '@/components/calendar/dateMath';
import { clockText } from '@/components/calendar/zoneCaptionRange';
import { Button, Icon, Modal } from '@/components/ui';
import { useHourCycle } from '@/hooks/useHourCycle';
import { shiftEnd } from './shiftUtils';

export type ShiftAddChoice = 'task' | 'medication' | 'appointment';

export interface ShiftAddChooserProps {
  shift: CalendarEvent;
  onChoose: (choice: ShiftAddChoice) => void;
  /** Cancel, Escape, the close button: back to the shift detail. */
  onClose: () => void;
}

const OPTIONS: ReadonlyArray<{
  choice: ShiftAddChoice;
  title: string;
  hint: string;
  icon: 'checkbox-outline' | 'medkit-outline' | 'calendar-outline';
}> = [
  { choice: 'task', title: 'shifts:add.task', hint: 'shifts:add.taskHint', icon: 'checkbox-outline' },
  { choice: 'medication', title: 'shifts:add.medication', hint: 'shifts:add.medicationHint', icon: 'medkit-outline' },
  { choice: 'appointment', title: 'shifts:add.appointment', hint: 'shifts:add.appointmentHint', icon: 'calendar-outline' },
];

/**
 * "Add to this shift" (1.4.3): the small chooser the detail's button opens. Task, Medication, Appointment, then
 * Cancel. It REPLACES the detail (the page owns one dialog at a time) and every close path returns to it. It
 * gates nothing: the add medication / appointment forms behind it carry their own save-time handling.
 */
export function ShiftAddChooser({ shift, onChoose, onClose }: ShiftAddChooserProps): ReactElement {
  const { t, i18n } = useTranslation(['shifts', 'common']);
  const cycle = useHourCycle();
  const startTime = (shift.scheduled_time ?? '00:00').slice(0, 5);
  const end = shiftEnd(shift.scheduled_date, startTime, shift.duration_minutes ?? 0);
  const subtitle = t('shifts:add.subtitle', {
    date: formatDateForDisplay(shift.scheduled_date, { weekday: 'short', month: 'short', day: 'numeric' }, i18n.language),
    start: clockText(startTime, cycle),
    end: clockText(end.time, cycle),
  });
  return (
    <Modal size="sm" title={t('shifts:add.title')} closeLabel={t('shifts:close')} onClose={onClose}>
      <div className="flex flex-col gap-3" data-testid="shift-add-chooser">
        <p className="m-0 text-base text-ink-2" data-testid="shift-add-subtitle">
          {subtitle}
        </p>
        <div className="flex flex-col gap-2">
          {OPTIONS.map((o) => (
            <button
              key={o.choice}
              type="button"
              data-testid={`shift-add-${o.choice}`}
              onClick={() => onChoose(o.choice)}
              // card-shell-ok: a choice row (a button), not a card
              className="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-2xl border border-line bg-transparent px-3.5 py-3 text-left hover:bg-bg-2"
            >
              <Icon name={o.icon} size="row" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-base font-semibold text-ink">{t(o.title)}</span>
                <span className="text-sm text-ink-2">{t(o.hint)}</span>
              </span>
              <Icon name="chevron-forward" size="inline" />
            </button>
          ))}
        </div>
        <Button variant="secondary" onClick={onClose} data-testid="shift-add-cancel">
          {t('shifts:add.cancel')}
        </Button>
      </div>
    </Modal>
  );
}
