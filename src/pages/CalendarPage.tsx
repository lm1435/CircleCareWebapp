import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent } from '@/api/calendarEvents';
import { Button, Card, CircleButton, EmptyState, Icon, SegmentedControl } from '@/components/ui';
import { PageMasthead } from '@/components/layout/PageMasthead';
import { CareTabs } from '@/components/layout/CareTabs';
import { CalendarSkeleton } from '@/components/calendar/CalendarSkeleton';
import { EventDetailModal } from '@/components/calendar/EventDetailModal';
import { EventDetailActions } from '@/components/calendar/EventDetailActions';
import { AddEventModal } from '@/components/calendar/AddEventModal';
import { DeleteEventDialog } from '@/components/calendar/DeleteEventDialog';
import { DiscontinueMedDialog } from '@/components/calendar/DiscontinueMedDialog';
import { ConfirmMedDialog } from '@/components/meds/ConfirmMedDialog';
import { useCircle } from '@/hooks/useCircle';
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
import { Analytics } from '@/lib/analytics';
import { getDateInTimezone, getTimezoneLabel } from '@/utils/timezone';

type CalendarView = 'week' | 'month';

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
          <span
            aria-hidden="true"
            className={`h-2.5 w-2.5 rounded-full ${EVENT_TYPE_DOT_CLASS[type]}`}
          />
          {t(`eventTypes.${type}`)}
        </li>
      ))}
    </ul>
  );
}

/**
 * Calendar page (plan Task 17; chrome mirrors mobile's `DateNavHeader` — plan
 * Task 15): week/month toggle, prev/next/today navigation, current range
 * label, and the "Times shown in [timezone]" caption. The whole calendar
 * renders in the CARE RECIPIENT's timezone (same as mobile) — "today" and the
 * anchor date are computed with getDateInTimezone, never device-local.
 */
export default function CalendarPage(): ReactElement {
  const { circleId = '' } = useParams<{ circleId: string }>();
  const { t, i18n } = useTranslation(['calendar', 'common']);

  const [view, setView] = useState<CalendarView>('week');
  // null = follow "today" in the care recipient's timezone; set on user nav.
  const [anchorOverride, setAnchorOverride] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  // Write-flow modal state (Task 1.6) — owned by the page so the edit/delete
  // modals outlive the detail modal they were launched from.
  const [showCreate, setShowCreate] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [deletingEvent, setDeletingEvent] = useState<CalendarEvent | null>(null);
  const [discontinuingEvent, setDiscontinuingEvent] = useState<CalendarEvent | null>(null);
  // Dose confirmation launched from the detail modal. Held HERE, like every
  // other write dialog on this page, so ConfirmMedDialog outlives the detail
  // modal it came from and never renders as a modal inside a modal (two focus
  // traps fighting over Tab and Escape).
  const [confirmingDose, setConfirmingDose] = useState<{
    event: CalendarEvent;
    initialStatus: 'taken' | 'skipped';
  } | null>(null);

  // `members` is read here (not just `canEdit`) so the detail modal can
  // attribute a completed task's "Completed by" row: the calendar's own GET
  // does not embed the completing user (only the tasks endpoint does), so the
  // circle roster is the only fallback available to this surface.
  const { canEdit, members } = useCircle(circleId);

  // PHI-safe: only circle_id + the view enum. Fires on open and on view change.
  useEffect(() => {
    if (circleId) Analytics.calendarViewed(circleId, view);
  }, [circleId, view]);

  /**
   * Open an event's detail modal from the grid.
   *
   * For MEDICATIONS that modal renders <EventDetailActions> — the
   * Edit / Discontinue|Reactivate / Delete set — so a deliberate click on a
   * medication is the "action set opened" step of the adoption funnel. Tasks
   * and appointments get a different action set and are deliberately not
   * counted. Gated on `canEdit`: a view-only member's modal shows no actions at
   * all and must not dilute the denominator. Never fires on render or scroll.
   */
  function handleEventClick(event: CalendarEvent): void {
    if (event.event_type === 'medication' && canEdit) {
      Analytics.medicationActionsMenuOpened(circleId, {
        surface: 'calendar',
        isDiscontinued: !!event.discontinued_at,
      });
    }
    setSelectedEvent(event);
  }

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

  // The one surface that moves window-to-window: prefetch the neighbours so
  // Previous/Next land instantly. Everything else fetches only what it shows.
  const eventsQuery = useCalendarEvents(circleId, range?.start ?? '', range?.end ?? '', {
    prefetchAdjacent: true,
  });
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
      const startLabel = formatDateForDisplay(range.start, {
        month: 'short',
        day: 'numeric',
      });
      const endLabel = formatDateForDisplay(addDays(range.start, 6), {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
      return `${startLabel} – ${endLabel}`;
    }
    return formatDateForDisplay(startOfMonth(anchor), {
      month: 'long',
      year: 'numeric',
    });
  }, [anchor, range, view, i18n.language]);

  const isLoading = tzQuery.isLoading || (eventsQuery.isLoading && !!range);
  const isError = tzQuery.isError || eventsQuery.isError;

  const handleRetry = (): void => {
    if (tzQuery.isError) void tzQuery.refetch();
    if (eventsQuery.isError) void eventsQuery.refetch();
  };

  return (
    // max-w-7xl (1280px), not the max-w-5xl (1024px) every other page uses:
    // this is the one page whose content is a 7-column grid. At 1024 the week
    // view's day columns sat at 132px (titles truncated) with empty gutters
    // either side on a ≥1440 screen. ONE wrapper for the masthead and BOTH
    // views, so Week/Month switching never changes the width and the title and
    // "Add event" stay flush with the grid edges.
    <div className="mx-auto w-full max-w-7xl">
      <PageMasthead
        section={t('common:nav.calendar')}
        tone="dusk"
        title={t('calendar:title')}
        subtitle={t('calendar:subtitle')}
        rightAction={
          canEdit
            ? { name: 'add-outline', label: t('calendar:addEvent.addEvent'), onClick: () => setShowCreate(true) }
            : undefined
        }
      >
        <CareTabs />
      </PageMasthead>

      {/* px-5 at every width: the PageMasthead gutter. `md:px-8` put the
          toolbar and grid 12px inside the title and "Add event" button. */}
      <div className="px-5 pb-8">
        {/* Date nav row (mobile `DateNavHeader` parity): Today pill · prev/range/next
            cluster · Week/Month segmented control.

            Structural fix (review 2026-09-05, supersedes the earlier
            `flex-wrap` attempt): `flex-wrap` alone never actually broke this
            onto two lines. The cluster group's `min-w-0` told the flex-wrap
            algorithm its CONTENT-based minimum was 0, so the two items'
            hypothetical main sizes (0 + the toggle's 100%) fit on ONE line
            by the browser's own arithmetic — no wrap ever triggered, and the
            cluster's real (non-zero) content then rendered on top of the
            toggle's rectangle instead of pushed below it (measured: arrows at
            y≈330 h44 and the tablist at y≈325–379, same rectangle,
            "element intercepts pointer events" on Next week). `flex-col`
            below 480px removes the ambiguity: below that width the two
            children ALWAYS stack as separate blocks, full width, regardless
            of any min-width override. */}
        <div className="flex flex-wrap items-center gap-y-2 min-h-[44px] py-1.5 max-[480px]:flex-col max-[480px]:items-stretch">
          <div className="flex min-w-0 flex-1 items-center gap-2 max-[480px]:w-full">
            {/* Today: the mobile pill is visually 32px, but its tap target
                must still clear the 44px minimum (WCAG 2.5.5) — the button
                itself carries the 44px hit area; the pill is drawn on an
                inner span so the VISIBLE size stays mobile-parity 32px. */}
            <button
              type="button"
              onClick={handleToday}
              // Compare the RESOLVED anchor, not the override itself — an
              // explicit override that happens to equal today (e.g. forward
              // then back) must still disable Today, not just a null override.
              disabled={anchor === todayStr}
              aria-label={t('common:today')}
              className="flex min-h-[44px] shrink-0 items-center justify-center disabled:pointer-events-none disabled:opacity-50"
            >
              <span className="min-h-[32px] rounded-[6px] border border-line px-3 py-[5px] text-xs font-semibold text-ink">
                {t('common:today')}
              </span>
            </button>

            <div className="flex min-w-0 flex-1 items-center justify-center gap-2 px-3">
              <CircleButton
                name="chevron-back"
                label={view === 'week' ? t('calendar:previousWeek') : t('calendar:previousMonth')}
                onClick={handlePrev}
                shadow={false}
              />
              <h2 className="m-0 min-w-0 flex-shrink truncate text-center text-sm font-medium tracking-[0.3px] text-ink">
                {rangeLabel || t('calendar:title')}
              </h2>
              <CircleButton
                name="chevron-forward"
                label={view === 'week' ? t('calendar:nextWeek') : t('calendar:nextMonth')}
                onClick={handleNext}
                shadow={false}
              />
            </div>
          </div>

          <div
            data-testid="calendar-view-toggle-wrap"
            className="w-40 shrink-0 max-[480px]:order-last max-[480px]:w-full"
          >
            <SegmentedControl
              label={t('calendar:viewLabel')}
              value={view}
              onChange={(next) => setView(next as CalendarView)}
              options={[
                { value: 'week', label: t('calendar:week') },
                { value: 'month', label: t('calendar:month') },
              ]}
            />
          </div>
        </div>

        {/* Timezone caption + legend */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
          {timezone && (
            <p className="m-0 text-sm text-ink-3">
              {/* One name, not a name plus its own abbreviation in brackets:
                  this used to render "Mountain Time (MT)", and for anything
                  outside the seven curated US zones "Central European Standard
                  Time (GMT+1)". A zone is named by its city. */}
              {t('calendar:timesShownIn', { timezone: getTimezoneLabel(timezone) })}
            </p>
          )}
          {!isError && <CalendarLegend />}
        </div>

        <div>
          {isLoading && <CalendarSkeleton view={view} />}

          {!isLoading && isError && (
            <Card variant="outlined" className="text-center">
              <p className="m-0 font-medium text-ink">{t('calendar:errorTitle')}</p>
              <p className="m-0 mt-1 text-sm text-ink-3">{t('calendar:errorHint')}</p>
              <Button variant="ghost" className="mt-4" onClick={handleRetry}>
                {t('common:retry')}
              </Button>
            </Card>
          )}

          {!isLoading && !isError && range && timezone && todayStr && events.length === 0 && (
            <Card variant="outlined" padding="lg">
              <EmptyState
                tone="moss"
                icon={<Icon name="calendar-outline" size={26} />}
                title={view === 'week' ? t('calendar:noEventsWeek') : t('calendar:noEventsMonth')}
                description={canEdit ? t('calendar:empty.hint') : t('calendar:empty.hintReadOnly')}
              >
                {canEdit && (
                  <Button onClick={() => setShowCreate(true)}>
                    {t('calendar:addEvent.addEvent')}
                  </Button>
                )}
              </EmptyState>
            </Card>
          )}

          {!isLoading &&
            !isError &&
            range &&
            timezone &&
            todayStr &&
            events.length > 0 &&
            (view === 'week' ? (
              <WeekView
                days={getWeekDays(range.start)}
                eventsByDay={eventsByDay}
                careRecipientTimezone={timezone}
                todayStr={todayStr}
                onEventClick={handleEventClick}
              />
            ) : (
              <MonthView
                gridDays={getMonthGridDays(anchor as string)}
                monthStart={startOfMonth(anchor as string)}
                eventsByDay={eventsByDay}
                careRecipientTimezone={timezone}
                todayStr={todayStr}
                onEventClick={handleEventClick}
              />
            ))}
        </div>
      </div>

      {selectedEvent && timezone && (
        <EventDetailModal
          event={selectedEvent}
          careRecipientTimezone={timezone}
          circleId={circleId}
          canEdit={canEdit}
          members={members}
          editActions={
            <EventDetailActions
              circleId={circleId}
              event={selectedEvent}
              careRecipientTimezone={timezone}
              onEdit={() => {
                setEditingEvent(selectedEvent);
                setSelectedEvent(null);
              }}
              onDelete={() => {
                setDeletingEvent(selectedEvent);
                setSelectedEvent(null);
              }}
              onDiscontinue={() => {
                setDiscontinuingEvent(selectedEvent);
                setSelectedEvent(null);
              }}
              onConfirmDose={(initialStatus) => {
                setConfirmingDose({ event: selectedEvent, initialStatus });
                setSelectedEvent(null);
              }}
              onReactivated={() => {
                // The modal renders from this snapshot — clear discontinued_at
                // so the Inactive badge and the discontinue-toggle direction
                // reflect the reactivation without a close/reopen.
                setSelectedEvent((ev) => (ev ? { ...ev, discontinued_at: null } : ev));
              }}
              onCompleted={(completed) => {
                // Same snapshot problem as onReactivated: the open modal draws
                // its "Completed by / Completed on" row from `completed_at` on
                // THIS state, so a completion that really persisted otherwise
                // shows up only after a close and reopen — a working fix that
                // looks broken.
                //
                // MERGE ONLY THE COMPLETION FIELDS, never the whole returned
                // row. Completing a virtual occurrence beyond the materializer
                // horizon makes the server create a NEW physical row, so
                // `completed.id` is not the id this modal was opened with;
                // adopting it would swap the identity mid-view and remount
                // EventNotesPanel (which is keyed on `event.id`) under the
                // user. Everything else on screen — title, date, recurrence —
                // is unchanged by a completion anyway.
                setSelectedEvent((ev) =>
                  ev
                    ? {
                        ...ev,
                        completed_at: completed.completed_at ?? null,
                        // The calendar GET never embeds the completing user, so
                        // the id is what EventDetailModal resolves against the
                        // circle roster for the "Completed by <name>" row.
                        completed_by: completed.completed_by ?? ev.completed_by ?? null,
                      }
                    : ev
                );
              }}
            />
          }
          onClose={() => setSelectedEvent(null)}
        />
      )}

      {showCreate && <AddEventModal circleId={circleId} onClose={() => setShowCreate(false)} />}

      {editingEvent && (
        <AddEventModal
          circleId={circleId}
          event={editingEvent}
          onClose={() => setEditingEvent(null)}
        />
      )}

      {deletingEvent && (
        <DeleteEventDialog
          circleId={circleId}
          event={deletingEvent}
          surface="calendar"
          onClose={() => setDeletingEvent(null)}
        />
      )}

      {/* Dose confirmation for a medication opened from the grid. The calendar
          fetches WITHOUT `includeDiscontinued`, so every dose it shows is one
          the backend already found due — an INACTIVE medication's historical
          dose included. That is the whole point: a dose really given but not
          yet logged when the medication was stopped has to remain loggable, or
          it is counted missed in the adherence report forever. */}
      {confirmingDose && timezone && (
        <ConfirmMedDialog
          source="calendar"
          circleId={circleId}
          med={confirmingDose.event}
          careRecipientTimezone={timezone}
          initialStatus={confirmingDose.initialStatus}
          onClose={() => setConfirmingDose(null)}
        />
      )}

      {discontinuingEvent && (
        <DiscontinueMedDialog
          circleId={circleId}
          event={discontinuingEvent}
          // Whole-medication semantics: resolve every series of this med (same
          // name + dose) from the loaded window. Roots outside the window are
          // covered by the Medications page, the primary discontinue surface.
          events={events}
          surface="calendar"
          timezone={timezone ?? undefined}
          onClose={() => setDiscontinuingEvent(null)}
        />
      )}
    </div>
  );
}
