import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent } from '@/api/calendarEvents';
import { formatEventTimeCompact } from '@/utils/timezone';
import { formatDateForDisplay, getWeekdayName, isSameMonth } from './dateMath';
import {
  EVENT_TYPE_DOT_CLASS,
  getEventCardClass,
  getEventTextClass,
  getMedicationStatus,
} from './eventStyles';

export interface MonthViewProps {
  /** 42 YYYY-MM-DD strings (6 Sunday-first weeks) covering the month grid. */
  gridDays: string[];
  /** First day (YYYY-MM-01) of the month being displayed. */
  monthStart: string;
  eventsByDay: Map<string, CalendarEvent[]>;
  careRecipientTimezone: string;
  /** Today's date string IN THE CARE RECIPIENT'S TIMEZONE. */
  todayStr: string;
  onEventClick: (event: CalendarEvent) => void;
}

const MAX_DOTS = 3;
const WEEKDAY_INDEXES = [0, 1, 2, 3, 4, 5, 6]; // 0=Sun..6=Sat
const EMPTY_DAY_EVENTS: CalendarEvent[] = [];

/**
 * Month view (plan Task 19): classic 6-week grid. Day cells show event dots
 * (capped at 3, then "+N"). Clicking a day opens a side panel listing that
 * day's events; clicking an event opens the detail modal. Outside-month days
 * are dimmed; today is highlighted.
 */
export function MonthView({
  gridDays,
  monthStart,
  eventsByDay,
  careRecipientTimezone,
  todayStr,
  onEventClick,
}: MonthViewProps): ReactElement {
  const { t, i18n } = useTranslation(['calendar', 'common']);
  const locale = i18n.language;
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const selectedEvents = selectedDay
    ? (eventsByDay.get(selectedDay) ?? EMPTY_DAY_EVENTS)
    : EMPTY_DAY_EVENTS;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div
        role="grid"
        aria-label={t('calendar:monthViewLabel')}
        className="rounded-2xl border border-line bg-cream"
      >
        {/* Weekday headers — names via Intl with the active locale */}
        <div role="row" className="grid grid-cols-7 border-b border-line-2">
          {WEEKDAY_INDEXES.map((dayIndex) => (
            <div
              key={dayIndex}
              role="columnheader"
              aria-label={getWeekdayName(dayIndex, locale, 'long')}
              className="p-2 text-center"
            >
              <span aria-hidden="true" className="mono">
                {getWeekdayName(dayIndex, locale, 'short')}
              </span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {gridDays.map((day, index) => {
            const events = eventsByDay.get(day) ?? EMPTY_DAY_EVENTS;
            const inMonth = isSameMonth(day, monthStart);
            const isToday = day === todayStr;
            const isSelected = day === selectedDay;
            return (
              <div
                key={day}
                role="gridcell"
                className={`min-h-20 border-line-2 p-1 ${index % 7 !== 0 ? 'border-l' : ''} ${
                  index >= 7 ? 'border-t' : ''
                } ${inMonth ? '' : 'bg-bg-2/60'}`}
              >
                <button
                  type="button"
                  data-date={day}
                  aria-pressed={isSelected}
                  aria-label={`${formatDateForDisplay(day, locale, {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                  })}, ${t('calendar:eventCount', { count: events.length })}`}
                  onClick={() => setSelectedDay(day)}
                  className={`flex h-full w-full flex-col items-center gap-1 rounded-lg p-1 text-center hover:bg-bg-2 ${
                    isSelected ? 'bg-bg-2 ring-1 ring-line' : ''
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-sm ${
                      isToday
                        ? 'bg-terracotta-deep font-medium text-cream'
                        : inMonth
                          ? 'text-ink'
                          : 'text-ink-3'
                    }`}
                  >
                    {formatDateForDisplay(day, locale, { day: 'numeric' })}
                  </span>
                  {events.length > 0 && (
                    <span aria-hidden="true" className="flex items-center gap-1">
                      {events.slice(0, MAX_DOTS).map((event, dotIndex) => (
                        <span
                          key={`${event.id}_${dotIndex}`}
                          className={`h-1.5 w-1.5 rounded-full ${EVENT_TYPE_DOT_CLASS[event.event_type]}`}
                        />
                      ))}
                      {events.length > MAX_DOTS && (
                        <span className="text-xs leading-none text-ink-3">
                          +{events.length - MAX_DOTS}
                        </span>
                      )}
                    </span>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Side panel — selected day's events, click-through to the modal */}
      <aside
        aria-label={t('calendar:dayPanelLabel')}
        className="rounded-2xl border border-line bg-cream p-4"
      >
        {selectedDay ? (
          <>
            <h3 className="m-0 text-lg font-semibold text-ink">
              {formatDateForDisplay(selectedDay, locale, {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}
            </h3>
            {selectedEvents.length === 0 ? (
              <p className="m-0 mt-3 text-sm text-ink-3">{t('calendar:noEventsDay')}</p>
            ) : (
              <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
                {selectedEvents.map((event) => {
                  const status = getMedicationStatus(event, careRecipientTimezone);
                  const title = event.medication_name || event.title;
                  const timeLabel = event.scheduled_time
                    ? formatEventTimeCompact(event.scheduled_time, careRecipientTimezone)
                    : t('calendar:allDay');
                  return (
                    <li key={`${event.id}_${event.scheduled_date}`}>
                      <button
                        type="button"
                        data-event-type={event.event_type}
                        data-med-status={status ?? undefined}
                        aria-label={[
                          title,
                          t(`calendar:eventTypes.${event.event_type}`),
                          timeLabel,
                          status ? t(`calendar:status.${status}`) : null,
                        ]
                          .filter(Boolean)
                          .join(', ')}
                        onClick={() => onEventClick(event)}
                        className={`block min-h-[44px] w-full rounded p-1.5 text-left ${getEventCardClass(event, status)}`}
                      >
                        <span className="flex items-baseline gap-1.5">
                          <span
                            className={`mono min-w-0 flex-1 truncate text-xs leading-tight ${getEventTextClass(event, status)} ${
                              status === 'skipped' ? 'line-through' : ''
                            }`}
                          >
                            {title}
                          </span>
                          <span
                            className={`mono shrink-0 text-[11px] leading-tight ${getEventTextClass(event, status)}`}
                          >
                            {timeLabel}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        ) : (
          <p className="m-0 text-sm text-ink-3">{t('calendar:selectDayHint')}</p>
        )}
      </aside>
    </div>
  );
}
