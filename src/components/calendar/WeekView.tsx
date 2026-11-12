import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';
import { useTranslation } from 'react-i18next';
import { shiftTaskMeta } from '@/components/shifts/shiftTasks';
import type { TFunction } from 'i18next';
import type { CalendarEvent, EventType } from '@/api/calendarEvents';
import { Card, Icon, Modal, Text } from '@/components/ui';
import { prefersReducedMotion } from '@/components/ui/motion';
import { useHourCycle } from '@/hooks/useHourCycle';
import {
  formatEventTimeCompact,
  formatHourOfDay,
  getCurrentHoursInTimezone,
  zoneReferenceInstant,
} from '@/utils/timezone';
import { formatDateForDisplay } from './dateMath';
import { eventAssigneeName, eventNoteCount } from './eventChipMeta';
import {
  getEventCardClass,
  getEventTextClass,
  getMedicationStatus,
  hidesUnloggedDoseTime,
  isInactiveMedication,
  type MedicationStatus,
} from './eventStyles';
import { overlapKey, resolveOverlaps, type OverlapInfo } from './overlap';
import { groupSlots, slotOverlapInput, type SlotItem } from './weekSlots';
import { AsNeededDayRow, AsNeededRing } from './AsNeededDayRow';
import type { AsNeededDayEntry } from './asNeededByDay';

export interface WeekViewProps {
  /** 7 YYYY-MM-DD strings (Sunday-first) in the care recipient's timezone. */
  days: string[];
  eventsByDay: Map<string, CalendarEvent[]>;
  careRecipientTimezone: string;
  /** Today's date string IN THE CARE RECIPIENT'S TIMEZONE (getDateInTimezone). */
  todayStr: string;
  onEventClick: (event: CalendarEvent) => void;
  /** Days with logged as-needed doses (recipient-zone days). Optional: nothing shown without it. */
  asNeededByDay?: Map<string, AsNeededDayEntry[]>;
  onAsNeededOpen?: (entry: AsNeededDayEntry) => void;
  /** When provided, a day header is a button that opens that day (Day view). */
  onDayOpen?: (day: string) => void;
  /** Imperative handle for the page's "Now" control (below lg only). */
  controlRef?: Ref<WeekViewControl>;
}

export interface WeekViewControl {
  /** Below lg: scroll the PAGE so the now-line sits one hour below the pinned head. */
  jumpToNow: () => void;
}

// px per hour — matches mobile's WeekTimelineView HOUR_HEIGHT exactly. Also
// the fit budget for chip text: at 80 a 30-minute event is 40px tall, which
// clears two lines of chip text, so even the shortest event stacks its title
// on a full-width line instead of sharing one with the time label.
const HOUR_HEIGHT = 80;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const MIN_EVENT_MINUTES = 30;
// Mobile parity (review 2026-09-05): mobile/src/components/calendar/
// WeekTimelineView.tsx:40 caps the shared all-day row at 2 visible chips per
// day, then a "+N" overflow (lines 174-218) — without it a day with many
// all-day items grows the shared row tall enough to push the whole hour grid
// below the fold, at every viewport width, not just narrow ones. Mobile's own
// "+N" is a plain (non-interactive) Text; this port makes it a real button
// (aria-expanded) that reveals the rest of THAT day's column inline, since no
// other per-day detail affordance exists in this view to route it to instead.
const MAX_ALL_DAY_VISIBLE = 2;
/**
 * Minimum width per collision lane (WCAG 2.5.8): lane centres >=24px apart
 * plus the 2% gutter mobile's TimelineEventBlock uses. Exported for the test.
 */
export const LANE_MIN_PX = 25;
// Chip text metrics — both spans render at leading-[14px], and the chip's p-1
// eats 4px top + bottom. Used to work out how many lines actually fit before
// choosing the stacked vs inline layout, so nothing is ever clipped mid-line.
const CHIP_LINE_HEIGHT = 14;
const CHIP_PADDING_Y = 8;
/**
 * The width (Tailwind `lg`, 64rem) from which the timed grid keeps its own
 * capped vertical scroller. Below it the grid lays out at full height and the
 * page is the only vertical scroll (a scroller inside a scrolling page on a
 * phone was a double scroll — owner 2026-11-10).
 */
export const INNER_SCROLL_QUERY = '(min-width: 64rem)';
/** Missing `matchMedia` (jsdom) keeps the inner scroller — the desktop contract. */
function gridScrollsInside(): boolean {
  return typeof window.matchMedia !== 'function' || window.matchMedia(INNER_SCROLL_QUERY).matches;
}

/** The collapsed chip's plural label ("5 meds"). Literal keys on purpose: the dynamic-key pin stays put. */
function slotLabel(t: TFunction, type: EventType, count: number): string {
  switch (type) {
    case 'medication':
      return t('calendar:weekSlot.medication', { count });
    case 'appointment':
      return t('calendar:weekSlot.appointment', { count });
    case 'task':
      return t('calendar:weekSlot.task', { count });
    default:
      return t('calendar:weekSlot.shift', { count });
  }
}

/** A dose's status word for the slot list. */
function statusLabel(t: TFunction, status: MedicationStatus): string {
  switch (status) {
    case 'taken':
      return t('calendar:status.taken');
    case 'missed':
      return t('calendar:status.missed');
    case 'skipped':
      return t('calendar:status.skipped');
    default:
      return t('calendar:status.pending');
  }
}

function parseTimeToHours(time: string): number {
  const [h = '0', m = '0'] = time.split(':');
  return Number.parseInt(h, 10) + Number.parseInt(m, 10) / 60;
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
  asNeededByDay,
  onAsNeededOpen,
  onDayOpen,
  controlRef,
}: WeekViewProps): ReactElement {
  const { t } = useTranslation(['calendar', 'common', 'meds', 'shifts']);
  // Viewer's 12h/24h clock — every rendered time goes through it, the hour axis included
  // (formatHourOfDay: the app's MERIDIEM table, same rule as mobile's week rail).
  const hourCycle = useHourCycle();

  // Re-render the current-time indicator every minute.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const currentTimeTop = getCurrentHoursInTimezone(careRecipientTimezone, now) * HOUR_HEIGHT;

  // Days whose all-day column the viewer has expanded past the MAX_ALL_DAY_VISIBLE
  // cap (below). Per-day, not global — expanding Saturday's overflow must not
  // also expand Sunday's.
  const [expandedAllDayDays, setExpandedAllDayDays] = useState<Set<string>>(
    () => new Set()
  );

  // The same-slot chip whose list is open (null = closed).
  const [openSlot, setOpenSlot] = useState<Extract<SlotItem, { kind: 'group' }> | null>(null);

  const timedEvents = (day: string): CalendarEvent[] =>
    (eventsByDay.get(day) ?? []).filter((event) => !!event.scheduled_time);
  const allDayEvents = (day: string): CalendarEvent[] =>
    (eventsByDay.get(day) ?? []).filter((event) => !event.scheduled_time);
  const asNeededFor = (day: string): AsNeededDayEntry[] => asNeededByDay?.get(day) ?? [];
  const hasAllDayRow = days.some(
    (day) => allDayEvents(day).length > 0 || asNeededFor(day).length > 0
  );

  // TARGET SIZE (WCAG 2.5.8). Overlapping timed events split the day column
  // into equal lanes, so five 8:00 AM doses in a phone's ~116px column were
  // ~21px-wide chips crowding each other — under the 24px minimum/spacing.
  // Floor every day column at LANE_MIN_PX per lane of the busiest slot in the
  // week, so lane centres sit >=24px apart; the grid already pans sideways
  // (a 2D calendar, exempt from reflow), so a wider column just scrolls. At
  // desktop widths the natural column already clears the floor for typical
  // weeks, so nothing changes there.
  const dayColumnFloorPx = useMemo(() => {
    let maxLanes = 1;
    for (const day of days) {
      const timed = (eventsByDay.get(day) ?? []).filter((event) => !!event.scheduled_time);
      // Same-type items at one minute are ONE chip (groupSlots), so they take one lane.
      for (const info of resolveOverlaps(groupSlots(timed).map(slotOverlapInput)).values()) {
        maxLanes = Math.max(maxLanes, info.totalColumns);
      }
    }
    return maxLanes > 1 ? maxLanes * LANE_MIN_PX : 0;
  }, [days, eventsByDay]);

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
  //
  // WHY NOTHING IS ADDED FOR THE PINNED HEAD (lg+). The head (day headers +
  // all-day row) sits directly ABOVE this scroller, which holds only the timed
  // grid (until 2026-11-10 it was `sticky top-0` inside it — same arithmetic).
  // The first row visible under the head is timed offset `scrollTop`, whatever
  // the head's height. To put the hour (target - 1) on that row, scrollTop is
  // simply its offset.
  // This used to be `timedRef.offsetTop + ...`, i.e. the head height ADDED —
  // which hid that many pixels of the lead-in under the head. With an all-day
  // row the head is ~110-210px against an 80px lead-in, so the first timed
  // chips (and the target hour itself) slid under it, leaving slivers and
  // target-size failures. The browser clamps this at the bottom of the grid.
  //
  // BELOW lg THE PAGE IS THE ONLY VERTICAL SCROLL (owner 2026-11-10, iPhone):
  // the timed grid lays out at its full 24h height and the head is sticky to
  // the PAGE, under the 60px app header. There the page is NEVER moved by
  // itself (owner follow-up 2026-11-10: opening Week, switching Day -> Week or
  // changing week used to jump the page down to the lead-in, taking the week
  // controls off screen). The page's "Now" control calls `jumpToNow` instead.
  const scrollRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const headScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !gridScrollsInside()) return;
    const targetHour = earliestHour ?? getCurrentHoursInTimezone(careRecipientTimezone);
    el.scrollTop = Math.max(0, (targetHour - 1) * HOUR_HEIGHT);
  }, [earliestHour, careRecipientTimezone, days]);

  // "Now" (below lg): the same one-hour lead-in, as a window scroll, so the
  // now-line sits an hour below the head's STUCK bottom edge (sticky `top` +
  // head height). The grid's document offset is its flow position, which
  // sticky never changes; the browser clamps at the page end. A tap, so it
  // animates — unless the user asked for reduced motion (WCAG 2.3.3; html's
  // CSS `scroll-behavior` cannot reach a JS scroll's explicit behavior).
  useImperativeHandle(
    controlRef,
    () => ({
      jumpToNow: () => {
        const el = scrollRef.current;
        if (!el) return;
        const leadIn = Math.max(0, (getCurrentHoursInTimezone(careRecipientTimezone) - 1) * HOUR_HEIGHT);
        const head = headRef.current;
        const headBottom = head
          ? (parseFloat(getComputedStyle(head).top) || 0) + head.getBoundingClientRect().height
          : 0;
        const gridTop = el.getBoundingClientRect().top + window.scrollY;
        window.scrollTo({
          top: Math.max(0, gridTop + leadIn - headBottom),
          behavior: prefersReducedMotion() ? 'instant' : 'smooth',
        });
      },
    }),
    [careRecipientTimezone]
  );

  // The head and the timed grid are two horizontal scrollers (the head has to
  // sit OUTSIDE the grid's scroller to pin to the page — a sticky element pins
  // to its nearest scroll container). Panning either one pans the other, so
  // the day headers always sit over their columns (the grid by swipe, the head
  // when keyboard focus scrolls a header button into view). The equality guard
  // stops the echo.
  const syncPan = (from: HTMLDivElement | null, to: HTMLDivElement | null): void => {
    if (from && to && to.scrollLeft !== from.scrollLeft) to.scrollLeft = from.scrollLeft;
  };

  /** Everything a chip prints or speaks about one event (shared by the chip and the same-slot list). */
  const describeEvent = (event: CalendarEvent) => {
    const status = getMedicationStatus(event, careRecipientTimezone, now);
    const title = event.medication_name || event.title;
    // A past day nobody answered prints no clock time (its virtual occurrence
    // carries the NEW time after a time edit). The chip keeps its grid slot.
    const hideTime = hidesUnloggedDoseTime(event, careRecipientTimezone, now);
    const timeLabel = hideTime
      ? null
      : event.scheduled_time
      ? formatEventTimeCompact(
          event.scheduled_time,
          careRecipientTimezone,
          hourCycle,
          zoneReferenceInstant(event.scheduled_date)
        )
      : t('calendar:allDay');
    // A discontinued medication still shows every dose that was due BEFORE the
    // discontinue instant — historical rows keep their confirmation status and
    // are labelled "Inactive" in TEXT (never color alone: WCAG 2.1 AA 1.4.1),
    // both visibly in the chip and in the accessible name.
    const inactive = isInactiveMedication(event);
    const inactiveLabel = t('calendar:discontinueMed.inactiveBadge');
    // Mobile TimelineEventBlock parity: who the event is assigned to and how
    // many notes it has. Both are ALWAYS in the accessible name (mobile's
    // a11yLabel order: name, time, assignee, notes), even when the chip is too
    // small to print them.
    const assigneeName = shiftTaskMeta(event, (t as unknown as (k: string, o?: Record<string, unknown>) => string)) ?? eventAssigneeName(event);
    const noteCount = eventNoteCount(event);
    const noteLabel = noteCount > 0 ? t('calendar:notes.noteCount', { count: noteCount }) : null;
    const ariaLabel = [
      title,
      t(`calendar:eventTypes.${event.event_type}`),
      timeLabel,
      // Owner 2026-11-12: an unanswered dose has no status word ("Pending" said nothing).
      status && status !== 'pending' ? t(`calendar:status.${status}`) : null,
      inactive ? inactiveLabel : null,
      assigneeName,
      noteLabel,
    ]
      .filter(Boolean)
      .join(', ');

    return {
      status,
      title,
      hideTime,
      timeLabel,
      inactive,
      inactiveLabel,
      assigneeName,
      noteCount,
      ariaLabel,
    };
  };

  const renderEventButton = (
    event: CalendarEvent,
    positioned: boolean,
    overlap?: OverlapInfo
  ): ReactElement => {
    const {
      status,
      title,
      hideTime,
      timeLabel,
      inactive,
      inactiveLabel,
      assigneeName,
      noteCount,
      ariaLabel,
    } = describeEvent(event);
    const chipHeight = positioned
      ? Math.max(
          ((event.duration_minutes ?? MIN_EVENT_MINUTES) / 60) * HOUR_HEIGHT,
          (MIN_EVENT_MINUTES / 60) * HOUR_HEIGHT
        )
      : null;

    // Collision lanes. Events sharing a slot split the column between them
    // (mobile parity) — without this they stack and only the top one is seen.
    const totalColumns = overlap?.totalColumns ?? 1;
    const column = overlap?.column ?? 0;
    const columnPct = 100 / totalColumns;

    const style = positioned
      ? {
          top: parseTimeToHours(event.scheduled_time as string) * HOUR_HEIGHT,
          height: chipHeight as number,
          // Same 2% gutter split mobile's TimelineEventBlock uses.
          left: `${column * columnPct + 1}%`,
          width: `${columnPct - 2}%`,
        }
      : undefined;

    // How many text lines the chip can show. All-day chips are min-h-[44px]
    // and free to grow, so they always get the roomy treatment.
    const fitLines =
      chipHeight === null
        ? 3
        : Math.floor((chipHeight - CHIP_PADDING_Y) / CHIP_LINE_HEIGHT);
    // Stacking gives the title the chip's FULL width instead of whatever the
    // time label leaves it — the single biggest win against truncation. Only
    // done when a second line is genuinely available; a 30-minute chip (20px
    // of content) still shares one baseline row, as before.
    const stacked = fitLines >= 2;
    // At 3+ lanes a chip is too narrow for both; the title is what identifies it,
    // and the time is still in the aria-label and the hour axis.
    const showTime = !!event.scheduled_time && !hideTime && totalColumns < 3;
    // The assignee + note badge line (mobile's meta row). Mobile renders it
    // only when it FITS below the title (TimelineEventBlock META_MIN_HEIGHT);
    // here the time already owns the second line, so the meta line needs a
    // THIRD free line — a 45-minute or longer event. A 30-minute chip has
    // exactly two lines and keeps title + time, as before. All-day chips never
    // print it (mobile's all-day chips are title-only), and neither do 3+ lane
    // chips, which are too narrow for a name — the same rule that drops the
    // time there. In every one of those cases the name and the count are still
    // spoken, via the aria-label above.
    const hasMeta = !!assigneeName || noteCount > 0;
    const secondLine = showTime || inactive;
    const showMeta =
      positioned && hasMeta && totalColumns < 3 && fitLines >= (secondLine ? 3 : 2);
    // Two title lines only when the time label (and the meta line, if shown)
    // still have lines of their own.
    const titleClamp = fitLines >= (showMeta ? 4 : 3) ? 'line-clamp-2' : 'truncate';

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
          positioned ? 'absolute z-[1]' : 'relative min-h-[44px] w-full'
        } block overflow-hidden rounded p-1 text-left ${getEventCardClass(event, status)}`}
      >
        <span className={stacked ? 'flex flex-col' : 'flex items-baseline gap-1'}>
          {/* Not <Text variant="mono">: getEventTextClass's color MUST win over
              the variant's own text-ink-3, and both would be plain utilities in
              the same cascade layer — order between them in the compiled
              stylesheet is not guaranteed. The mono scale is inlined with no
              color of its own instead, so getEventTextClass supplies the only
              color utility here. */}
          <span
            className={`min-w-0 ${stacked ? 'w-full' : 'flex-1'} ${titleClamp} break-words font-normal tracking-wider text-[11px] leading-[14px] ${getEventTextClass(event, status)} ${
              status === 'skipped' ? 'line-through' : ''
            }`}
          >
            {title}
          </span>
          {(showTime || inactive) && (
            // The time can carry the recipient's zone ("1:00 PM (New York)"
            // when the viewer is elsewhere), which is wider than a narrow lane.
            // It truncates with an ellipsis instead of being cut off by the
            // chip (WCAG 1.4.10, mobile numberOfLines={1} parity); the full
            // time is always in the button's aria-label.
            <span className="flex min-w-0 max-w-full items-baseline gap-1">
              {showTime && (
                <span
                  className={`min-w-0 truncate font-normal tracking-wider text-[11px] leading-[14px] ${getEventTextClass(event, status)}`}
                >
                  {timeLabel}
                </span>
              )}
              {inactive && (
                <span
                  className={`min-w-0 truncate font-normal tracking-wider text-[11px] leading-[14px] ${getEventTextClass(event, status)}`}
                >
                  {inactiveLabel}
                </span>
              )}
            </span>
          )}
          {showMeta && (
            // Mobile's metaRow: the name gives way (truncates) first, the note
            // badge never shrinks. Its text is presentational — the button's
            // aria-label already carries both.
            <span
              data-testid="event-chip-meta"
              aria-hidden="true"
              className="flex min-w-0 items-center gap-1"
            >
              {assigneeName && (
                <span
                  data-testid="event-chip-assignee"
                  className={`min-w-0 truncate font-normal text-[11px] leading-[14px] ${getEventTextClass(event, status)}`}
                >
                  {assigneeName}
                </span>
              )}
              {noteCount > 0 && (
                <span
                  data-testid="event-chip-notes"
                  className={`flex shrink-0 items-center gap-0.5 font-normal text-[11px] leading-[14px] ${getEventTextClass(event, status)}`}
                >
                  <Icon name="document-text" size={10} />
                  {noteCount}
                </span>
              )}
            </span>
          )}
        </span>
      </button>
    );
  };

  /** ONE chip for several same-type items at the same minute; opens the list of them. */
  const renderSlotChip = (
    slot: Extract<SlotItem, { kind: 'group' }>,
    overlap?: OverlapInfo
  ): ReactElement => {
    const first = slot.events[0];
    const totalColumns = overlap?.totalColumns ?? 1;
    const column = overlap?.column ?? 0;
    const columnPct = 100 / totalColumns;
    const label = slotLabel(t, slot.type, slot.events.length);
    const timeLabel = formatEventTimeCompact(
      slot.time,
      careRecipientTimezone,
      hourCycle,
      zoneReferenceInstant(first.scheduled_date)
    );
    return (
      <button
        key={`slot_${slot.key}`}
        type="button"
        data-event-type={slot.type}
        data-slot-count={slot.events.length}
        aria-haspopup="dialog"
        aria-label={t('calendar:weekSlot.chipLabel', { label, time: timeLabel })}
        onClick={() => setOpenSlot(slot)}
        style={{
          top: parseTimeToHours(slot.time) * HOUR_HEIGHT,
          height: (MIN_EVENT_MINUTES / 60) * HOUR_HEIGHT,
          left: `${column * columnPct + 1}%`,
          width: `${columnPct - 2}%`,
        }}
        className={`absolute z-[1] block overflow-hidden rounded p-1 text-left ${getEventCardClass(first, null)}`}
      >
        <span className="flex flex-col">
          <span
            className={`truncate font-medium tracking-wider text-[11px] leading-[14px] tabular-nums ${getEventTextClass(first, null)}`}
          >
            {label}
          </span>
          {totalColumns < 3 && (
            <span
              className={`truncate font-normal tracking-wider text-[11px] leading-[14px] tabular-nums ${getEventTextClass(first, null)}`}
            >
              {timeLabel}
            </span>
          )}
        </span>
      </button>
    );
  };

  return (
    <Card
      variant="outlined"
      padding="none"
      role="grid"
      aria-label={t('calendar:weekViewLabel')}
      // `overflow-clip`, not `-hidden` (rounded corners still clip): hidden
      // makes the card a scroll container, and the head below would then pin
      // to the card instead of the page.
      className="overflow-clip tabular-nums"
    >
      {/* ONE VERTICAL SCROLL PER WIDTH (owner 2026-11-10, iPhone Safari: the
          old single 2D scroller was `max-h-[70vh] overflow-auto`, a scroll box
          inside the scrolling page — scroll the card, then scroll the page).
          Now the head and the timed grid are two horizontal pans kept in step
          (syncPan); the hour rail is sticky-left inside the grid's pan, the
          head's corner cell sticky-left inside the head's.
            < lg: the grid lays out at its full 24h height (no vertical
                  scroller at all) and the head is sticky to the PAGE under the
                  60px app header — mobile's WeekTimelineView keeps its day
                  headers fixed over a single vertical scroll the same way. ~2
                  (md: 3) day columns fit; the week pans sideways INSIDE the
                  card (scroll-snap), never the page.
            >= lg: 7 columns fit; the grid keeps its own 70vh scroller under
                  the head (a 1920px day on a desktop page would push
                  everything below the calendar out of reach). Both reserve
                  the same scrollbar gutter so header and grid columns line up
                  with classic (non-overlay) scrollbars. */}
      <div
        role="presentation"
        data-day-column-floor={dayColumnFloorPx}
        style={{ '--dc-floor': `${dayColumnFloorPx}px` } as CSSProperties}
        className="[--dc:max(var(--dc-floor),calc((100vw_-_2rem_-_3.5rem)/2))] md:[--dc:max(var(--dc-floor),calc((100vw_-_3rem_-_3.5rem)/3))] lg:[--dc:minmax(var(--dc-floor),1fr)]"
      >
          {/* Pinned head — day headers + all-day stay at the top while the timed
              grid scrolls under them; their left cells also pin left. */}
          <div
            ref={headRef}
            role="presentation"
            data-testid="week-pinned-head"
            className="sticky top-[60px] z-[6] bg-cream"
          >
          <div
            ref={headScrollRef}
            role="presentation"
            data-testid="week-head-scroller"
            onScroll={() => syncPan(headScrollRef.current, scrollRef.current)}
            className="overflow-hidden lg:[scrollbar-gutter:stable]"
          >
          <div role="rowgroup" className="w-max lg:w-auto lg:min-w-0">
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
              const hasAsNeeded = asNeededFor(day).length > 0;
              const isToday = day === todayStr;
              return (
                <div
                  key={day}
                  role="columnheader"
                  aria-current={isToday ? 'date' : undefined}
                  aria-label={`${formatDateForDisplay(day, {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                  })}, ${t('calendar:eventCount', { count })}${
                    hasAsNeeded ? `, ${t('meds:asNeeded.calendar.cellHint')}` : ''
                  }`}
                  className="snap-start border-l border-line-2 p-1 text-center"
                >
                  {/* Visible weekday-short + day-number now participate in
                      the accessible tree (review 2026-09-05, WCAG 2.5.3):
                      `aria-label` above still carries the full date, which
                      contains both. */}
                  <DayHeaderWrap
                    onOpen={onDayOpen ? () => onDayOpen(day) : undefined}
                    label={formatDateForDisplay(day, {
                      weekday: 'long',
                      month: 'long',
                      day: 'numeric',
                    })}
                    className={`mx-auto flex flex-col items-center justify-center rounded-lg px-1 py-1 ${
                      isToday ? 'bg-ink' : ''
                    }${onDayOpen ? ` min-h-[44px] w-full${isToday ? '' : ' hover:bg-bg-2'}` : ''}`}
                  >
                    <span
                      className={`block text-xs font-medium capitalize ${isToday ? 'text-cream' : 'text-ink-3'}`}
                    >
                      {formatDateForDisplay(day, { weekday: 'short' })}
                    </span>
                    <span
                      className={`mt-0.5 text-sm font-medium ${isToday ? 'text-cream' : 'text-ink'}`}
                    >
                      {formatDateForDisplay(day, { day: 'numeric' })}
                    </span>
                  </DayHeaderWrap>
                  {hasAsNeeded && (
                    <div className="mt-0.5 flex justify-center">
                      <AsNeededRing />
                    </div>
                  )}
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
                <Text variant="mono" as="span">
                  {t('calendar:allDay')}
                </Text>
              </div>
              {days.map((day) => {
                const dayAllDay = allDayEvents(day);
                const isExpanded = expandedAllDayDays.has(day);
                const overflow = dayAllDay.length - MAX_ALL_DAY_VISIBLE;
                const visible =
                  isExpanded || overflow <= 0 ? dayAllDay : dayAllDay.slice(0, MAX_ALL_DAY_VISIBLE);
                // "Sat 5" — the same day identity the columnheader's aria-label
                // already speaks, just shorter (this is a compact overflow
                // control's name, not the header itself).
                const dayLabel = formatDateForDisplay(day, { weekday: 'short', day: 'numeric' });
                return (
                  <div
                    key={day}
                    role="gridcell"
                    data-date={day}
                    className="snap-start flex flex-col gap-1 border-l border-line-2 p-1"
                  >
                    {asNeededFor(day).map((entry) => (
                      <AsNeededDayRow
                        key={`prn_${entry.eventId}`}
                        entry={entry}
                        onOpen={(e) => onAsNeededOpen?.(e)}
                      />
                    ))}
                    {visible.map((event) => renderEventButton(event, false))}
                    {overflow > 0 && !isExpanded && (
                      <button
                        type="button"
                        aria-expanded={false}
                        aria-label={t('calendar:allDayMoreLabel', { count: overflow, day: dayLabel })}
                        onClick={() =>
                          setExpandedAllDayDays((prev) => new Set(prev).add(day))
                        }
                        // WCAG 2.5.5: 22px of text does not clear the 44px
                        // minimum on its own; `min-h-[44px]` + centering gives
                        // it a real tap target without a separate hit-area
                        // hack that could bleed into a neighbouring chip.
                        className="flex min-h-[44px] w-full items-center text-left font-normal tracking-wider text-[11px] leading-[14px] text-ink-3 hover:text-ink"
                      >
                        +{overflow}
                      </button>
                    )}
                    {overflow > 0 && isExpanded && (
                      <button
                        type="button"
                        aria-expanded={true}
                        // Per-day, not just "Show fewer" — two expanded days
                        // in the same week would otherwise share one
                        // accessible name (review 2026-09-05).
                        aria-label={t('calendar:allDayShowFewerLabel', { day: dayLabel })}
                        onClick={() =>
                          setExpandedAllDayDays((prev) => {
                            const next = new Set(prev);
                            next.delete(day);
                            return next;
                          })
                        }
                        className="flex min-h-[44px] w-full items-center text-left font-normal tracking-wider text-[11px] leading-[14px] text-ink-3 hover:text-ink"
                      >
                        {t('calendar:allDayShowFewer')}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          </div>
          </div>
          </div>

          {/* Timed grid — its own horizontal pan (snap, in step with the head).
              Vertically: full height below lg (the page scrolls), a 70vh
              scroller at lg+. The hour rail pins left inside it. */}
          <div
            ref={scrollRef}
            role="presentation"
            data-testid="week-scroller"
            onScroll={() => syncPan(scrollRef.current, headScrollRef.current)}
            className="snap-x snap-mandatory overflow-x-auto scroll-pl-14 lg:max-h-[70vh] lg:overflow-y-auto lg:snap-none lg:[scrollbar-gutter:stable]"
          >
          <div role="rowgroup" className="w-max lg:w-auto lg:min-w-0">
          <div role="row" className="grid grid-cols-[3.5rem_repeat(7,var(--dc))]">
              {/* Hour axis — pinned so the labels stay visible while days scroll. */}
              <div
                role="rowheader"
                aria-hidden="true"
                className="sticky left-0 z-[5] bg-cream"
                style={{ height: 24 * HOUR_HEIGHT }}
              >
                {HOURS.map((hour) => (
                  <Text
                    key={hour}
                    variant="mono"
                    as="span"
                    className="absolute right-1 -translate-y-1/2 normal-case"
                    style={{ top: hour * HOUR_HEIGHT }}
                  >
                    {hour === 0 ? '' : formatHourOfDay(hour, hourCycle)}
                  </Text>
                ))}
              </div>

              {days.map((day) => {
                const events = timedEvents(day);
                const isToday = day === todayStr;
                return (
                  <div
                    key={day}
                    role="gridcell"
                    // The timed grid's one tab stop (axe scrollable-region-focusable, WCAG 2.1.1): a week with no
                    // timed entries has nothing else focusable in the scroller. Today, else the first day shown.
                    tabIndex={day === (days.includes(todayStr) ? todayStr : days[0]) ? 0 : -1}
                    data-date={day}
                    aria-label={`${formatDateForDisplay(day, {
                      weekday: 'long',
                      month: 'long',
                      day: 'numeric',
                    })}, ${t('calendar:eventCount', { count: events.length })}`}
                    className={`relative snap-start border-l border-line-2 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink ${isToday ? 'bg-bg-2/50' : ''}`}
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
                        // pointer-events-none: purely decorative — it sits ABOVE
                        // event chips (z-2 vs z-1) and must never swallow clicks
                        // on an event scheduled at the current time.
                        // Mobile parity (review 2026-09-05): mobile's
                        // WeekTimelineView.currentTimeLine/currentTimeDot use
                        // CC.terracotta, not ink — a 2px line + 8px dot.
                        className="pointer-events-none absolute inset-x-0 z-[2] h-0.5 bg-terracotta"
                        style={{ top: currentTimeTop }}
                      >
                        <span className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full bg-terracotta" />
                      </div>
                    )}

                    {(() => {
                      const items = groupSlots(events);
                      const lanes = resolveOverlaps(items.map(slotOverlapInput));
                      return items.map((item) =>
                        item.kind === 'event'
                          ? renderEventButton(item.event, true, lanes.get(overlapKey(item.event)))
                          : renderSlotChip(item, lanes.get(overlapKey(slotOverlapInput(item))))
                      );
                    })()}
                  </div>
                );
              })}
          </div>
          </div>
          </div>
      </div>
      {openSlot && (
        <Modal
          size="sm"
          title={`${formatEventTimeCompact(
            openSlot.time,
            careRecipientTimezone,
            hourCycle,
            zoneReferenceInstant(openSlot.events[0].scheduled_date)
          )} · ${slotLabel(t, openSlot.type, openSlot.events.length)}`}
          closeLabel={t('common:close')}
          onClose={() => setOpenSlot(null)}
        >
          <ul className="m-0 flex list-none flex-col p-0">
            {openSlot.events.map((event) => {
              const { status, title, ariaLabel } = describeEvent(event);
              return (
                <li key={`${event.id}_${event.scheduled_date}`} className="border-t border-line-2 first:border-t-0">
                  <button
                    type="button"
                    // The same accessible name as the grid chip would have had.
                    aria-label={ariaLabel}
                    className="flex min-h-[44px] w-full items-center justify-between gap-3 py-2 text-left text-base text-ink hover:bg-bg-2"
                    onClick={() => {
                      setOpenSlot(null);
                      onEventClick(event);
                    }}
                  >
                    <span className="min-w-0 break-words">{title}</span>
                    {status && status !== 'pending' && (
                      <span className="shrink-0 text-sm text-ink-2">{statusLabel(t, status)}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </Modal>
      )}
    </Card>
  );
}

/** The header's date block: a button when the page can open Day, else a plain div. */
function DayHeaderWrap({
  onOpen,
  label,
  className,
  children,
}: {
  onOpen?: () => void;
  label: string;
  className: string;
  children: ReactNode;
}): ReactElement {
  if (!onOpen) return <div className={className}>{children}</div>;
  return (
    <button type="button" aria-label={label} onClick={onOpen} className={className}>
      {children}
    </button>
  );
}
