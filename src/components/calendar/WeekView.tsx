import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import { Card, Icon, Text } from '@/components/ui';
import { useHourCycle } from '@/hooks/useHourCycle';
import type { HourCycle } from '@/utils/hourCycle';
import {
  formatEventTimeCompact,
  getCurrentHoursInTimezone,
  zoneReferenceInstant,
} from '@/utils/timezone';
import { formatDateForDisplay } from './dateMath';
import { eventAssigneeName, eventNoteCount } from './eventChipMeta';
import {
  getEventCardClass,
  getEventTextClass,
  getMedicationStatus,
  isInactiveMedication,
} from './eventStyles';
import { overlapKey, resolveOverlaps, type OverlapInfo } from './overlap';
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

function parseTimeToHours(time: string): number {
  const [h = '0', m = '0'] = time.split(':');
  return Number.parseInt(h, 10) + Number.parseInt(m, 10) / 60;
}

function formatHourLabel(
  hour: number,
  cycle: HourCycle,
  locale: string = i18n.language
): string {
  // Hour-axis labels are pure clock labels — fixed UTC reference, no TZ math.
  // `hour12` follows the VIEWER's resolved cycle, not the locale's default:
  // otherwise a 24h viewer reads "14:30" chips against a "2 PM" axis. This is
  // a module-level helper, so the cycle is threaded in as a parameter rather
  // than read from the hook here.
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    hour12: cycle === '12h',
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
  asNeededByDay,
  onAsNeededOpen,
}: WeekViewProps): ReactElement {
  const { t } = useTranslation(['calendar', 'common', 'meds']);
  // Viewer's 12h/24h clock — every rendered time goes through it. (The hour-axis
  // labels below are Intl-locale-formatted, a separate concern.)
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
      for (const info of resolveOverlaps(timed).values()) {
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
  // WHY NOTHING IS ADDED FOR THE PINNED HEAD. The head (day headers + all-day
  // row) is `sticky top-0` INSIDE this scroller, and the timed grid starts right
  // below it in the content. So the head covers viewport rows [0, headHeight)
  // at every scrollTop >= 0, and timed-grid offset `t` sits at viewport row
  // `headHeight + t - scrollTop`. The head height cancels: the first row visible
  // under the head is timed offset `scrollTop`, whatever the head's height. To
  // put the hour (target - 1) on that row, scrollTop is simply its offset.
  // This used to be `timedRef.offsetTop + ...`, i.e. the head height ADDED —
  // which hid that many pixels of the lead-in under the head. With an all-day
  // row the head is ~110-210px against an 80px lead-in, so the first timed
  // chips (and the target hour itself) slid under it, leaving slivers and
  // target-size failures. The browser clamps this at the bottom of the grid.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const targetHour = earliestHour ?? getCurrentHoursInTimezone(careRecipientTimezone);
    el.scrollTop = Math.max(0, (targetHour - 1) * HOUR_HEIGHT);
  }, [earliestHour, careRecipientTimezone, days]);

  const renderEventButton = (
    event: CalendarEvent,
    positioned: boolean,
    overlap?: OverlapInfo
  ): ReactElement => {
    const status = getMedicationStatus(event, careRecipientTimezone, now);
    const title = event.medication_name || event.title;
    const timeLabel = event.scheduled_time
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
    const assigneeName = eventAssigneeName(event);
    const noteCount = eventNoteCount(event);
    const noteLabel = noteCount > 0 ? t('calendar:notes.noteCount', { count: noteCount }) : null;
    const ariaLabel = [
      title,
      t(`calendar:eventTypes.${event.event_type}`),
      timeLabel,
      status ? t(`calendar:status.${status}`) : null,
      inactive ? inactiveLabel : null,
      assigneeName,
      noteLabel,
    ]
      .filter(Boolean)
      .join(', ');

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
    const showTime = !!event.scheduled_time && totalColumns < 3;
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

  return (
    <Card
      variant="outlined"
      padding="none"
      role="grid"
      aria-label={t('calendar:weekViewLabel')}
      className="overflow-hidden"
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
        data-testid="week-scroller"
        className="snap-x snap-mandatory overflow-auto max-h-[70vh] scroll-pl-14 lg:snap-none"
      >
        <div
          role="rowgroup"
          data-day-column-floor={dayColumnFloorPx}
          style={{ '--dc-floor': `${dayColumnFloorPx}px` } as CSSProperties}
          className="relative w-max [--dc:max(var(--dc-floor),calc((100vw_-_2rem_-_3.5rem)/2))] md:[--dc:max(var(--dc-floor),calc((100vw_-_3rem_-_3.5rem)/3))] lg:w-auto lg:min-w-0 lg:[--dc:minmax(var(--dc-floor),1fr)]"
        >
          {/* Pinned head — day headers + all-day stay at the top while the timed
              grid scrolls under them; their left cells also pin left. */}
          <div
            role="presentation"
            data-testid="week-pinned-head"
            className="sticky top-0 z-[6] bg-cream"
          >
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
                  <div
                    className={`mx-auto flex flex-col items-center justify-center rounded-lg px-1 py-1 ${
                      isToday ? 'bg-ink' : ''
                    }`}
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
                  </div>
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

          {/* Timed grid — scrolls vertically under the pinned head; the hour rail
              pins left to the 2D scroller above. */}
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
                    {hour === 0 ? '' : formatHourLabel(hour, hourCycle)}
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
                    data-date={day}
                    aria-label={`${formatDateForDisplay(day, {
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
                      const lanes = resolveOverlaps(events);
                      return events.map((event) =>
                        renderEventButton(event, true, lanes.get(overlapKey(event)))
                      );
                    })()}
                  </div>
                );
              })}
          </div>
        </div>
      </div>
    </Card>
  );
}
