import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent } from '@/api/calendarEvents';
import { Card, Text } from '@/components/ui';
import { formatDateForDisplay, getWeekdayName, isSameMonth } from '@/components/calendar/dateMath';
import { countOpen, groupShiftsByDay } from './shiftUtils';

export interface ShiftsMonthViewProps {
  /** 42 `YYYY-MM-DD` strings (6 Sunday-first weeks). */
  gridDays: readonly string[];
  monthStart: string;
  shifts: readonly CalendarEvent[];
  todayStr: string;
  /** A day cell opens that day in Shifts. */
  onDayOpen: (day: string) => void;
}

const WEEKDAY_INDEXES = [0, 1, 2, 3, 4, 5, 6];
const NONE: CalendarEvent[] = [];

/**
 * Month: shifts are NOT drawn as blocks. A cell carries an AMBER dot when the
 * day has an open shift and a MOSS dot when it is fully covered. The dots are
 * decorative: the cell's accessible name says "3 shifts, 1 open" and a text
 * legend sits under the grid, so colour is never the only cue.
 */
export function ShiftsMonthView({
  gridDays,
  monthStart,
  shifts,
  todayStr,
  onDayOpen,
}: ShiftsMonthViewProps): ReactElement {
  const { t, i18n } = useTranslation('shifts');
  const language = i18n.language;
  const byDay = groupShiftsByDay(shifts);
  return (
    <div data-testid="shifts-month-view" className="flex flex-col gap-3">
      <Card variant="outlined" padding="none" role="grid" aria-label={t('month.label')}>
        <div role="row" className="grid grid-cols-7 border-b border-line-2">
          {WEEKDAY_INDEXES.map((dayIndex) => (
            <div
              key={dayIndex}
              role="columnheader"
              aria-label={getWeekdayName(dayIndex, 'long', language)}
              className="p-2 text-center"
            >
              <Text variant="mono" as="span">
                {getWeekdayName(dayIndex, 'short', language)}
              </Text>
            </div>
          ))}
        </div>
        {Array.from({ length: gridDays.length / 7 }, (_, week) => week).map((week) => (
          <div key={week} role="row" className="grid grid-cols-7">
            {gridDays.slice(week * 7, week * 7 + 7).map((day, col) => {
              const list = byDay.get(day) ?? NONE;
              const open = countOpen(list);
              const inMonth = isSameMonth(day, monthStart);
              const isToday = day === todayStr;
              const dayLabel = formatDateForDisplay(day, {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              });
              const label =
                list.length > 0
                  ? t('month.cell', { date: dayLabel, count: list.length, open: t('openCount', { count: open }) })
                  : t('month.none', { date: dayLabel });
              return (
                <div
                  key={day}
                  role="gridcell"
                  className={`min-h-16 border-line-2 p-1 ${col !== 0 ? 'border-l' : ''} ${
                    week > 0 ? 'border-t' : ''
                  } ${inMonth ? '' : 'bg-bg-2/60'}`}
                >
                  <button
                    type="button"
                    data-date={day}
                    data-shift-dots={list.length === 0 ? 'none' : open > 0 ? 'open' : 'covered'}
                    aria-current={isToday ? 'date' : undefined}
                    aria-label={label}
                    onClick={() => onDayOpen(day)}
                    className="flex h-full min-h-[44px] w-full flex-col items-center gap-1 rounded-lg p-1 text-center hover:bg-bg-2"
                  >
                    <span
                      aria-hidden="true"
                      className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-sm ${
                        isToday
                          ? 'bg-ink font-medium text-cream'
                          : inMonth
                            ? 'text-ink'
                            : 'text-ink-3'
                      }`}
                    >
                      {formatDateForDisplay(day, { day: 'numeric' })}
                    </span>
                    {list.length > 0 && (
                      <span
                        aria-hidden="true"
                        data-dot={open > 0 ? 'open' : 'covered'}
                        className={`h-2 w-2 rounded-full ${open > 0 ? 'border-[1.5px] border-moss bg-transparent' : 'bg-moss'}`}
                      />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </Card>
      <ShiftsLegend />
    </div>
  );
}

/** Text legend for the dots (also used under the Week/Day views' header strip). */
export function ShiftsLegend(): ReactElement {
  const { t } = useTranslation('shifts');
  return (
    <ul
      aria-label={t('legend.label')}
      className="m-0 flex list-none flex-wrap items-center gap-x-4 gap-y-1 p-0"
    >
      <li className="flex items-center gap-1.5 text-xs text-ink-3">
        <span
          aria-hidden="true"
          data-dot="open"
          className="h-2.5 w-2.5 rounded-full border-[1.5px] border-moss bg-transparent"
        />
        {t('legend.open')}
      </li>
      <li className="flex items-center gap-1.5 text-xs text-ink-3">
        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-moss" />
        {t('legend.covered')}
      </li>
    </ul>
  );
}
