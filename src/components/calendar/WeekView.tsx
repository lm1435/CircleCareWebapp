import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent } from '@/api/calendarEvents';
import { formatEventTimeCompact, getCurrentHoursInTimezone } from '@/utils/timezone';
import { formatDateForDisplay } from './dateMath';
import { getEventCardClass, getEventTextClass, getMedicationStatus } from './eventStyles';

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

  // Earliest timed event in the week (so the grid opens on real content instead
  // of a wall of empty pre-dawn hours). Falls back to the current hour.
  const earliestHour = useMemo(() => {
    let min = Number.POSITIVE_INFINITY;
    for (const day of days) {
      for (const event of eventsByDay.get(day) ?? []) {
        if (event.scheduled_time) min = Math.min(min, parseTimeToHours(event.scheduled_time));
      }
    }
    return Number.isFinite(min) ? min : null;
  }, [days, eventsByDay]);

  // Auto-scroll the timed grid to that anchor on mount / week change. Mirrors
  // mobile's scrollToCurrentTime — keeps one hour of lead-in above the target.
  const scrollRef = useRef<HTMLDivElement>(null);
  const timedRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const targetHour = earliestHour ?? getCurrentHoursInTimezone(careRecipientTimezone);
    // The day-headers/all-day head is sticky and still occupies scroll height, so
    // offset by the timed grid's position before scrolling to the target hour.
    const base = timedRef.current?.offsetTop ?? 0;
    el.scrollTop = base + Math.max(0, (targetHour - 1) * HOUR_HEIGHT);
  }, [earliestHour, careRecipientTimezone, days]);

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
          // All-day chips get a ≥44px touch target (WCAG SC 2.5.5). The TIMED
          // chip is absolutely positioned with a height computed from the
          // event's duration — forcing min-h there would distort short events
          // and overlap neighbours, so it keeps its computed height (known
          // limitation; a min-height on timed chips would break the grid).
          positioned ? 'absolute inset-x-0.5 z-[1]' : 'relative min-h-[44px] w-full'
        } block overflow-hidden rounded p-1 text-left ${getEventCardClass(event, status)}`}
      >
        <span className="flex items-baseline gap-1">
          <span
            className={`mono min-w-0 flex-1 truncate text-[11px] leading-[14px] ${getEventTextClass(event, status)} ${
              status === 'skipped' ? 'line-through' : ''
            }`}
          >
            {title}
          </span>
          {event.scheduled_time && (
            <span className={`mono shrink-0 text-[10px] leading-[14px] ${getEventTextClass(event, status)}`}>
              {timeLabel}
            </span>
          )}
        </span>
      </button>
    );
  };

  return (
    <div
      role="grid"
      aria-label={t('calendar:weekViewLabel')}
      className="overflow-hidden rounded-2xl border border-line bg-cream"
    >
      {/* Single 2D scroller: pans horizontally (day columns, ~2 fit a phone via
          --dc + scroll-snap) AND scrolls vertically through the timed grid. The
          day-headers/all-day head is sticky-top and the hour rail is sticky-left,
          so both stay pinned to THIS scroller (the earlier split — a separate
          vertical scroller for the timed grid — made the rail pin to the wrong
          element and slide away on horizontal scroll). Reverts to a 7-across fit
          at lg. */}
      <div
        ref={scrollRef}
        role="presentation"
        className="snap-x snap-mandatory overflow-auto max-h-[70vh] scroll-pl-14 lg:snap-none"
      >
        <div
          role="rowgroup"
          className="relative w-max [--dc:calc((100vw_-_2rem_-_3.5rem)/2)] md:[--dc:calc((100vw_-_3rem_-_3.5rem)/3)] lg:w-auto lg:min-w-0 lg:[--dc:minmax(0,1fr)]"
        >
          {/* Pinned head — day headers + all-day stay at the top while the timed
              grid scrolls under them; their left cells also pin left. */}
          <div role="presentation" className="sticky top-0 z-[6] bg-cream">
          {/* Day headers */}
          <div
            role="row"
            className="grid grid-cols-[3.5rem_repeat(7,var(--dc))] border-b border-line-2"
          >
            <div role="columnheader" className="sticky left-0 z-[7] bg-cream p-2">
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
                  className="snap-start border-l border-line-2 p-1 text-center"
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
            <div
              role="row"
              className="grid grid-cols-[3.5rem_repeat(7,var(--dc))] border-b border-line-2"
            >
              <div role="rowheader" className="sticky left-0 z-[7] bg-cream p-1 text-right">
                <span className="mono">{t('calendar:allDay')}</span>
              </div>
              {days.map((day) => (
                <div
                  key={day}
                  role="gridcell"
                  data-date={day}
                  className="snap-start flex flex-col gap-1 border-l border-line-2 p-1"
                >
                  {allDayEvents(day).map((event) => renderEventButton(event, false))}
                </div>
              ))}
            </div>
          )}
          </div>

          {/* Timed grid — scrolls vertically under the pinned head; the hour rail
              pins left to the 2D scroller above. */}
          <div ref={timedRef} role="row" className="grid grid-cols-[3.5rem_repeat(7,var(--dc))]">
              {/* Hour axis — pinned so the labels stay visible while days scroll. */}
              <div
                role="rowheader"
                aria-hidden="true"
                className="sticky left-0 z-[5] bg-cream"
                style={{ height: 24 * HOUR_HEIGHT }}
              >
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
                    className={`relative snap-start border-l border-line-2 ${isToday ? 'bg-bg-2/50' : ''}`}
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
    </div>
  );
}
