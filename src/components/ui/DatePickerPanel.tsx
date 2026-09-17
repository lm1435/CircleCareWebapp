import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type RefObject,
} from 'react';
import { useTranslation } from 'react-i18next';
import { addDaysToIsoDay } from '@/utils/recipientEventDate';
import { getCachedDateTimeFormat, getDateInTimezone, getDeviceTimezone } from '@/utils/timezone';
import { Button } from './Button';
import { Icon } from './Icon';
import { PickerPopover, SCROLL_GUTTER, centerInColumn } from './pickerPopover';

/**
 * The month grid behind `DateField`, replacing Chrome's native calendar with
 * the app's own palette — and, unlike that calendar, with a month and a year
 * JUMP, because two of the five call sites are a care recipient's DATE OF
 * BIRTH (`CreateCircleModal`, `EditCirclePage`). Prev/next arrows alone put a
 * 1943 birthday roughly a thousand clicks away, which is not a date picker.
 *
 * THE VALUE CONTRACT IS `YYYY-MM-DD`, ALWAYS, whatever the locale shows. The
 * native `<input type="date">` stays the text control (see `DateField`), so the
 * order the field DISPLAYS is the browser's business and the string this panel
 * emits is never anything else.
 *
 * ── NO DATE IN THIS FILE IS EVER AN INSTANT ───────────────────────────────
 *
 * This is the highest-risk part of the component and the reason most of the
 * arithmetic below looks longer than it needs to. A `YYYY-MM-DD` here is a
 * NAIVE CALENDAR DAY in the viewer's frame — the same value `recipientEventDate`
 * is built around — and `new Date('2026-09-11')` parses that as UTC MIDNIGHT,
 * which is the previous day everywhere west of Greenwich. Twenty timezone bugs
 * were fixed on mobile to establish that rule (`utils/timezone.ts` opens with
 * it), and a date picker that is one day out near a DST boundary is exactly the
 * kind of quiet wrong this codebase has paid for before.
 *
 * So: no `new Date(isoString)`, no `.split('T')[0]`, and no local `getDate()` /
 * `getDay()` / `setDate()` anywhere in this file. Day arithmetic goes through
 * `addDaysToIsoDay` (string in, string out, UTC internally); everything else
 * reads a `Date` built at UTC midnight purely as a CALENDAR LOOKUP TABLE — for
 * "how long is this month" and "what weekday is this" — never as a moment.
 *
 * The popover shell (portal, positioning, flip-and-clamp, Escape/Tab, outside
 * click) is `pickerPopover.tsx`, shared with `TimePickerPanel`. Reached only
 * through `React.lazy` from `DateField`, for the layering reason that file's
 * import comment gives — and because a 42-cell grid plus four `Intl`
 * formatters has no business in the chunk every screen loads.
 */

export interface DateParts {
  year: number;
  /** 1-12, as the string carries it — NOT the 0-11 a `Date` constructor wants. */
  month: number;
  /** 1-31. */
  day: number;
}

/**
 * A four-digit year is required, and the leading digit may not be zero.
 *
 * Not pedantry: `Date.UTC(43, …)` means 1943, so any helper that reaches a
 * `Date` constructor with a two-digit year silently gets a different century.
 * Rejecting those here means nothing downstream — `addDaysToIsoDay` included —
 * can ever be handed one.
 */
const ISO_DAY = /^([1-9]\d{3})-(\d{2})-(\d{2})$/;

/** UTC midnight on a calendar day, as a LOOKUP TABLE for month length / weekday. */
function utcDay(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

/** How many days the month has. Day 0 of the next month IS the last of this one. */
export function daysInMonth(year: number, month: number): number {
  return utcDay(year, month + 1, 0).getUTCDate();
}

/** Weekday of a calendar day, 0 = Sunday. `getUTCDay`, never `getDay`. */
export function weekdayIndex(year: number, month: number, day: number): number {
  return utcDay(year, month, day).getUTCDay();
}

/** Read a `YYYY-MM-DD`, or `null` when there is nothing real to read. */
export function parseDateValue(value: string | null | undefined): DateParts | null {
  if (typeof value !== 'string') return null;
  const match = ISO_DAY.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // Rejected rather than rolled over: `2026-02-30` is junk from somewhere, and
  // silently showing 2 March would hide whatever produced it.
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

/** The `YYYY-MM-DD` string the field carries. Zero-padded, always. */
export function toDateValue(year: number, month: number, day: number): string {
  const yyyy = String(year).padStart(4, '0');
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Keep an ISO day inside `[min, max]`.
 *
 * Plain string comparison, which is exact for this format and only for this
 * format: `YYYY-MM-DD` is fixed-width and most-significant-first, so
 * lexicographic order IS chronological order. That is the whole reason the wire
 * format is what it is, and it means range checks need no parsing at all.
 */
export function clampDateValue(iso: string, min?: string, max?: string): string {
  if (min && iso < min) return min;
  if (max && iso > max) return max;
  return iso;
}

/** Same day-of-month `delta` months away, pulled back to the month's last day. */
export function stepMonths(iso: string, delta: number): string {
  const parts = parseDateValue(iso);
  if (!parts) return iso;
  const shifted = parts.month - 1 + delta;
  const year = parts.year + Math.floor(shifted / 12);
  const month = ((shifted % 12) + 12) % 12 + 1;
  // 31 January + 1 month is 28 (or 29) February, not 3 March. The rolling
  // version is how a "monthly" series lands on the wrong day four times a year.
  return toDateValue(year, month, Math.min(parts.day, daysInMonth(year, month)));
}

/**
 * WHICH DAY THE WEEK STARTS ON, per locale — 0 = Sunday.
 *
 * Read from CLDR through `Intl.Locale`, not hardcoded and not keyed off a
 * translation file: Spanish weeks start Monday and English (US) weeks start
 * Sunday, and that is a property of the locale in exactly the way month and
 * weekday NAMES are (see the `meridiemLabel` note in `TimePickerPanel` for the
 * same judgment call — format primitives come from `Intl`, only chrome comes
 * from `common.json`).
 *
 * `getWeekInfo().firstDay` is 1 = Monday … 7 = Sunday, so `% 7` maps it onto the
 * 0 = Sunday that `getUTCDay` speaks. The fallback covers a runtime without the
 * API at all rather than a wrong answer from it: this app ships `en` and `es`,
 * and Sunday-first is the minority position worldwide, so anything that is not
 * English starts on Monday.
 */
export function firstDayOfWeek(language: string): number {
  try {
    const locale = new Intl.Locale(language) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const info = typeof locale.getWeekInfo === 'function' ? locale.getWeekInfo() : locale.weekInfo;
    if (typeof info?.firstDay === 'number') return info.firstDay % 7;
  } catch {
    // An unparseable language tag is not worth a blank calendar.
  }
  return language.toLowerCase().startsWith('en') ? 0 : 1;
}

/**
 * ALWAYS SIX ROWS, never five or four.
 *
 * A grid that changed height between months would change the popover's height,
 * and the shell measures that height ONCE to decide whether to sit above or
 * below the field (see `pickerPopover`'s `naturalHeight`). A calendar that
 * re-anchors itself when you page from February to March is worse than one with
 * a row of greyed-out days at the bottom.
 */
const GRID_ROWS = 6;
const GRID_CELLS = GRID_ROWS * 7;

/** How far back the year jump reaches: a care recipient born in 1905 is real. */
const YEARS_BACK = 120;
/** And how far forward: far enough for any event someone would schedule.  */
const YEARS_FORWARD = 10;

/**
 * Header row, weekday row, one week, and the action row, plus the panel's `p-1`
 * and its borders. Below this the cap is not containment but breakage — same
 * floor, and the same reasoning, as `MoreMenu`'s `MIN_USABLE_PANEL`.
 */
const MIN_USABLE_PANEL = 44 + 22 + 44 + 44 + 2 * 4 + 2;

/**
 * THE CALENDAR'S CEILING IS ITS NATURAL HEIGHT, and that is the point.
 *
 * `pickerPopover`'s `MAX_PANEL_HEIGHT` is sized for a scrolling COLUMN, where
 * showing seven of sixty rows loses nothing — the list opens centred on the
 * value and the rest is a scroll away. A month is not a list: `GRID_ROWS` is
 * pinned at six (see its comment) precisely so this panel's height never moves,
 * and capping it at 288 would put the last fortnight of every month behind a
 * scrollbar — a calendar you have to scroll to see the 30th is a worse control
 * than a slightly tall one.
 *
 * IT IS SIZED FOR THE TALLER OF THE TWO PRESENTATIONS, which is the sheet, and
 * getting that wrong is what this comment is now mostly about. The panel's
 * content is identical in both — header 44 + `pb-1`, weekday row 22, six 44px
 * weeks, the action row 44 over its rule and `pt-1` — so the difference is
 * entirely the box around it: `p-1` and two borders anchored (393 in total),
 * against `pickerPopover`'s sheet padding of 12px at each end over a single
 * `border-t` (408). One constant has to clear BOTH, and a ceiling set to the
 * anchored sum caps the sheet 8px short of its own content: the sixth week row
 * goes behind a scrollbar on every phone, at a viewport with 300px to spare.
 * Pinned by `e2e/picker-geometry.spec.ts` — "shows all six week rows on a phone
 * with the height for them" — because it is a rendered-pixel fact and jsdom
 * reports every box as zero.
 *
 * 416 rather than the exact 408 it sums to: the ceiling only has to stop the
 * panel from GROWING, and a few pixels of slack absorb the sub-pixel rounding
 * a zoomed browser adds to nine stacked boxes. Nothing is spent by being
 * generous — the anchored panel's natural 393 is still what it renders at, and
 * the room on the chosen side still caps this, so the grid does scroll (with
 * the focused day centred) when a short window leaves nowhere to put it.
 */
const NATURAL_PANEL_HEIGHT = 416;

/** `1970-01-04` was a Sunday — the reference week the weekday names come from. */
const REFERENCE_SUNDAY = { year: 1970, month: 1, day: 4 };

export interface DatePickerPanelProps {
  /** The panel's DOM id — the trigger's `aria-controls` while open. */
  id: string;
  /** The bordered field shell. The panel anchors to it. */
  anchorRef: RefObject<HTMLElement | null>;
  /** `useMenu`'s `menuRef`, so its outside-click test sees the portalled panel. */
  panelRef: RefObject<HTMLDivElement>;
  /** `useMenu`'s `buttonRef` — the one click target that is not "outside". */
  triggerRef: RefObject<HTMLButtonElement>;
  /** The field's current `YYYY-MM-DD` (empty string when unset). */
  value: string;
  /** The input's `min`, when the caller passed one through the props spread. */
  min?: string;
  /** The input's `max`, likewise. DOB will want `max={today}`. */
  max?: string;
  /** Commit a new `YYYY-MM-DD`, or `''` to clear. */
  onPick: (next: string) => void;
  /** Close the popover and return focus to the trigger. */
  onDismiss: () => void;
}

export function DatePickerPanel({
  id,
  anchorRef,
  panelRef,
  triggerRef,
  value,
  min,
  max,
  onPick,
  onDismiss,
}: DatePickerPanelProps): ReactElement | null {
  const { t, i18n } = useTranslation();
  const language = i18n.language || 'en';
  const gridRef = useRef<HTMLDivElement>(null);

  /**
   * TODAY, in the VIEWER's frame — which is the frame the field's value is in
   * (`recipientEventDate`: the web form holds the viewer's wall clock and the
   * save converts). Through `getDateInTimezone`, so the day comes out of `Intl`
   * rather than out of `getDate()`.
   */
  const today = useMemo(() => getDateInTimezone(getDeviceTimezone()), []);

  const selected = parseDateValue(value);
  const selectedIso = selected ? value.trim() : null;

  /**
   * Where the grid opens and where the keyboard starts: the value if there is
   * one, otherwise today — and then pulled inside `[min, max]`, because a
   * picker whose first keystroke is refused is worse than one that opens on a
   * different month.
   */
  const anchorIso = clampDateValue(selectedIso ?? today, min, max);

  const [focusedDay, setFocusedDay] = useState(anchorIso);
  const [view, setView] = useState(() => {
    const parts = parseDateValue(anchorIso) ?? { year: 1970, month: 1, day: 1 };
    return { year: parts.year, month: parts.month };
  });

  /**
   * Set by the grid's own key handling, and ONLY by it. The month and year
   * jumps also move `focusedDay` (so the grid always has a tab stop in view),
   * but focus must stay on the `<select>` the user is still using — an effect
   * that chased `focusedDay` unconditionally would eject them from it on every
   * arrow press inside the dropdown.
   */
  const pendingGridFocus = useRef(false);

  useEffect(() => {
    if (!pendingGridFocus.current) return;
    pendingGridFocus.current = false;
    gridRef.current?.querySelector<HTMLElement>(`[data-day="${focusedDay}"]`)?.focus();
    // No dependency array on purpose: the flag is cleared on whichever render
    // follows the move that set it, so a move that lands on the day already
    // focused (Home at the start of a week) cannot leave it armed for later.
  });

  const first = firstDayOfWeek(language);

  const formats = useMemo(
    () => ({
      weekdayShort: getCachedDateTimeFormat(language, { weekday: 'short', timeZone: 'UTC' }),
      weekdayLong: getCachedDateTimeFormat(language, { weekday: 'long', timeZone: 'UTC' }),
      month: getCachedDateTimeFormat(language, { month: 'long', timeZone: 'UTC' }),
      monthYear: getCachedDateTimeFormat(language, {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }),
      fullDate: getCachedDateTimeFormat(language, { dateStyle: 'long', timeZone: 'UTC' }),
    }),
    [language]
  );

  /**
   * Weekday names, rotated to the locale's first day.
   *
   * Built off a known Sunday rather than off "some day in the current month",
   * so the names cannot drift with the month being displayed. Lower-case in
   * Spanish ("dom", "lun") because that is what CLDR says, the same way the
   * meridiem is `p. m.` and not `P. M.`.
   */
  const weekdays = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const ref = utcDay(
          REFERENCE_SUNDAY.year,
          REFERENCE_SUNDAY.month,
          REFERENCE_SUNDAY.day + ((first + i) % 7)
        );
        return { short: formats.weekdayShort.format(ref), long: formats.weekdayLong.format(ref) };
      }),
    [formats, first]
  );

  const monthYearLabel = formats.monthYear.format(utcDay(view.year, view.month, 1));

  /** The 42 days on screen, starting at the first weekday cell of the grid. */
  const cells = useMemo(() => {
    const lead = (weekdayIndex(view.year, view.month, 1) - first + 7) % 7;
    const start = addDaysToIsoDay(toDateValue(view.year, view.month, 1), -lead);
    return Array.from({ length: GRID_CELLS }, (_, i) => addDaysToIsoDay(start, i));
  }, [view.year, view.month, first]);

  const commit = useCallback(
    (iso: string): void => {
      onPick(iso);
      onDismiss();
    },
    [onPick, onDismiss]
  );

  /** Move the grid's focused day, dragging the visible month along with it. */
  const moveFocus = useCallback(
    (iso: string): void => {
      const next = clampDateValue(iso, min, max);
      const parts = parseDateValue(next);
      if (!parts) return;
      pendingGridFocus.current = true;
      setFocusedDay(next);
      setView({ year: parts.year, month: parts.month });
    },
    [min, max]
  );

  /** The month/year jumps: same day-of-month, no focus stolen from the select. */
  const jumpTo = useCallback(
    (year: number, month: number): void => {
      const parts = parseDateValue(focusedDay);
      const day = Math.min(parts?.day ?? 1, daysInMonth(year, month));
      const next = clampDateValue(toDateValue(year, month, day), min, max);
      const landed = parseDateValue(next);
      if (!landed) return;
      setFocusedDay(next);
      setView({ year: landed.year, month: landed.month });
    },
    [focusedDay, min, max]
  );

  /**
   * WAI-ARIA's grid keys, and its semantics: the arrows move FOCUS only, and
   * Enter/Space is what commits. Deliberately unlike `TimePickerPanel`, where
   * selection follows focus — a time has 60 neighbours and re-picking one is
   * free, while every arrow press here would otherwise fire the caller's
   * `onChange` (and, at two call sites, clear a validation error and mark the
   * form dirty) thirty times on the way across a month.
   */
  const onGridKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>): void => {
      const column = (() => {
        const parts = parseDateValue(focusedDay);
        return parts ? (weekdayIndex(parts.year, parts.month, parts.day) - first + 7) % 7 : 0;
      })();

      let next: string | null = null;
      switch (event.key) {
        case 'ArrowLeft':
          next = addDaysToIsoDay(focusedDay, -1);
          break;
        case 'ArrowRight':
          next = addDaysToIsoDay(focusedDay, 1);
          break;
        case 'ArrowUp':
          next = addDaysToIsoDay(focusedDay, -7);
          break;
        case 'ArrowDown':
          next = addDaysToIsoDay(focusedDay, 7);
          break;
        case 'Home':
          next = addDaysToIsoDay(focusedDay, -column);
          break;
        case 'End':
          next = addDaysToIsoDay(focusedDay, 6 - column);
          break;
        case 'PageUp':
          next = stepMonths(focusedDay, event.shiftKey ? -12 : -1);
          break;
        case 'PageDown':
          next = stepMonths(focusedDay, event.shiftKey ? 12 : 1);
          break;
        case 'Enter':
        case ' ':
          // Handled here rather than left to the button's own click: the day
          // cells carry a roving tabindex and `preventDefault` keeps the
          // keydown from also synthesising one, which would commit twice.
          event.preventDefault();
          event.stopPropagation();
          if (clampDateValue(focusedDay, min, max) === focusedDay) commit(focusedDay);
          return;
        default:
          return;
      }

      // Every handled key stops here — see `pickerPopover.tsx` for what these
      // reach otherwise. PageUp/PageDown in particular scroll the modal behind
      // the picker if they are allowed past.
      event.preventDefault();
      event.stopPropagation();
      moveFocus(next);
    },
    [focusedDay, first, min, max, commit, moveFocus]
  );

  /**
   * Open with the focused day centred and focused — through the shell's
   * `onPositioned`, for the reason `TimePickerPanel` gives at the same hook:
   * the grid's `clientHeight` is not real until the shell's max-height cap is
   * committed, and a passive effect is not ordered against that.
   */
  const onPositioned = useCallback((): void => {
    const grid = gridRef.current;
    const cell = grid?.querySelector<HTMLElement>(`[data-day="${focusedDay}"]`);
    if (grid && cell) centerInColumn(grid, cell);
    cell?.focus({ preventScroll: true });
    // Once, on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Only years the range actually allows, and never one the grid is showing. */
  const years = useMemo(() => {
    const base = parseDateValue(today)?.year ?? view.year;
    let from = base - YEARS_BACK;
    let to = base + YEARS_FORWARD;
    const minYear = parseDateValue(min ?? '')?.year;
    const maxYear = parseDateValue(max ?? '')?.year;
    if (minYear !== undefined) from = Math.max(from, minYear);
    if (maxYear !== undefined) to = Math.min(to, maxYear);
    from = Math.min(from, view.year);
    to = Math.max(to, view.year);
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  }, [today, view.year, min, max]);

  /** A month is unreachable when the whole of it lies outside `[min, max]`. */
  const monthDisabled = useCallback(
    (year: number, month: number): boolean => {
      const last = toDateValue(year, month, daysInMonth(year, month));
      const firstOf = toDateValue(year, month, 1);
      return Boolean((min && last < min) || (max && firstOf > max));
    },
    [min, max]
  );

  const prev = stepMonths(toDateValue(view.year, view.month, 1), -1);
  const next = stepMonths(toDateValue(view.year, view.month, 1), 1);
  const prevParts = parseDateValue(prev);
  const nextParts = parseDateValue(next);
  const prevDisabled = prevParts ? monthDisabled(prevParts.year, prevParts.month) : true;
  const nextDisabled = nextParts ? monthDisabled(nextParts.year, nextParts.month) : true;
  const todayDisabled = clampDateValue(today, min, max) !== today;

  const NAV_BUTTON =
    'inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-bg-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50';
  // The §4.5 field look, shrunk to popover chrome: `Select` itself is a whole
  // labelled form row (its `INPUT_LABEL` reserves 8px under a label this header
  // has no room to show), so what is borrowed is the treatment, not the
  // component — `appearance-none` plus our own `chevron-down`, so no platform
  // caret appears inside a popover that exists to get rid of platform chrome.
  const JUMP_SELECT =
    'min-h-[44px] w-full cursor-pointer appearance-none rounded-md border border-line-2 bg-cream pl-2 pr-7 text-sm text-ink outline-none transition-colors focus:border-moss-light';

  return (
    <PickerPopover
      id={id}
      label={t('common:datePicker.label')}
      anchorRef={anchorRef}
      panelRef={panelRef}
      triggerRef={triggerRef}
      onDismiss={onDismiss}
      minHeight={MIN_USABLE_PANEL}
      maxHeight={NATURAL_PANEL_HEIGHT}
      onPositioned={onPositioned}
      // 7 × 44px cells + the 12px scrollbar lane + the panel's `p-1`. Allowed
      // to shrink below that on a narrow phone: losing a few pixels of cell
      // WIDTH is survivable, and a horizontally clipped calendar is not.
      className="w-[20.5rem] max-w-[calc(100vw-1rem)]"
    >
      <div className="flex items-center gap-1 pb-1">
        <button
          type="button"
          aria-label={t('common:datePicker.previousMonth')}
          disabled={prevDisabled}
          onClick={() => prevParts && jumpTo(prevParts.year, prevParts.month)}
          className={NAV_BUTTON}
        >
          <Icon name="chevron-back" size="inline" />
        </button>
        <div className="relative flex min-w-0 flex-1 items-center">
          <select
            aria-label={t('common:datePicker.month')}
            value={view.month}
            onChange={(event) => jumpTo(view.year, Number(event.target.value))}
            className={JUMP_SELECT}
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
              <option key={month} value={month} disabled={monthDisabled(view.year, month)}>
                {formats.month.format(utcDay(view.year, month, 1))}
              </option>
            ))}
          </select>
          <Icon
            name="chevron-down"
            size="inline"
            className="pointer-events-none absolute right-1.5 text-ink-2"
          />
        </div>
        <div className="relative flex w-[5.5rem] shrink-0 items-center">
          <select
            aria-label={t('common:datePicker.year')}
            value={view.year}
            onChange={(event) => jumpTo(Number(event.target.value), view.month)}
            className={`${JUMP_SELECT} tabular-nums`}
          >
            {years.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
          <Icon
            name="chevron-down"
            size="inline"
            className="pointer-events-none absolute right-1.5 text-ink-2"
          />
        </div>
        <button
          type="button"
          aria-label={t('common:datePicker.nextMonth')}
          disabled={nextDisabled}
          onClick={() => nextParts && jumpTo(nextParts.year, nextParts.month)}
          className={NAV_BUTTON}
        >
          <Icon name="chevron-forward" size="inline" />
        </button>
      </div>

      <div
        ref={gridRef}
        role="grid"
        // The grid names itself with the month it is showing, so a screen
        // reader moving into it hears "September 2026" before the first day —
        // the visible heading is the two selects, which name themselves.
        aria-label={monthYearLabel}
        onKeyDown={onGridKeyDown}
        className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${SCROLL_GUTTER}`}
      >
        <div role="row" className="sticky top-0 z-10 grid grid-cols-7 bg-cream">
          {weekdays.map((weekday) => (
            <div
              key={weekday.long}
              role="columnheader"
              // The visible text is the abbreviation; the accessible name is
              // the whole word, so "mié" is not read out as a syllable.
              aria-label={weekday.long}
              className="flex h-[22px] items-center justify-center text-xs font-medium text-ink-3"
            >
              {weekday.short}
            </div>
          ))}
        </div>
        {Array.from({ length: GRID_ROWS }, (_, row) => (
          <div key={row} role="row" className="grid grid-cols-7">
            {cells.slice(row * 7, row * 7 + 7).map((iso) => {
              const parts = parseDateValue(iso);
              if (!parts) return null;
              const outside = parts.year !== view.year || parts.month !== view.month;
              const blocked = clampDateValue(iso, min, max) !== iso;
              const chosen = iso === selectedIso;
              const isToday = iso === today;
              return (
                <button
                  key={iso}
                  type="button"
                  role="gridcell"
                  data-day={iso}
                  aria-selected={chosen}
                  // `aria-current="date"` is the non-visual half of the today
                  // marker; the dot below is the visual half. Neither is a
                  // colour, which is the point — WCAG 1.4.1, and this project's
                  // ADA audit calls it out by name.
                  aria-current={isToday ? 'date' : undefined}
                  aria-label={formats.fullDate.format(utcDay(parts.year, parts.month, parts.day))}
                  disabled={blocked}
                  // Roving tabindex: one cell in the month is a tab stop, which
                  // is what keeps the shell's Tab cycle to the chrome plus one
                  // day rather than forty-two. The focus ring is the global
                  // `*:focus-visible` outline — see `Toggle`.
                  tabIndex={iso === focusedDay ? 0 : -1}
                  onClick={() => commit(iso)}
                  className={`relative flex h-11 items-center justify-center rounded-md text-md tabular-nums transition-colors duration-fast disabled:cursor-not-allowed disabled:opacity-50 ${
                    chosen
                      ? // Selected is NOT the moss fill alone (WCAG 1.4.1): the
                        // weight carries it without colour, and `aria-selected`
                        // carries it without sight.
                        'bg-moss font-semibold text-cream'
                      : outside
                        ? 'text-ink-3 hover:bg-bg-2'
                        : 'text-ink hover:bg-bg-2'
                  }`}
                >
                  {parts.day}
                  {isToday ? (
                    <span
                      aria-hidden="true"
                      className={`absolute bottom-1 h-1 w-1 rounded-full ${
                        chosen ? 'bg-cream' : 'bg-moss'
                      }`}
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-line-2 pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={() => commit('')}>
          {t('common:datePicker.clear')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={todayDisabled}
          onClick={() => commit(today)}
        >
          {t('common:today')}
        </Button>
      </div>
    </PickerPopover>
  );
}

// Default export as well as the named one: `DateField` reaches this module
// through `React.lazy`, which resolves a module's `default`.
export default DatePickerPanel;
