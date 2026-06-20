import { useMemo, useState, type ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent } from '@/api/calendarEvents';
import { Button, Card } from '@/components/ui';
import { CalendarSkeleton } from '@/components/calendar/CalendarSkeleton';
import { EventDetailModal } from '@/components/calendar/EventDetailModal';
import { MonthView } from '@/components/calendar/MonthView';
import { WeekView } from '@/components/calendar/WeekView';
import {
  addDays,
  addMonths,
  formatDateForDisplay,
  getMonthGridDays,
  getWeekDays,
  startOfMonth,
  startOfWeek,
} from '@/components/calendar/dateMath';
import { EVENT_TYPE_DOT_CLASS } from '@/components/calendar/eventStyles';
import type { EventType } from '@/api/calendarEvents';
import { useCalendarEvents, useCareRecipientTimezone } from '@/hooks/useCalendarEvents';
import {
  getDateInTimezone,
  getTimezoneAbbreviation,
  getTimezoneLabel,
} from '@/utils/timezone';

type CalendarView = 'week' | 'month';

function ChevronIcon({ direction }: { direction: 'left' | 'right' }): ReactElement {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {direction === 'left' ? <path d="m15 18-6-6 6-6" /> : <path d="m9 18 6-6-6-6" />}
    </svg>
  );
}

const LEGEND_TYPES: EventType[] = ['medication', 'appointment', 'task'];

/**
 * Color key for the event-type palette (clay = meds, dusk = appointments,
 * moss = tasks). Surfaces the full color system even when the current view
 * only contains one type, so the calendar never reads as monochromatic.
 */
function CalendarLegend(): ReactElement {
  const { t } = useTranslation('calendar');
  return (
    <ul
      aria-label={t('legendLabel')}
      className="m-0 flex list-none flex-wrap items-center gap-x-4 gap-y-1 p-0"
    >
      {LEGEND_TYPES.map((type) => (
        <li key={type} className="flex items-center gap-1.5 text-xs text-ink-3">
          <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${EVENT_TYPE_DOT_CLASS[type]}`} />
          {t(`eventTypes.${type}`)}
        </li>
      ))}
    </ul>
  );
}

/**
 * Calendar page (plan Task 17): week/month toggle, prev/next/today navigation,
 * current range label, and the "Times shown in [timezone]" caption. The whole
 * calendar renders in the CARE RECIPIENT's timezone (same as mobile) — "today"
 * and the anchor date are computed with getDateInTimezone, never device-local.
 */
export default function CalendarPage(): ReactElement {
  const { circleId = '' } = useParams<{ circleId: string }>();
  const { t, i18n } = useTranslation(['calendar', 'common']);
  const locale = i18n.language;

  const [view, setView] = useState<CalendarView>('week');
  // null = follow "today" in the care recipient's timezone; set on user nav.
  const [anchorOverride, setAnchorOverride] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);

  const tzQuery = useCareRecipientTimezone(circleId);
  const timezone = tzQuery.timezone;

  const todayStr = timezone ? getDateInTimezone(timezone) : null;
  const anchor = anchorOverride ?? todayStr;

  const range = useMemo(() => {
    if (!anchor) return null;
    if (view === 'week') {
      const start = startOfWeek(anchor);
      return { start, end: addDays(start, 6) };
    }
    const gridStart = startOfWeek(startOfMonth(anchor));
    return { start: gridStart, end: addDays(gridStart, 41) };
  }, [anchor, view]);

  const eventsQuery = useCalendarEvents(circleId, range?.start ?? '', range?.end ?? '');
  const { events } = eventsQuery;

  const eventsByDay = useMemo(() => {
    const byDay = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      const list = byDay.get(event.scheduled_date);
      if (list) {
        list.push(event);
      } else {
        byDay.set(event.scheduled_date, [event]);
      }
    }
    return byDay;
  }, [events]);

  const handlePrev = (): void => {
    if (!anchor) return;
    setAnchorOverride(view === 'week' ? addDays(anchor, -7) : addMonths(anchor, -1));
  };
  const handleNext = (): void => {
    if (!anchor) return;
    setAnchorOverride(view === 'week' ? addDays(anchor, 7) : addMonths(anchor, 1));
  };
  const handleToday = (): void => setAnchorOverride(null);

  const rangeLabel = useMemo(() => {
    if (!anchor || !range) return '';
    if (view === 'week') {
      const startLabel = formatDateForDisplay(range.start, locale, {
        month: 'short',
        day: 'numeric',
      });
      const endLabel = formatDateForDisplay(addDays(range.start, 6), locale, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
      return `${startLabel} – ${endLabel}`;
    }
    return formatDateForDisplay(startOfMonth(anchor), locale, {
      month: 'long',
      year: 'numeric',
    });
  }, [anchor, range, view, locale]);

  const isLoading = tzQuery.isLoading || (eventsQuery.isLoading && !!range);
  const isError = tzQuery.isError || eventsQuery.isError;

  const handleRetry = (): void => {
    if (tzQuery.isError) void tzQuery.refetch();
    if (eventsQuery.isError) void eventsQuery.refetch();
  };

  return (
    <section className="mx-auto max-w-6xl p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="serif m-0 text-xl text-ink">{rangeLabel || t('common:nav.calendar')}</h1>
          {timezone && (
            <p className="m-0 mt-0.5 text-sm text-ink-3">
              {t('calendar:timesShownIn', {
                timezone: `${getTimezoneLabel(timezone)} (${getTimezoneAbbreviation(timezone)})`,
              })}
            </p>
          )}
          {!isError && <div className="mt-2"><CalendarLegend /></div>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Week/Month segmented control */}
          <div
            role="group"
            aria-label={t('calendar:viewLabel')}
            className="inline-flex rounded-full border border-line bg-bg-2 p-0.5"
          >
            <button
              type="button"
              aria-pressed={view === 'week'}
              onClick={() => setView('week')}
              className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
                view === 'week' ? 'bg-ink font-medium text-cream' : 'text-ink-2 hover:text-ink'
              }`}
            >
              {t('calendar:week')}
            </button>
            <button
              type="button"
              aria-pressed={view === 'month'}
              onClick={() => setView('month')}
              className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
                view === 'month' ? 'bg-ink font-medium text-cream' : 'text-ink-2 hover:text-ink'
              }`}
            >
              {t('calendar:month')}
            </button>
          </div>

          {/* Prev / Today / Next */}
          <div className="inline-flex items-center gap-1">
            <button
              type="button"
              aria-label={view === 'week' ? t('calendar:previousWeek') : t('calendar:previousMonth')}
              onClick={handlePrev}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-line text-ink transition-colors hover:bg-bg-2"
            >
              <ChevronIcon direction="left" />
            </button>
            <button
              type="button"
              onClick={handleToday}
              className="rounded-full border border-line px-4 py-1.5 text-sm text-ink transition-colors hover:bg-bg-2"
            >
              {t('common:today')}
            </button>
            <button
              type="button"
              aria-label={view === 'week' ? t('calendar:nextWeek') : t('calendar:nextMonth')}
              onClick={handleNext}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-line text-ink transition-colors hover:bg-bg-2"
            >
              <ChevronIcon direction="right" />
            </button>
          </div>
        </div>
      </header>

      <div className="mt-4">
        {isLoading && <CalendarSkeleton view={view} />}

        {!isLoading && isError && (
          <Card className="text-center">
            <p className="m-0 font-medium text-ink">{t('calendar:errorTitle')}</p>
            <p className="m-0 mt-1 text-sm text-ink-3">{t('calendar:errorHint')}</p>
            <Button variant="ghost" className="mt-4" onClick={handleRetry}>
              {t('common:retry')}
            </Button>
          </Card>
        )}

        {!isLoading && !isError && range && timezone && todayStr && events.length === 0 && (
          <Card className="text-center">
            <p className="m-0 text-ink-2">
              {view === 'week' ? t('calendar:noEventsWeek') : t('calendar:noEventsMonth')}
            </p>
          </Card>
        )}

        {!isLoading && !isError && range && timezone && todayStr && events.length > 0 && (
          view === 'week' ? (
            <WeekView
              days={getWeekDays(range.start)}
              eventsByDay={eventsByDay}
              careRecipientTimezone={timezone}
              todayStr={todayStr}
              onEventClick={setSelectedEvent}
            />
          ) : (
            <MonthView
              gridDays={getMonthGridDays(anchor as string)}
              monthStart={startOfMonth(anchor as string)}
              eventsByDay={eventsByDay}
              careRecipientTimezone={timezone}
              todayStr={todayStr}
              onEventClick={setSelectedEvent}
            />
          )
        )}
      </div>

      {selectedEvent && timezone && (
        <EventDetailModal
          event={selectedEvent}
          careRecipientTimezone={timezone}
          canEdit={false}
          onClose={() => setSelectedEvent(null)}
        />
      )}
    </section>
  );
}
