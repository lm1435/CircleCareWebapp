import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent } from '@/api/calendarEvents';
import { Button, Card, CircleButton, EmptyState, Icon } from '@/components/ui';
import { useHourCycle } from '@/hooks/useHourCycle';
import {
  formatEventTimeCompact,
  getDateInTimezone,
  zoneReferenceInstant,
} from '@/utils/timezone';
import { AsNeededDayRow } from './AsNeededDayRow';
import type { AsNeededDayEntry } from './asNeededByDay';
import { addDays, formatDateForDisplay } from './dateMath';
import { eventAssigneeName, eventNoteCount } from './eventChipMeta';
import {
  getEventCardClass,
  getEventTextClass,
  getMedicationStatus,
  isInactiveMedication,
  type MedicationStatus,
} from './eventStyles';

export interface DayViewProps {
  /** The day shown, YYYY-MM-DD in the care recipient's timezone. */
  date: string;
  /** The loaded events; only those on `date` are shown. */
  events: CalendarEvent[];
  /** As-needed (PRN) doses logged on `date`, one entry per medication. */
  asNeeded: AsNeededDayEntry[];
  /** Care recipient's IANA timezone: "today" and every time label use it. */
  timezone: string;
  onEventClick: (event: CalendarEvent) => void;
  onAsNeededOpen?: (entry: AsNeededDayEntry) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  /** Present only for editors: the empty state then shows the Add CTA. */
  onAdd?: () => void;
  /**
   * SEAM for the Schedule | Shifts mode (care shifts). When provided it
   * replaces the schedule list + empty state below the hero; the hero
   * (title, prev/next/Today) stays shared.
   */
  shiftsSlot?: ReactNode;
  /** With `shiftsSlot`: the hero summary line ("3 shifts · 1 open."). */
  shiftsSummary?: string;
}

/** Midnight-first ordering: all-day rows, then by clock time, then by title. */
export function sortDayEvents(events: CalendarEvent[]): CalendarEvent[] {
  return [...events].sort((a, b) => {
    const at = a.scheduled_time ?? '';
    const bt = b.scheduled_time ?? '';
    if (at !== bt) return at < bt ? -1 : 1;
    const an = a.medication_name || a.title || '';
    const bn = b.medication_name || b.title || '';
    return an.localeCompare(bn);
  });
}

/**
 * Day view (mobile `renderDayView` twin): hero date title, summary line,
 * prev / next / Today, then the day's items sorted by time using the same
 * colours as the Week chips. Everything is in the care recipient's timezone.
 */
export function DayView({
  date,
  events,
  asNeeded,
  timezone,
  onEventClick,
  onAsNeededOpen,
  onPrev,
  onNext,
  onToday,
  onAdd,
  shiftsSlot,
  shiftsSummary,
}: DayViewProps): ReactElement {
  const { t } = useTranslation(['calendar', 'meds']);
  const hourCycle = useHourCycle();
  // Literal keys (not a template over the enum) so the key scanner can see them.
  const typeLabels: Record<CalendarEvent['event_type'], string> = {
    medication: t('calendar:eventTypes.medication'),
    appointment: t('calendar:eventTypes.appointment'),
    task: t('calendar:eventTypes.task'),
    shift: t('calendar:eventTypes.shift'),
  };
  const statusLabels: Record<MedicationStatus, string> = {
    taken: t('calendar:status.taken'),
    missed: t('calendar:status.missed'),
    skipped: t('calendar:status.skipped'),
    pending: t('calendar:status.pending'),
  };

  // Re-evaluate "now" each minute so the hero flips at the recipient's midnight.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const todayStr = getDateInTimezone(timezone, now);
  const isToday = date === todayStr;

  const dayEvents = useMemo(
    () => sortDayEvents(events.filter((e) => e.scheduled_date === date)),
    [events, date]
  );

  const doses = dayEvents.filter((e) => e.event_type === 'medication').length;
  const appointments = dayEvents.filter((e) => e.event_type === 'appointment').length;
  const tasks = dayEvents.filter((e) => e.event_type === 'task').length;
  const summary = shiftsSlot ? (shiftsSummary ?? '') : [
    doses > 0 ? t('calendar:daySummary.doses', { count: doses }) : '',
    appointments > 0 ? t('calendar:daySummary.appointments', { count: appointments }) : '',
    tasks > 0 ? t('calendar:daySummary.tasks', { count: tasks }) : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const weekday = formatDateForDisplay(date, { weekday: 'long' });
  const relative =
    date === todayStr
      ? t('calendar:today')
      : date === addDays(todayStr, -1)
        ? t('calendar:yesterday')
        : date === addDays(todayStr, 1)
          ? t('calendar:tomorrow')
          : null;
  const title = relative
    ? `${relative}, ${weekday}`
    : formatDateForDisplay(date, { weekday: 'long', month: 'long', day: 'numeric' });
  const subtitle = relative
    ? formatDateForDisplay(date, { month: 'long', day: 'numeric', year: 'numeric' })
    : null;

  const isEmpty = dayEvents.length === 0 && asNeeded.length === 0;

  return (
    <section aria-label={t('calendar:dayViewLabel')} data-testid="day-view">
      <div className="flex items-center gap-2 pb-4">
        <div className="min-w-0 flex-1">
          <h2
            data-testid="day-view-title"
            className="m-0 font-display text-2xl font-medium tracking-[-0.3px] text-ink"
          >
            {title}
          </h2>
          {subtitle && <p className="m-0 mt-0.5 text-sm text-ink-3">{subtitle}</p>}
          {summary && (
            <p data-testid="day-view-summary" className="m-0 mt-1 text-sm text-ink-2">
              {summary}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onToday}
          disabled={isToday}
          aria-label={t('calendar:today')}
          className="flex min-h-[44px] shrink-0 items-center justify-center disabled:pointer-events-none disabled:opacity-50"
        >
          <span className="min-h-[32px] rounded-[6px] border border-line px-3 py-[5px] text-xs font-semibold text-ink">
            {t('calendar:today')}
          </span>
        </button>
        <CircleButton
          name="chevron-back"
          label={t('calendar:previousDay')}
          onClick={onPrev}
          shadow={false}
        />
        <CircleButton
          name="chevron-forward"
          label={t('calendar:nextDay')}
          onClick={onNext}
          shadow={false}
        />
      </div>

      {shiftsSlot ?? (
        <>
          {asNeeded.length > 0 && (
            <div className="flex flex-col gap-2 pb-3">
              {asNeeded.map((entry) => (
                <AsNeededDayRow key={entry.eventId} entry={entry} onOpen={onAsNeededOpen ?? noop} />
              ))}
            </div>
          )}

          {dayEvents.length > 0 && (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {dayEvents.map((event) => {
                const status = getMedicationStatus(event, timezone, now);
                const name = event.medication_name || event.title;
                const timeLabel = event.scheduled_time
                  ? formatEventTimeCompact(
                      event.scheduled_time,
                      timezone,
                      hourCycle,
                      zoneReferenceInstant(event.scheduled_date)
                    )
                  : t('calendar:allDay');
                const inactive = isInactiveMedication(event);
                const assignee = eventAssigneeName(event);
                const noteCount = eventNoteCount(event);
                const typeLabel = typeLabels[event.event_type];
                const statusLabel = status ? statusLabels[status] : null;
                const inactiveLabel = t('calendar:discontinueMed.inactiveBadge');
                const noteLabel =
                  noteCount > 0 ? t('calendar:notes.noteCount', { count: noteCount }) : null;
                const ariaLabel = [
                  name,
                  typeLabel,
                  timeLabel,
                  statusLabel,
                  inactive ? inactiveLabel : null,
                  assignee,
                  noteLabel,
                ]
                  .filter(Boolean)
                  .join(', ');
                const text = getEventTextClass(event, status);
                return (
                  <li key={`${event.id}_${event.scheduled_date}_${event.scheduled_time ?? 'allday'}`}>
                    <button
                      type="button"
                      data-testid="day-event"
                      data-event-type={event.event_type}
                      data-med-status={status ?? undefined}
                      aria-label={ariaLabel}
                      onClick={() => onEventClick(event)}
                      className={`block min-h-[56px] w-full rounded-lg p-3 text-left ${getEventCardClass(event, status)}`}
                    >
                      <span className={`flex items-baseline justify-between gap-3 ${text}`}>
                        <span
                          className={`min-w-0 break-words text-sm font-medium ${
                            status === 'skipped' ? 'line-through' : ''
                          }`}
                        >
                          {name}
                        </span>
                        <span className="shrink-0 text-xs">{timeLabel}</span>
                      </span>
                      <span className={`mt-0.5 flex flex-wrap items-center gap-x-2 text-xs ${text}`}>
                        <span>{typeLabel}</span>
                        {statusLabel && <span>{statusLabel}</span>}
                        {inactive && <span>{inactiveLabel}</span>}
                        {assignee && <span className="truncate">{assignee}</span>}
                        {noteCount > 0 && (
                          <span data-testid="event-chip-notes" className="flex items-center gap-0.5">
                            <Icon name="document-text" size={10} />
                            {noteCount}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {isEmpty && (
            <Card variant="outlined" padding="lg">
              <EmptyState
                tone="moss"
                icon={<Icon name="calendar-outline" size={26} />}
                title={t('calendar:noEventsDay')}
                description={onAdd ? t('calendar:empty.hint') : t('calendar:empty.hintReadOnly')}
              >
                {onAdd && (
                  <Button onClick={onAdd} offlineKind="change">
                    {t('calendar:addEvent.addEvent')}
                  </Button>
                )}
              </EmptyState>
            </Card>
          )}
        </>
      )}
    </section>
  );
}

function noop(): void {}
