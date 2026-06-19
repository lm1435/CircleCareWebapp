import { useEffect, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent } from '@/api/calendarEvents';
import { formatEventTimeCompact, getCurrentHoursInTimezone } from '@/utils/timezone';
import { formatDateForDisplay } from './dateMath';
import { getEventCardClass, getEventStatusCue, getMedicationStatus } from './eventStyles';

export interface WeekViewProps {
  /** 7 YYYY-MM-DD strings (Sunday-first) in the care recipient's timezone. */
  days: string[];
  eventsByDay: Map<string, CalendarEvent[]>;
  careRecipientTimezone: string;
  /** Today's date string IN THE CARE RECIPIENT'S TIMEZONE (getDateInTimezone). */
  todayStr: string;
  onEventClick: (event: CalendarEvent) => void;
}

const HOUR_HEIGHT = 56; // px per hour — closer to mobile's roomier timeline feel
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const MIN_EVENT_MINUTES = 30;

function parseTimeToHours(time: string): number {
  const [h = '0', m = '0'] = time.split(':');
  return Number.parseInt(h, 10) + Number.parseInt(m, 10) / 60;
}

function formatHourLabel(hour: number, locale: string): string {
  // Hour-axis labels are pure clock labels — fixed UTC reference, no TZ math.
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2024, 0, 7, hour)));
}

/**
 * Week view (plan Task 18): 7-column grid with a time axis. Events are
 * positioned by their naive scheduled_time (already in the care recipient's
 * timezone — rendered as-is, no conversion). The current-time indicator uses
 * getCurrentHoursInTimezone and renders ONLY in today's column, where "today"
 * is computed in the care recipient's timezone.
 */
export function WeekView({
  days,
  eventsByDay,
  careRecipientTimezone,
  todayStr,
  onEventClick,
}: WeekViewProps): ReactElement {
  const { t, i18n } = useTranslation(['calendar', 'common']);
  const locale = i18n.language;

  // Re-render the current-time indicator every minute.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const currentTimeTop = getCurrentHoursInTimezone(careRecipientTimezone, now) * HOUR_HEIGHT;

  const timedEvents = (day: string): CalendarEvent[] =>
    (eventsByDay.get(day) ?? []).filter((event) => !!event.scheduled_time);
  const allDayEvents = (day: string): CalendarEvent[] =>
    (eventsByDay.get(day) ?? []).filter((event) => !event.scheduled_time);
  const hasAllDayRow = days.some((day) => allDayEvents(day).length > 0);

  const renderEventButton = (event: CalendarEvent, positioned: boolean): ReactElement => {
    const status = getMedicationStatus(event, careRecipientTimezone, now);
    const title = event.medication_name || event.title;
    const timeLabel = event.scheduled_time
      ? formatEventTimeCompact(event.scheduled_time, careRecipientTimezone)
      : t('calendar:allDay');
    const ariaLabel = [
      title,
      t(`calendar:eventTypes.${event.event_type}`),
      timeLabel,
      status ? t(`calendar:status.${status}`) : null,
    ]
      .filter(Boolean)
      .join(', ');

    const style = positioned
      ? {
          top: parseTimeToHours(event.scheduled_time as string) * HOUR_HEIGHT,
          height: Math.max(
            ((event.duration_minutes ?? MIN_EVENT_MINUTES) / 60) * HOUR_HEIGHT,
            (MIN_EVENT_MINUTES / 60) * HOUR_HEIGHT
          ),
        }
      : undefined;

    return (
      <button
        key={`${event.id}_${event.scheduled_date}_${event.scheduled_time ?? 'allday'}`}
        type="button"
        data-event-type={event.event_type}
        data-med-status={status ?? undefined}
        aria-label={ariaLabel}
        onClick={() => onEventClick(event)}
        style={style}
        className={`${
          positioned ? 'absolute inset-x-0.5 z-[1]' : 'relative w-full'
        } block overflow-hidden rounded p-1 text-left ${getEventCardClass(event)} ${getEventStatusCue(status)}`}
      >
        <span className="flex items-baseline gap-1">
          <span
            className={`mono min-w-0 flex-1 truncate text-[11px] leading-[14px] text-cream ${
              status === 'skipped' ? 'line-through' : ''
            }`}
          >
            {title}
          </span>
          {event.scheduled_time && (
            <span className="mono shrink-0 text-[10px] leading-[14px] text-cream/75">
              {timeLabel}
            </span>
          )}
        </span>
      </button>
    );
  };

  return (
    <div role="grid" aria-label={t('calendar:weekViewLabel')} className="rounded-2xl border border-line bg-cream">
      {/* Day headers */}
      <div role="row" className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b border-line-2">
        <div role="columnheader" className="p-2">
          <span className="sr-only">{t('calendar:timeColumnLabel')}</span>
        </div>
        {days.map((day) => {
          const count = (eventsByDay.get(day) ?? []).length;
          const isToday = day === todayStr;
          return (
            <div
              key={day}
              role="columnheader"
              aria-label={`${formatDateForDisplay(day, locale, {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}, ${t('calendar:eventCount', { count })}`}
              className="border-l border-line-2 p-1 text-center"
            >
              <div
                aria-hidden="true"
                className={`mx-auto flex flex-col items-center justify-center rounded-lg px-1 py-1 ${
                  isToday ? 'bg-ink' : ''
                }`}
              >
                <span
                  className={`mono block uppercase ${isToday ? 'text-cream' : 'text-ink-3'}`}
                >
                  {formatDateForDisplay(day, locale, { weekday: 'short' })}
                </span>
                <span
                  className={`mt-0.5 text-sm font-medium ${isToday ? 'text-cream' : 'text-ink'}`}
                >
                  {formatDateForDisplay(day, locale, { day: 'numeric' })}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* All-day row */}
      {hasAllDayRow && (
        <div role="row" className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b border-line-2">
          <div role="rowheader" className="p-1 text-right">
            <span className="mono">{t('calendar:allDay')}</span>
          </div>
          {days.map((day) => (
            <div key={day} role="gridcell" data-date={day} className="flex flex-col gap-1 border-l border-line-2 p-1">
              {allDayEvents(day).map((event) => renderEventButton(event, false))}
            </div>
          ))}
        </div>
      )}

      {/* Timed grid */}
      <div className="max-h-[60vh] overflow-y-auto">
        <div role="row" className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]">
          {/* Hour axis */}
          <div role="rowheader" aria-hidden="true" className="relative" style={{ height: 24 * HOUR_HEIGHT }}>
            {HOURS.map((hour) => (
              <span
                key={hour}
                className="mono absolute right-1 -translate-y-1/2 normal-case"
                style={{ top: hour * HOUR_HEIGHT }}
              >
                {hour === 0 ? '' : formatHourLabel(hour, locale)}
              </span>
            ))}
          </div>

          {days.map((day) => {
            const events = timedEvents(day);
            const isToday = day === todayStr;
            return (
              <div
                key={day}
                role="gridcell"
                data-date={day}
                aria-label={`${formatDateForDisplay(day, locale, {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                })}, ${t('calendar:eventCount', { count: events.length })}`}
                className={`relative border-l border-line-2 ${isToday ? 'bg-bg-2/50' : ''}`}
                style={{ height: 24 * HOUR_HEIGHT }}
              >
                {/* Hour gridlines */}
                {HOURS.slice(1).map((hour) => (
                  <div
                    key={hour}
                    aria-hidden="true"
                    className="absolute inset-x-0 border-t border-line-2"
                    style={{ top: hour * HOUR_HEIGHT }}
                  />
                ))}

                {/* Current-time indicator — ONLY on today's column (today in recipient TZ) */}
                {isToday && (
                  <div
                    data-testid="current-time-indicator"
                    aria-hidden="true"
                    title={t('calendar:currentTimeLabel')}
                    className="absolute inset-x-0 z-[2] h-0.5 bg-terracotta-deep"
                    style={{ top: currentTimeTop }}
                  >
                    <span className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full bg-terracotta-deep" />
                  </div>
                )}

                {events.map((event) => renderEventButton(event, true))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
