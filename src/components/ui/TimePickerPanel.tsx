import {
  useCallback,
  useMemo,
  useRef,
  type KeyboardEvent,
  type ReactElement,
  type RefObject,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useHourCycle } from '@/hooks/useHourCycle';
import { formatTimeOfDay } from '@/utils/timezone';
import {
  PickerPopover,
  SCROLL_GUTTER,
  SHEET_MAX_PANEL_HEIGHT,
  centerInColumn,
  usePickerPresentation,
} from './pickerPopover';

/**
 * The hour/minute/AM-PM popover behind `TimeField`, replacing Chrome's native
 * time wheel with the app's own palette. Same interaction model as the wheel —
 * three scrollable columns — because that is the control caregivers already
 * know; only the paint and the a11y wiring are ours.
 *
 * THE VALUE CONTRACT IS `HH:MM`, 24-HOUR, ALWAYS. What the columns SHOW is the
 * viewer's hour cycle (`useHourCycle`); what `onPick` emits never is. Every
 * caller, and all of `utils/timezone.ts`, reads the 24-hour string off the
 * native `<input type="time">` — so the display↔value conversion below is the
 * only conversion in this component, and `from12h` is where every 12-hour
 * picker in the world gets 12 AM and 12 PM wrong. See `TimePicker.test.tsx`.
 *
 * THE POPOVER ITSELF IS NOT HERE. Portalling, fixed positioning, the
 * flip-above-then-clamp, outside click, and the Escape/Tab rules that keep the
 * enclosing `Modal` out of it all live in `pickerPopover.tsx`, shared with
 * `DatePickerPanel` — read that module's header before changing any of it.
 * What is left in this file is the three columns and the 12/24-hour arithmetic.
 *
 * LIVES IN ITS OWN MODULE, AND `TimeField` REACHES IT ONLY THROUGH
 * `React.lazy`. `useHourCycle` is a React Query read that pulls in
 * `store/authStore`, which pulls in the whole i18n bootstrap, the analytics
 * client and the API client. Every other file under `components/ui/` is free
 * of stores and API modules — deliberately, since the barrel `components/ui`
 * is imported by nearly every screen and every screen's tests. A static import
 * from `TimeField` would have quietly made that true of the barrel too (it did:
 * `MedicationDetailModal.test`, which mocks `react-i18next` partially, started
 * failing on `initReactI18next` the moment this edge existed). Deferring the
 * whole popover keeps the layering, and a 60-row picker nobody has opened yet
 * is exactly the kind of thing that should not be in the first chunk.
 */

export interface TimeParts {
  /** 0-23. */
  hour24: number;
  /** 0-59. */
  minute: number;
}

/**
 * Read an `HH:MM` value, or `null` when there is nothing to read.
 *
 * Tolerates the `HH:MM:SS` form on purpose: Postgres `TIME` columns serialise
 * that way and the quiet-hours round trip has handed it to a field before
 * (see `project_quiet_hours_time_format`). Seconds are dropped, never
 * rendered — the picker has no third column and the contract has no seconds.
 */
export function parseTimeValue(value: string | null | undefined): TimeParts | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!match) return null;
  const hour24 = Number(match[1]);
  const minute = Number(match[2]);
  // `24:00` is a real value in this database (the midnight serialisation
  // `formatTimeOfDay` documents), and it means hour 0 — not an out-of-range
  // hour to reject, which would silently blank the field on open.
  if (hour24 > 24 || minute > 59) return null;
  return { hour24: hour24 % 24, minute };
}

/** The `HH:MM` string the field carries. Zero-padded, 24-hour, no seconds. */
export function toTimeValue(hour24: number, minute: number): string {
  const hh = (((hour24 % 24) + 24) % 24).toString().padStart(2, '0');
  const mm = minute.toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

/** 24-hour clock → what a 12-hour column shows. `0 → 12 AM`, `12 → 12 PM`. */
export function to12h(hour24: number): { hour12: number; pm: boolean } {
  const normalised = (((hour24 % 24) + 24) % 24) % 24;
  return { hour12: normalised % 12 || 12, pm: normalised >= 12 };
}

/**
 * What a 12-hour column shows → the 24-hour clock. THE BOUNDARY CASES ARE THE
 * WHOLE POINT: `12 AM` is hour 0 and `12 PM` is hour 12, which is why this is
 * `(hour12 % 12) + offset` and not `hour12 + offset`. The naive form makes
 * midnight 12 and noon 24 — the same twelve-hours-wrong bug `formatTimeOfDay`
 * carries a comment block about.
 */
export function from12h(hour12: number, pm: boolean): number {
  return (hour12 % 12) + (pm ? 12 : 0);
}

/**
 * Where the columns sit when the field is EMPTY. Nothing is marked selected in
 * that state (see `hasValue` below) — this only decides which row the popover
 * opens on and which row the keyboard starts from. Noon, because it is the one
 * hour that reads the same in both cycles and because landing on `00:00`
 * suggests a value the field does not have.
 */
const EMPTY_FIELD_ANCHOR: TimeParts = { hour24: 12, minute: 0 };

const MINUTES: readonly number[] = Array.from({ length: 60 }, (_, i) => i);
const HOURS_24: readonly number[] = Array.from({ length: 24 }, (_, i) => i);
/** 12 leads, as every 12-hour clock face does — not 1. */
const HOURS_12: readonly number[] = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

const pad2 = (n: number): string => n.toString().padStart(2, '0');

/**
 * "AM" / "PM" — or, in Spanish, the RAE `a. m.` / `p. m.`.
 *
 * Derived from `formatTimeOfDay` rather than from an i18n key, DELIBERATELY,
 * and for the reason that file's `MERIDIEM` comment gives: the meridiem is a
 * locale format primitive, not copy. A key that has not loaded yet renders its
 * own name, and a well-meaning edit to `PM` in `es/common.json` would silently
 * undo RAE compliance. Reading it back off the one formatter every other time
 * in the app goes through also makes drift impossible: if the calendar says
 * `p. m.`, this column cannot say anything else.
 */
function meridiemLabel(hour24: number): string {
  return formatTimeOfDay(hour24, 0, '12h').split(' ').slice(1).join(' ');
}

interface PickerOption {
  /** What the row shows. Also its accessible name. */
  label: string;
  /** The `HH:MM` this row commits when chosen. */
  value: string;
}

interface PickerColumn {
  key: string;
  label: string;
  options: PickerOption[];
  /** The row the keyboard and the open-scroll start from. Always in range. */
  activeIndex: number;
}

/**
 * ROW HEIGHT ON A MOUSE — 36, not the 44 every touch target in this app is.
 *
 * `Modal` already made this call once and wrote the rule down at
 * `MODAL_FOOTER_CLASS`: 44 is MOBILE's thumb target, and "a dialog footer on a
 * desktop is a mouse target beside another button". A picker column is the same
 * kind of thing — its rows are stacked, not spaced, so the 44 buys no
 * separation from a neighbour a MOUSE would ever mis-click. What it did buy was
 * height: twelve hours at 44 is a 562px panel.
 *
 * THE OTHER HALF OF THAT ARGUMENT IS DEAD, and it used to be written here: "the
 * whole control exists only on a pointer device (the field's own
 * `<input type="time">` is what a touch keyboard edits)". It does not. The
 * popover is now the picker on every device — see `pickerPopover`'s header for
 * the three defects that had to be solved before it could be — so the touch
 * case gets {@link TOUCH_ROW_HEIGHT} and this number is scoped to the pointer
 * it was always really about.
 *
 * 36 stays well clear of WCAG 2.2 §2.5.8's 24×24 minimum (AA) with half again
 * to spare, and clear of the ~32 below which a row stops reading as a row.
 * It is also the number `MAX_PANEL_HEIGHT` is derived from (see
 * `pickerPopover`): seven of these plus the header is the panel.
 */
const ROW_HEIGHT = 36;

/**
 * ROW HEIGHT UNDER A FINGER — the house standard, and WCAG 2.5.5 (AAA).
 *
 * Every other touch target in this app is 44 (`INPUT_TRAILING`, `CHIP_BOX`,
 * `OPTION_BOX`, the calendar's own day cells), and a minute column is the one
 * place where mis-tapping a NEIGHBOUR is not a nuisance but a dose recorded an
 * hour out. The 562px panel that argument costs on a desktop costs nothing
 * here: the sheet's height comes from the viewport, not from the gap under a
 * field, and {@link SHEET_MAX_PANEL_HEIGHT} is the same seven rows at this
 * size.
 */
const TOUCH_ROW_HEIGHT = 44;

/**
 * The two row heights as Tailwind can actually see them.
 *
 * Written out as literals because Tailwind's scanner reads class STRINGS out of
 * source text and can never resolve `min-h-[${ROW_HEIGHT}px]` — the same
 * hand-copy the file has always carried, now twice over. Change a constant and
 * change its twin here: `src/__tests__/bans/pickerRowHeight.test.ts` is the
 * source scan that makes that mandatory rather than merely requested, and it
 * checks BOTH pairs.
 */
const ROW_MIN_H = { fine: 'min-h-[36px]', touch: 'min-h-[44px]' } as const;

/**
 * The shortest panel worth capping to, at whichever row size is in play: the
 * 26px column header (12px `text-xs` at the 1.5 leading `globals.css` sets,
 * over `pt-1 pb-1`) plus one row, plus the panel's own 1px borders and `p-1`.
 * Below this a capped panel is not containment but breakage — the same floor,
 * and the same reasoning, as `MoreMenu`'s `MIN_USABLE_PANEL`.
 *
 * A FUNCTION, because the floor has to move with the row it reserves room for.
 * Left at the 36px value in the touch case it would let the shell clamp a sheet
 * to a height that cannot show one whole 44px row — which is the exact class of
 * silent drift the ban test above was written for, arrived at from the inside.
 */
function minUsablePanel(rowHeight: number): number {
  return 26 + rowHeight + 2 * 4 + 2;
}

export interface TimePickerPanelProps {
  /** The panel's DOM id — the trigger's `aria-controls` while open. */
  id: string;
  /** The bordered field shell. The panel anchors under it. */
  anchorRef: RefObject<HTMLElement | null>;
  /** `useMenu`'s `menuRef`, so its outside-click test sees the portalled panel. */
  panelRef: RefObject<HTMLDivElement>;
  /** `useMenu`'s `buttonRef` — the one click target that is not "outside". */
  triggerRef: RefObject<HTMLButtonElement>;
  /** The field's current `HH:MM` (empty string when unset). */
  value: string;
  /** Commit a new `HH:MM`. Fires on every arrow key too — selection follows focus. */
  onPick: (next: string) => void;
  /** Close the popover and return focus to the trigger. */
  onDismiss: () => void;
}

export function TimePickerPanel({
  id,
  anchorRef,
  panelRef,
  triggerRef,
  value,
  onPick,
  onDismiss,
}: TimePickerPanelProps): ReactElement | null {
  const { t } = useTranslation();
  const hourCycle = useHourCycle();
  const columnRefs = useRef<(HTMLUListElement | null)[]>([]);
  // The shell's own decision, read back rather than re-derived: this panel does
  // not get to disagree with the box it is being rendered into about which
  // device it is on.
  const sheet = usePickerPresentation() === 'sheet';

  const selected = parseTimeValue(value);
  const hasValue = selected !== null;
  const anchor = selected ?? EMPTY_FIELD_ANCHOR;

  const columns = useMemo<PickerColumn[]>(() => {
    const minuteColumn: PickerColumn = {
      key: 'minute',
      label: t('common:timePicker.minute'),
      // ALL SIXTY. Snapping to 5- or 15-minute steps is a capability
      // regression: `<input type="time">` accepts 8:48, the database stores
      // 8:48, and a picker that cannot express it would quietly round a dose
      // time the caregiver had already entered.
      options: MINUTES.map((minute) => ({
        label: pad2(minute),
        value: toTimeValue(anchor.hour24, minute),
      })),
      activeIndex: anchor.minute,
    };

    if (hourCycle === '24h') {
      return [
        {
          key: 'hour',
          label: t('common:timePicker.hour'),
          options: HOURS_24.map((hour24) => ({
            label: pad2(hour24),
            value: toTimeValue(hour24, anchor.minute),
          })),
          activeIndex: anchor.hour24,
        },
        minuteColumn,
      ];
    }

    const { hour12, pm } = to12h(anchor.hour24);
    return [
      {
        key: 'hour',
        label: t('common:timePicker.hour'),
        options: HOURS_12.map((h12) => ({
          label: pad2(h12),
          value: toTimeValue(from12h(h12, pm), anchor.minute),
        })),
        // HOURS_12 leads with 12, so the index is the hour itself except for
        // 12 o'clock, which sits at the top.
        activeIndex: hour12 === 12 ? 0 : hour12,
      },
      minuteColumn,
      {
        key: 'period',
        label: t('common:timePicker.period'),
        options: [false, true].map((isPm) => ({
          label: meridiemLabel(isPm ? 13 : 1),
          value: toTimeValue(from12h(hour12, isPm), anchor.minute),
        })),
        activeIndex: pm ? 1 : 0,
      },
    ];
  }, [t, hourCycle, anchor.hour24, anchor.minute]);

  const optionAt = useCallback((column: number, index: number): HTMLElement | null => {
    return columnRefs.current[column]?.querySelector<HTMLElement>(`[data-index="${index}"]`) ?? null;
  }, []);

  /**
   * Open ON the current value, not at the top of a 60-row list. Opening a field
   * reading 8:48 PM and being shown "00" is the single most annoying thing a
   * column picker can do.
   *
   * Runs from the popover's `onPositioned` — NOT a `useEffect` — because
   * `centerInColumn` reads `clientHeight`, and a column has no meaningful
   * height until the shell's max-height cap is committed. A passive effect is
   * not ordered against that commit, and the version that used one shipped the
   * `08:00` bug the shell's `centerInColumn` comment describes.
   *
   * `preventScroll` on the focus: the scroll position is already exactly where
   * this function put it, and the browser's own focus scrolling would be a
   * second opinion about it.
   */
  const onPositioned = useCallback((): void => {
    columns.forEach((column, columnIndex) => {
      const list = columnRefs.current[columnIndex];
      const node = optionAt(columnIndex, column.activeIndex);
      if (list && node) centerInColumn(list, node);
    });
    optionAt(0, columns[0]?.activeIndex ?? 0)?.focus({ preventScroll: true });
    // Once, on open. Re-running on every pick would yank the hour column back
    // under the pointer each time a minute is clicked — which is why this is a
    // one-shot callback from the shell rather than an effect over `columns`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const move = useCallback(
    (column: number, index: number): void => {
      const target = columns[column]?.options[index];
      if (!target) return;
      onPick(target.value);
      optionAt(column, index)?.focus();
    },
    [columns, onPick, optionAt]
  );

  const focusColumn = useCallback(
    (column: number): void => {
      const target = columns[column];
      if (!target) return;
      optionAt(column, target.activeIndex)?.focus();
    },
    [columns, optionAt]
  );

  /**
   * EVERY HANDLED KEY STOPS PROPAGATING, and that is load-bearing rather than
   * tidy — see `pickerPopover.tsx` for what reaches `Modal` otherwise. Escape
   * and Tab are NOT here: the shell owns both, and Tab cycling the three
   * columns falls out of the roving tabindex below rather than being written
   * twice.
   */
  const onColumnKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>, columnIndex: number): void => {
      const column = columns[columnIndex];
      if (!column) return;
      const count = column.options.length;
      const current = column.activeIndex;
      const lastColumn = columns.length - 1;

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          event.stopPropagation();
          // Hours and minutes are cyclic and the native input's own arrow keys
          // wrap, so these do too — 23 → 00 is a real edit, not an overshoot.
          move(columnIndex, (current + 1) % count);
          break;
        case 'ArrowUp':
          event.preventDefault();
          event.stopPropagation();
          move(columnIndex, (current - 1 + count) % count);
          break;
        case 'Home':
          event.preventDefault();
          event.stopPropagation();
          move(columnIndex, 0);
          break;
        case 'End':
          event.preventDefault();
          event.stopPropagation();
          move(columnIndex, count - 1);
          break;
        case 'ArrowRight':
          event.preventDefault();
          event.stopPropagation();
          focusColumn(Math.min(columnIndex + 1, lastColumn));
          break;
        case 'ArrowLeft':
          event.preventDefault();
          event.stopPropagation();
          focusColumn(Math.max(columnIndex - 1, 0));
          break;
        case 'Enter':
        case ' ':
          // The value is already committed (selection follows focus), so these
          // only mean "done".
          event.preventDefault();
          event.stopPropagation();
          onDismiss();
          break;
        default:
          break;
      }
    },
    [columns, move, focusColumn, onDismiss]
  );

  return (
    <PickerPopover
      id={id}
      label={t('common:timePicker.label')}
      anchorRef={anchorRef}
      panelRef={panelRef}
      triggerRef={triggerRef}
      onDismiss={onDismiss}
      minHeight={minUsablePanel(sheet ? TOUCH_ROW_HEIGHT : ROW_HEIGHT)}
      // Seven rows plus the chrome either way — the same design decision at the
      // two row sizes, which is why the sheet's ceiling is a second constant
      // and not a second rule.
      maxHeight={sheet ? SHEET_MAX_PANEL_HEIGHT : undefined}
      onPositioned={onPositioned}
      // 3 × (a 56px digit column + its 12px scrollbar lane). Stated on the
      // panel so a two-column 24-hour picker is narrower rather than stretched.
      // Ignored in the sheet presentation, which is as wide as the viewport.
      className="min-w-[12.75rem]"
    >
      <div className="flex min-h-0 flex-1">
        {columns.map((column, columnIndex) => (
          <div
            key={column.key}
            // 4.25rem = the 3.5rem of digits this column has always been, plus
            // the 0.75rem lane `SCROLL_GUTTER` gives the overlay scrollbar. The
            // digits did not get narrower; the column got wider.
            className={`flex min-h-0 min-w-[4.25rem] flex-1 flex-col ${
              columnIndex > 0 ? 'border-l border-line-2' : ''
            }`}
          >
            <span
              id={`${id}-${column.key}-label`}
              // NOT `uppercase`: the Spanish period column reads `a. m./p. m.`
              // (RAE, see `meridiemLabel`), and a text-transform would render
              // it `A. M./P. M.` — the exact form `utils/timezone.ts` keeps a
              // comment block about not shipping. `whitespace-nowrap` because
              // that label is the widest thing in its column and wrapping it
              // to two lines pushes the rows out of alignment. It carries the
              // same gutter as the rows below so the two stay centred on the
              // same axis.
              className={`whitespace-nowrap px-2 pb-1 pt-1 text-center text-xs font-medium text-ink-3 ${SCROLL_GUTTER}`}
            >
              {column.label}
            </span>
            <ul
              ref={(node) => {
                columnRefs.current[columnIndex] = node;
              }}
              role="listbox"
              aria-labelledby={`${id}-${column.key}-label`}
              className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${SCROLL_GUTTER}`}
            >
              {column.options.map((option, index) => {
                const active = index === column.activeIndex;
                const chosen = hasValue && active;
                return (
                  <li
                    key={option.label}
                    role="option"
                    data-index={index}
                    aria-selected={chosen}
                    // Roving tabindex: exactly one row per column is tabbable,
                    // which is what makes the columns themselves a tab stop
                    // each and keeps the shell's Tab handler above a two-line
                    // cycle rather than a 60-row one. The ring is the global
                    // `*:focus-visible` outline — `Toggle` explains why a
                    // hand-rolled second focus language is not welcome here.
                    tabIndex={active ? 0 : -1}
                    onKeyDown={(event) => onColumnKeyDown(event, columnIndex)}
                    onClick={() => move(columnIndex, index)}
                    // `min-h-[36px]` / `min-h-[44px]` are `ROW_HEIGHT` and
                    // `TOUCH_ROW_HEIGHT`, written out in `ROW_MIN_H` because
                    // Tailwind reads class strings statically and cannot be
                    // handed a constant. Change one and change the other.
                    className={`flex ${
                      sheet ? ROW_MIN_H.touch : ROW_MIN_H.fine
                    } cursor-pointer items-center justify-center rounded-md px-2 text-md tabular-nums transition-colors duration-fast ${
                      // Selected is NOT signalled by the moss fill alone
                      // (WCAG 1.4.1): the weight change carries it for anyone
                      // who cannot separate the two grounds, and
                      // `aria-selected` carries it for anyone who cannot see
                      // either.
                      chosen ? 'bg-moss font-semibold text-cream' : 'text-ink hover:bg-bg-2'
                    }`}
                  >
                    {option.label}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </PickerPopover>
  );
}

// Default export as well as the named one: `TimeField` reaches this module
// through `React.lazy`, which resolves a module's `default`. See the import
// comment there for why this edge has to stay dynamic.
export default TimePickerPanel;
