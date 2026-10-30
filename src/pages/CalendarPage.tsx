import { HowDoesThisWork } from '@/components/help/HowDoesThisWork';
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getSeriesRoot as fetchEventRow, type CalendarEvent } from '@/api/calendarEvents';
import {
  Button,
  Card,
  CircleButton,
  EmptyState,
  Icon,
  SegmentedControl,
  UnderlineTabs,
} from '@/components/ui';
import { prefersReducedMotion } from '@/components/ui/motion';
import { PageMasthead } from '@/components/layout/PageMasthead';
import { CareTabs } from '@/components/layout/CareTabs';
import { CalendarSkeleton } from '@/components/calendar/CalendarSkeleton';
import { EventDetailModal } from '@/components/calendar/EventDetailModal';
import { EventDetailActions } from '@/components/calendar/EventDetailActions';
import { AddEventModal } from '@/components/calendar/AddEventModal';
import { DeleteEventDialog } from '@/components/calendar/DeleteEventDialog';
import { DiscontinueMedDialog } from '@/components/calendar/DiscontinueMedDialog';
import { ConfirmMedDialog } from '@/components/meds/ConfirmMedDialog';
import { ReminderRoutingNotice } from '@/components/calendar/ReminderRoutingNotice';
import { useCircle } from '@/hooks/useCircle';
import { MonthView } from '@/components/calendar/MonthView';
import { WeekView } from '@/components/calendar/WeekView';
import { DayView } from '@/components/calendar/DayView';
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
import { useCircleAsNeededDoses } from '@/hooks/useAsNeeded';
import { DoseHistoryModal } from '@/components/meds/DoseHistoryModal';
import { groupDosesByDay, type AsNeededDayEntry } from '@/components/calendar/asNeededByDay';
import { getDateInTimezone, getTimezoneLabel } from '@/utils/timezone';
import { useAuthStore } from '@/store/authStore';
import { canWriteShifts, resolveShiftsEntry } from '@/lib/shiftsAccess';
import { ShiftsReadOnlyNotice } from '@/components/shifts/ShiftsReadOnlyNotice';
import { useOpenShiftCount, useShiftsByRange, useShiftsPeek } from '@/hooks/useShifts';
import { useShiftsDialogs } from '@/components/shifts/ShiftsDialogs';
import { ShiftsDayList } from '@/components/shifts/ShiftsDayList';
import { RemovedState } from '@/components/RemovedState';
import { useEmailLinkLanding } from '@/lib/emailLinkLanding';
import { ShiftsWeekView } from '@/components/shifts/ShiftsWeekView';
import { ShiftsLegend, ShiftsMonthView } from '@/components/shifts/ShiftsMonthView';
import { ShiftsEmptyState } from '@/components/shifts/ShiftsEmptyState';
import { ShiftsTeaserDialog } from '@/components/shifts/ShiftsTeaserDialog';
import { canCoverShifts, countOpen } from '@/components/shifts/shiftUtils';

type CalendarView = 'day' | 'week' | 'month';
type CalendarMode = 'schedule' | 'shifts';

const EMPTY_AS_NEEDED: AsNeededDayEntry[] = [];

const LEGEND_TYPES: EventType[] = ['medication', 'appointment', 'task'];

// ---------------------------------------------------------------------------
// Notes-first-class deep link (docs/plans/notes-first-class.md, Slice 2, Task
// 26): an Activity note row links here as
// `?date=YYYY-MM-DD&eventId=<series root id>&panel=notes`. `eventId` is
// ALWAYS the series root (`parent_event_id ?? id`), per the backend's
// `note_target` contract (activityFeed.ts task 8) — never the physical/virtual
// instance the note itself lives on — so the match below has to allow for
// that: the root ON its own date, or the child/virtual instance whose
// `parent_event_id` is that root, on the linked date.
// ---------------------------------------------------------------------------

const DATE_PARAM_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The id EventNotesPanel's own heading renders under (its `aria-labelledby`
 *  target) — `panel=notes` scrolls here once the modal is open. */
const EVENT_NOTES_HEADING_ID = 'event-notes-heading';

interface PendingNoteLink {
  date: string;
  eventId: string;
  panel: string | null;
}

/** Root-on-its-date, else the child/virtual row whose parent is that root on
 *  that date. `null` when neither exists in the loaded window. */
function findNoteLinkMatch(events: CalendarEvent[], link: PendingNoteLink): CalendarEvent | null {
  const root = events.find((e) => e.id === link.eventId && e.scheduled_date === link.date);
  if (root) return root;
  const child = events.find(
    (e) => e.parent_event_id === link.eventId && e.scheduled_date === link.date
  );
  return child ?? null;
}

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
  const navigate = useNavigate();
  const { circleId = '' } = useParams<{ circleId: string }>();
  const { t, i18n } = useTranslation(['calendar', 'common', 'shifts']);
  const [searchParams, setSearchParams] = useSearchParams();

  // `?date=&eventId=&panel=` deep link (Task 26) — captured ONCE, before the
  // effect below scrubs it from the URL. An incomplete/malformed pair (no
  // `date`, no `eventId`, or a non-YYYY-MM-DD date) is dropped right here; the
  // page then renders exactly as it would with no params at all.
  const [datedLink] = useState<PendingNoteLink | null>(() => {
    const date = searchParams.get('date');
    const eventId = searchParams.get('eventId');
    if (date && DATE_PARAM_RE.test(date) && eventId) {
      return { date, eventId, panel: searchParams.get('panel') };
    }
    return null;
  });
  // `?eventId=` ALONE (a daily update's completed-task row): the row's own
  // date is not in the link — a task can be completed on another day than
  // its schedule — so it is read from GET /events/:id first, then handled
  // exactly like a dated link. A 404 (deleted) reads "This item is no longer
  // available." instead of an error.
  const [idOnlyLink] = useState<string | null>(() => {
    const date = searchParams.get('date');
    const eventId = searchParams.get('eventId');
    return !date && eventId ? eventId : null;
  });
  const [resolvedLink, setResolvedLink] = useState<PendingNoteLink | null>(null);
  // A link whose event is gone: the shared removed state (same as mobile) in
  // place of the old toast. `date` is the link's own date when the URL had one.
  const [removedLink, setRemovedLink] = useState<{ date: string | null } | null>(null);
  const fromEmail = Boolean(searchParams.get('src'));
  const reportLanding = useEmailLinkLanding();
  // `?eventId=` with a date that is not a real YYYY-MM-DD: the link names an
  // item we cannot resolve. Reported as gone (analytics only; the page renders
  // exactly as it would with no params, as before).
  useEffect(() => {
    if (searchParams.get('eventId') && !datedLink && !idOnlyLink) reportLanding(false);
    // Mount-only: the captured link never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const pendingNoteLink = datedLink ?? resolvedLink;
  const noteLinkHandledRef = useRef(false);
  const idOnlyStartedRef = useRef(false);
  // Set once the deep link's match is found and `panel=notes` — consumed by
  // the effect below to scroll to the notes panel once the modal is open.
  const scrollToNotesRef = useRef(false);

  const [view, setView] = useState<CalendarView>('week');
  // null = follow "today" in the care recipient's timezone; set on user nav.
  // A note deep link starts the view on ITS date's week (plan: "move the view
  // to that date's week") rather than the default today-week, and does so on
  // the FIRST render — an effect that set this after mount would fetch the
  // wrong week once, then refetch the right one.
  const [anchorOverride, setAnchorOverride] = useState<string | null>(
    () => pendingNoteLink?.date ?? null
  );
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  // Write-flow modal state (Task 1.6) — owned by the page so the edit/delete
  // modals outlive the detail modal they were launched from.
  const [showCreate, setShowCreate] = useState(false);
  // Which control opened the create form (analytics: entry_form_opened.entry).
  const [createEntry, setCreateEntry] = useState<'empty_state' | 'other'>('other');
  const openCreate = (entry: 'empty_state' | 'other'): void => {
    setCreateEntry(entry);
    setShowCreate(true);
  };
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
  const { canEdit, members, viewOnly, isPremiumCircle, isOwner, hasShifts } = useCircle(circleId);
  const viewerId = useAuthStore((s) => s.user?.id ?? null);

  // Schedule | Shifts (care shifts). Premium circles: everyone. Free circles:
  // the OWNER only (the segment opens the teaser). Free managers / members get
  // no control at all.
  // A free circle that still HAS shifts ('readonly', Premium lapsed) keeps the toggle and
  // the lists for every non-view-only role; `shiftsCanWrite` is false there, so every shift
  // write control below is gone even where `canEdit` is true.
  const shiftsEntry = resolveShiftsEntry({ viewOnly, isPremiumCircle, isOwner, hasShifts });
  const shiftsCanWrite = canWriteShifts(shiftsEntry, canEdit);
  // `?mode=shifts` (Today's "Shifts" link and the shifts nudge) opens straight on
  // Shifts. Read once as the initial mode; `shiftsMode` below still gates it on
  // the viewer's access, so a link can never open a surface they do not have.
  const [mode, setMode] = useState<CalendarMode>(() =>
    searchParams.get('mode') === 'shifts' ? 'shifts' : 'schedule'
  );
  const [teaserOpen, setTeaserOpen] = useState(false);
  const shiftsReadable = shiftsEntry === 'available' || shiftsEntry === 'readonly';
  const shiftsMode = mode === 'shifts' && shiftsReadable;
  const shiftDialogs = useShiftsDialogs(circleId);

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
    // Day: that single date in the recipient's timezone (spec W10).
    if (view === 'day') return { start: anchor, end: anchor };
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
    // The Shifts view has its own query; Schedule is not fetched behind it.
    enabled: !shiftsMode,
  });
  const { events } = eventsQuery;

  // Shifts mode: its own bounded range query, only while selected.
  const shiftsQuery = useShiftsByRange(
    circleId,
    range?.start ?? '',
    range?.end ?? '',
    shiftsMode
  );
  const { shifts } = shiftsQuery;
  // Open-shift count: feeds only the shifts_view_opened `open_count_bucket` (no UI shows it).
  const openCount = useOpenShiftCount(circleId, timezone, shiftsReadable);
  // The same 7-day window's rows: the empty state needs "nothing anywhere" too.
  const shiftsPeek = useShiftsPeek(circleId, timezone, shiftsReadable);

  // AS-NEEDED doses are not events: the calendar's own query above never asks for
  // them. This SEPARATE read (circle-wide dose log over the visible range, live
  // doses only) only marks the days a dose was logged. FAIL-SOFT: on any error
  // `doses` is empty — no marker, the calendar is unaffected.
  const { doses: asNeededDoses } = useCircleAsNeededDoses(
    circleId,
    range ? { start_date: range.start, end_date: range.end } : undefined,
    {
      includeRemoved: false,
      enabled: !!timezone && !shiftsMode,
    }
  );
  const asNeededByDay = useMemo(
    () => (timezone ? groupDosesByDay(asNeededDoses, timezone) : new Map<string, AsNeededDayEntry[]>()),
    [asNeededDoses, timezone]
  );
  const [doseHistoryFor, setDoseHistoryFor] = useState<AsNeededDayEntry | null>(null);

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
    setAnchorOverride(
      view === 'day' ? addDays(anchor, -1) : view === 'week' ? addDays(anchor, -7) : addMonths(anchor, -1)
    );
  };
  const handleNext = (): void => {
    if (!anchor) return;
    setAnchorOverride(
      view === 'day' ? addDays(anchor, 1) : view === 'week' ? addDays(anchor, 7) : addMonths(anchor, 1)
    );
  };
  const handleToday = (): void => setAnchorOverride(null);
  // Week day header / Month cell -> Day for that date (mobile parity). The
  // anchor is the one shared selected date, so Day/Week/Month all follow it.
  const handleOpenDay = (day: string): void => {
    setAnchorOverride(day);
    setView('day');
  };

  const rangeLabel = useMemo(() => {
    if (!anchor || !range) return '';
    if (view === 'day') {
      return formatDateForDisplay(anchor, { weekday: 'long', month: 'long', day: 'numeric' });
    }
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

  // The empty-state card: only when the window holds today AND the 7-day peek is
  // empty too (a Week/Month that merely has no shifts shows its own empty days).
  const nothingAnywhere =
    shiftsMode &&
    !!range &&
    !!todayStr &&
    todayStr >= range.start &&
    todayStr <= range.end &&
    shifts.length === 0 &&
    shiftsPeek !== undefined &&
    shiftsPeek.length === 0;

  const readonlyNotice =
    shiftsMode && shiftsEntry === 'readonly' ? (
      <ShiftsReadOnlyNotice
        isOwner={isOwner}
        onRenew={() => navigate('/upgrade', { state: { paywallContext: 'shifts' } })}
      />
    ) : null;
  const activeQuery = shiftsMode ? shiftsQuery : eventsQuery;
  const isLoading = tzQuery.isLoading || (activeQuery.isLoading && !!range);
  // Shifts mode keeps its rows when a BACKGROUND refetch fails (only a failure
  // with nothing to show replaces the content).
  const isError =
    tzQuery.isError || (shiftsMode ? shiftsQuery.isError && !shiftsQuery.data : eventsQuery.isError);

  const handleRetry = (): void => {
    if (tzQuery.isError) void tzQuery.refetch();
    if (activeQuery.isError) void activeQuery.refetch();
  };

  // shifts_view_opened: once per (mode entry, range), as soon as the open-count
  // query settles (success OR error: an error reports a 0 bucket). enums + a
  // count bucket only.
  const viewedShiftsRef = useRef<string | null>(null);
  useEffect(() => {
    if (!shiftsMode) {
      viewedShiftsRef.current = null;
      return;
    }
    if (!openCount.settled || viewedShiftsRef.current === view) return;
    viewedShiftsRef.current = view;
    Analytics.shiftsViewOpened({
      range: view,
      openCount: openCount.count ?? 0,
      access: shiftsEntry === 'readonly' ? 'readonly' : 'full',
    });
  }, [shiftsMode, view, openCount.settled, openCount.count, shiftsEntry]);

  // Resolve the `?date&eventId&panel` deep link once its week's events have
  // settled (loaded, or errored — either way there is nothing left to wait
  // for). Runs exactly once: the ref guard, not the params themselves, is
  // what stops a second pass, because the params are cleared as part of the
  // SAME effect run that found (or missed) the match.
  useEffect(() => {
    if (!idOnlyLink || idOnlyStartedRef.current || !circleId) return;
    idOnlyStartedRef.current = true;
    fetchEventRow(circleId, idOnlyLink)
      .then((row) => {
        setAnchorOverride(row.scheduled_date);
        setResolvedLink({
          date: row.scheduled_date,
          eventId: idOnlyLink,
          panel: searchParams.get('panel'),
        });
      })
      .catch(() => {
        noteLinkHandledRef.current = true;
        setRemovedLink({ date: null });
        reportLanding(false);
        const next = new URLSearchParams(searchParams);
        next.delete('eventId');
        next.delete('panel');
        setSearchParams(next, { replace: true });
      });
  }, [idOnlyLink, circleId, searchParams, setSearchParams, reportLanding]);

  useEffect(() => {
    if (!pendingNoteLink || noteLinkHandledRef.current) return;
    if (isLoading || eventsQuery.isFetching) return;

    noteLinkHandledRef.current = true;
    const match = findNoteLinkMatch(events, pendingNoteLink);
    if (match) {
      setSelectedEvent(match);
      if (pendingNoteLink.panel === 'notes') scrollToNotesRef.current = true;
      reportLanding(true);
    } else {
      // Edge case (plan): "Web deep link to an event that no longer exists:
      // calendar opens at the date with no modal" plus the shared removed state
      // (this used to be a toast).
      setRemovedLink({ date: pendingNoteLink.date });
      reportLanding(false);
    }

    const next = new URLSearchParams(searchParams);
    next.delete('date');
    next.delete('eventId');
    next.delete('panel');
    setSearchParams(next, { replace: true });
  }, [pendingNoteLink, isLoading, eventsQuery.isFetching, events, searchParams, setSearchParams, reportLanding]);

  // Once the matched event's detail modal is open, scroll its notes panel
  // into view for a `panel=notes` link (EventNotesPanel renders its heading
  // under EVENT_NOTES_HEADING_ID — see its own `aria-labelledby`).
  useEffect(() => {
    if (!scrollToNotesRef.current || !selectedEvent) return;
    scrollToNotesRef.current = false;
    document
      .getElementById(EVENT_NOTES_HEADING_ID)
      // Reduced motion honoured (WCAG 2.3.3; the CSS block cannot reach a JS scroll).
      ?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }, [selectedEvent]);

  return (
    // max-w-7xl (1280px), not the max-w-5xl (1024px) every other page uses:
    // this is the one page whose content is a 7-column grid. At 1024 the week
    // view's day columns sat at 132px (titles truncated) with empty gutters
    // either side on a ≥1440 screen. ONE wrapper for the masthead and BOTH
    // views, so Week/Month switching never changes the width and the title and
    // "Add event" stay flush with the grid edges.
    <div className="mx-auto w-full max-w-7xl">
      <PageMasthead
        section={shiftsMode ? t('shifts:eyebrow') : t('common:nav.calendar')}
        tone="dusk"
        title={t('calendar:title')}
        subtitle={t('calendar:subtitle')}
        rightAction={
          (shiftsMode ? shiftsCanWrite : canEdit)
            ? {
                name: 'add-outline',
                label: shiftsMode ? t('shifts:addShift') : t('calendar:addEvent.addEvent'),
                onClick: () =>
                  shiftsMode
                    ? shiftDialogs.openCreate('shifts_view', anchor ?? undefined)
                    : openCreate('other'),
                offlineKind: 'change',
              }
            : undefined
        }
      >
        <CareTabs />
      </PageMasthead>

      {removedLink ? (
        <RemovedState
          reason="removed"
          date={removedLink.date}
          fromEmail={fromEmail}
          onDismiss={() => setRemovedLink(null)}
        />
      ) : null}

      {/* px-5 at every width: the PageMasthead gutter. `md:px-8` put the
          toolbar and grid 12px inside the title and "Add event" button. */}
      <div className="px-5 pb-8">
        {shiftsEntry !== 'hidden' && (
          <div data-testid="calendar-mode-wrap" className="max-w-sm py-1.5">
            <SegmentedControl
              label={t('shifts:mode.label')}
              value={shiftsMode ? 'shifts' : 'schedule'}
              onChange={(next) => {
                if (next === 'shifts' && shiftsEntry === 'teaser') {
                  setTeaserOpen(true);
                  return;
                }
                setMode(next as CalendarMode);
              }}
              options={[
                { value: 'schedule', label: t('shifts:mode.schedule') },
                {
                  value: 'shifts',
                  label: t('shifts:mode.shifts'),
                },
              ]}
            />
          </div>
        )}
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
          {/* Day owns its own prev/next/Today inside DayView's hero, so the
              page cluster is only drawn for Week and Month. */}
          {view !== 'day' && (
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
          )}

          <div
            data-testid="calendar-view-toggle-wrap"
            className="ml-auto w-64 shrink-0 max-[480px]:order-last max-[480px]:w-full"
          >
            <UnderlineTabs
              label={t('calendar:viewLabel')}
              value={view}
              onChange={(next) => setView(next as CalendarView)}
              options={[
                { value: 'day', label: t('calendar:day') },
                { value: 'week', label: t('calendar:week') },
                { value: 'month', label: t('calendar:month') },
              ]}
            />
          </div>
        </div>

        {/* Timezone caption + legend */}
        {/* Day draws its own date nav inside DayView's hero, so there the notice rides the
            slot (below the nav, as on mobile); Week / Month show it here, under their toolbar. */}
        {readonlyNotice && view !== 'day' && readonlyNotice}

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
          {!isError && !shiftsMode && <CalendarLegend />}
          {!isError && shiftsMode && view !== 'month' && <ShiftsLegend />}
        </div>

        {/* Who gets the medication reminders (owner only, dismissable): mobile
            CalendarScreen parity. Schedule mode only: shifts have no doses. */}
        {!shiftsMode && circleId && (
          <ReminderRoutingNotice
            circleId={circleId}
            hasMedications={events.some((e) => e.event_type === 'medication')}
          />
        )}

        <div>
          {isLoading && <CalendarSkeleton view={view} />}

          {!isLoading && isError && (
            <Card variant="outlined" className="text-center">
              <p className="m-0 font-medium text-ink">
                {shiftsMode ? t('shifts:loadError') : t('calendar:errorTitle')}
              </p>
              {!shiftsMode && (
                <p className="m-0 mt-1 text-sm text-ink-3">{t('calendar:errorHint')}</p>
              )}
              <Button variant="ghost" className="mt-4" onClick={handleRetry}>
                {t('common:retry')}
              </Button>
            </Card>
          )}

          {!isLoading &&
            !isError &&
            range &&
            timezone &&
            todayStr &&
            !shiftsMode &&
            view !== 'day' &&
            events.length === 0 &&
            asNeededByDay.size === 0 && (
            <Card variant="outlined" padding="lg">
              <EmptyState
                tone="moss"
                icon={<Icon name="calendar-outline" size={26} />}
                title={view === 'week' ? t('calendar:noEventsWeek') : t('calendar:noEventsMonth')}
                description={canEdit ? t('calendar:empty.hint') : t('calendar:empty.hintReadOnly')}
              >
                {canEdit && (
                  <Button
                    onClick={() => {
                      setCreateEntry('empty_state');
                      setShowCreate(true);
                    }}
                    offlineKind="change"
                  >
                    {t('calendar:addEvent.addEvent')}
                  </Button>
                )}
                <HowDoesThisWork slug="appointments" />
              </EmptyState>
            </Card>
          )}

          {shiftsMode && !isLoading && !isError && range && timezone && todayStr && anchor && (
            view === 'day' ? (
              <DayView
                date={anchor}
                events={[]}
                asNeeded={EMPTY_AS_NEEDED}
                timezone={timezone}
                onEventClick={handleEventClick}
                onPrev={handlePrev}
                onNext={handleNext}
                onToday={handleToday}
                shiftsSummary={(() => {
                  const day = shifts.filter((sh) => sh.scheduled_date === anchor);
                  return day.length > 0
                    ? t('shifts:summary', { count: day.length, open: t('shifts:openCount', { count: countOpen(day) }) })
                    : '';
                })()}
                shiftsSlot={
                  <>
                  {readonlyNotice}
                  {nothingAnywhere ? (
                    <ShiftsEmptyState
                      onAdd={shiftsCanWrite ? () => shiftDialogs.openCreate('empty_state', anchor) : undefined}
                    />
                  ) : (
                  <ShiftsDayList
                    date={anchor}
                    shifts={shifts}
                    timezone={timezone}
                    members={members}
                    viewerId={viewerId}
                    onOpen={shiftDialogs.openDetail}
                    onTake={shiftsCanWrite && canCoverShifts(members, viewerId) ? shiftDialogs.openTake : undefined}
                    onAdd={shiftsCanWrite ? () => shiftDialogs.openCreate('shifts_view', anchor) : undefined}
                  />
                  )}
                  </>
                }
              />
            ) : nothingAnywhere ? (
              <ShiftsEmptyState
                onAdd={shiftsCanWrite ? () => shiftDialogs.openCreate('empty_state', anchor) : undefined}
              />
            ) : view === 'week' ? (
              <ShiftsWeekView
                days={getWeekDays(range.start)}
                shifts={shifts}
                timezone={timezone}
                todayStr={todayStr}
                members={members}
                viewerId={viewerId}
                onOpen={shiftDialogs.openDetail}
                onTake={shiftsCanWrite && canCoverShifts(members, viewerId) ? shiftDialogs.openTake : undefined}
                onDayOpen={handleOpenDay}
                onAdd={shiftsCanWrite ? () => shiftDialogs.openCreate('shifts_view', anchor) : undefined}
              />
            ) : (
              <ShiftsMonthView
                gridDays={getMonthGridDays(anchor)}
                monthStart={startOfMonth(anchor)}
                shifts={shifts}
                todayStr={todayStr}
                onDayOpen={handleOpenDay}
              />
            )
          )}

          {!shiftsMode &&
            !isLoading &&
            !isError &&
            range &&
            timezone &&
            todayStr &&
            (view === 'day' || events.length > 0 || asNeededByDay.size > 0) &&
            (view === 'day' ? (
              <DayView
                date={anchor as string}
                events={events}
                asNeeded={asNeededByDay.get(anchor as string) ?? EMPTY_AS_NEEDED}
                timezone={timezone}
                onEventClick={handleEventClick}
                onAsNeededOpen={setDoseHistoryFor}
                onPrev={handlePrev}
                onNext={handleNext}
                onToday={handleToday}
                onAdd={canEdit ? () => openCreate('other') : undefined}
              />
            ) : view === 'week' ? (
              <WeekView
                days={getWeekDays(range.start)}
                eventsByDay={eventsByDay}
                careRecipientTimezone={timezone}
                todayStr={todayStr}
                onEventClick={handleEventClick}
                asNeededByDay={asNeededByDay}
                onAsNeededOpen={setDoseHistoryFor}
                onDayOpen={handleOpenDay}
              />
            ) : (
              <MonthView
                gridDays={getMonthGridDays(anchor as string)}
                monthStart={startOfMonth(anchor as string)}
                eventsByDay={eventsByDay}
                careRecipientTimezone={timezone}
                todayStr={todayStr}
                onEventClick={handleEventClick}
                asNeededByDay={asNeededByDay}
                onAsNeededOpen={setDoseHistoryFor}
                onDayOpen={handleOpenDay}
              />
            ))}
        </div>
      </div>

      {shiftDialogs.element}
      {teaserOpen && <ShiftsTeaserDialog source="toggle" onClose={() => setTeaserOpen(false)} />}

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

      {doseHistoryFor && timezone && (
        <DoseHistoryModal
          circleId={circleId}
          eventId={doseHistoryFor.eventId}
          name={doseHistoryFor.name}
          timezone={timezone}
          canEdit={canEdit}
          onClose={() => setDoseHistoryFor(null)}
        />
      )}

      {showCreate && (
        <AddEventModal
          circleId={circleId}
          entry={createEntry}
          onClose={() => setShowCreate(false)}
        />
      )}

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
