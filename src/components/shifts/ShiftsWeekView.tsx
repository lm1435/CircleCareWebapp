import { useId, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent } from '@/api/calendarEvents';
import type { CircleMember } from '@/api/circleMembers';
import { formatDateForDisplay } from '@/components/calendar/dateMath';
import { Button, Icon } from '@/components/ui';
import { ShiftCard } from './ShiftCard';
import { countOpen, groupShiftsByDay } from './shiftUtils';

export interface ShiftsWeekViewProps {
  /** The 7 `YYYY-MM-DD` days of the week. */
  days: readonly string[];
  shifts: readonly CalendarEvent[];
  timezone: string;
  todayStr: string;
  members: readonly CircleMember[];
  viewerId: string | null | undefined;
  onOpen: (shift: CalendarEvent) => void;
  onTake?: (shift: CalendarEvent) => void;
  /** Day heading press -> that day in Day view. */
  onDayOpen: (day: string) => void;
  /** Present only for editors: the ONE "Add shift" button under the week. */
  onAdd?: () => void;
}

const NONE: CalendarEvent[] = [];

/** The Shifts view's Week: the same cards, grouped by day (mobile parity). */
export function ShiftsWeekView({
  days,
  shifts,
  timezone,
  todayStr,
  members,
  viewerId,
  onOpen,
  onTake,
  onDayOpen,
  onAdd,
}: ShiftsWeekViewProps): ReactElement {
  const { t } = useTranslation('shifts');
  const byDay = groupShiftsByDay(shifts);
  const hintId = useId();
  return (
    <div data-testid="shifts-week-view" className="flex flex-col gap-5">
      <span id={hintId} className="sr-only">
        {t('week.openDayHint')}
      </span>
      {days.map((day) => {
        const list = byDay.get(day) ?? NONE;
        const headingId = `shifts-week-${day}`;
        const summary = t('summaryShort', { count: list.length, open: t('openCount', { count: countOpen(list) }) });
        const label = formatDateForDisplay(day, { weekday: 'long', month: 'short', day: 'numeric' });
        const isToday = day === todayStr;
        const headline = isToday ? `${t('week.today')} · ${label}` : label;
        return (
          <section key={day} aria-labelledby={headingId} data-date={day}>
            <h3 id={headingId} className="m-0 mb-2 text-base font-semibold text-ink">
              {/* ONE button: its label carries the count too (mobile style), and the
                  hint says what it does, never "Double tap..." in the label. */}
              <button
                type="button"
                onClick={() => onDayOpen(day)}
                aria-current={day === todayStr ? 'date' : undefined}
                aria-label={list.length > 0 ? `${headline}, ${summary}` : headline}
                aria-describedby={hintId}
                className="flex min-h-[44px] w-full items-center justify-between gap-2 text-left hover:underline"
              >
                <span>
                  {isToday && <span className="text-moss-deep">{t('week.today')} · </span>}
                  {label}
                </span>
                {list.length > 0 && (
                  <span
                    className="text-xs font-normal text-ink-3"
                    data-testid="shifts-week-day-summary"
                  >
                    {summary}
                  </span>
                )}
              </button>
            </h3>
            {list.length > 0 ? (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {list.map((shift) => (
                  <ShiftCard
                    key={`${shift.id}_${shift.scheduled_date}`}
                    shift={shift}
                    timezone={timezone}
                    members={members}
                    viewerId={viewerId}
                    onOpen={onOpen}
                    onTake={onTake}
                  />
                ))}
              </ul>
            ) : (
              <p className="m-0 text-sm text-ink-3">{t('noShiftsWeekDay')}</p>
            )}
          </section>
        );
      })}
      {onAdd && (
        <div>
          <Button
            variant="secondary"
            offlineKind="change"
            data-testid="shifts-week-add"
            leftIcon={<Icon name="add-outline" size="row" />}
            onClick={onAdd}
          >
            {t('addShift')}
          </Button>
        </div>
      )}
    </div>
  );
}
