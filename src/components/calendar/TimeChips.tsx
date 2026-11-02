import { type CSSProperties, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { MED_TIME_CHIPS, chipForTime, type MedTimeChipId } from '@/lib/medTimeOfDay';
import { formatTimeOfDay } from '@/utils/timezone';
import { useFitColumns } from '@/lib/largeText';
import type { HourCycle } from '@/utils/hourCycle';
import { CHIP_SELECTED, CHIP_UNSELECTED } from '@/components/ui/inputStyles';

// The four quick times under "When?" on the new-medication form (simple UI 1.3.1):
// Morning 8:00 AM, Midday 12:00 PM, Evening 6:00 PM, Bedtime 9:00 PM, on the CARE
// RECIPIENT's clock (mobile parity; the form converts them to the viewer's fields).
// "Other time" (it reveals the regular time field) is a button, not a radio, but it is
// drawn as the SAME chip and sits as the fifth cell of the same grid (owner 1.4.0, mobile
// parity): Morning/Midday/Evening, then Bedtime/Other time, in equal columns. The column
// count is fitted on measured layout (lib/largeText `useFitColumns`): 3, fewer while any
// label or time would not fit on one line, ONE at large text. The group is a radiogroup
// with a roving tab stop; the selected chip is the one whose time EXACTLY matches the
// recipient's clock for the form's time. "Other time" stays OUTSIDE the radiogroup in the
// DOM (a radiogroup owns radios only) and is placed into the shared grid with CSS subgrid.

export interface TimeChipsProps {
  id: string;
  /** The RECIPIENT's HH:MM the form's time names ('' = unset), not the viewer-frame field. */
  value: string;
  hourCycle: HourCycle;
  /** Pick a chip (its recipient-frame HH:MM), or null when the selected chip is tapped again. */
  onChange: (chip: MedTimeChipId | null, time: string) => void;
  describedBy?: string;
  /** "Other time": the fifth cell, same chip shape, a button that reveals the time field. */
  other?: TimeChipsOther;
}

export interface TimeChipsOther {
  label: string;
  /** The time field it reveals is open. */
  expanded: boolean;
  /** Lit like a selected chip: a custom (non-chip) time is the answer. */
  selected: boolean;
  /** That custom time, formatted: shown under the label as a chip shows its own (mobile parity). */
  time?: string;
  onClick: () => void;
}

/** Most columns the time-chip grid uses (mobile parity: 3). */
export const TIME_CHIP_MAX_COLUMNS = 3;

/** Pure: where cell `index` (0-based) of a `columns`-wide grid sits (1-based CSS grid lines). */
export function gridCellPlacement(index: number, columns: number): { row: number; column: number } {
  const c = Math.max(1, columns);
  return { row: Math.floor(index / c) + 1, column: (index % c) + 1 };
}

/** The chip box shared by the time chips and "Other time" (same radius, height, border, padding). */
export const TIME_CHIP_BOX =
  'flex min-h-[56px] min-w-0 flex-col items-start justify-center gap-px overflow-hidden rounded-2xl border px-3.5 py-2 text-left transition-colors duration-fast';

function supportsSubgrid(): boolean {
  return (
    typeof CSS !== 'undefined' &&
    typeof CSS.supports === 'function' &&
    CSS.supports('grid-template-columns', 'subgrid')
  );
}

/** Literal keys (no template) so the translation audit can see every one. */
export function dayPartLabel(
  t: (key: string) => string,
  part: 'morning' | 'midday' | 'evening' | 'bedtime'
): string {
  switch (part) {
    case 'morning':
      return t('addEvent.timeChips.morning');
    case 'midday':
      return t('addEvent.timeChips.midday');
    case 'evening':
      return t('addEvent.timeChips.evening');
    case 'bedtime':
      return t('addEvent.timeChips.bedtime');
  }
}

export function TimeChips({
  id,
  value,
  hourCycle,
  onChange,
  describedBy,
  other,
}: TimeChipsProps): ReactElement {
  const { t } = useTranslation('calendar');
  const chipTexts = MED_TIME_CHIPS.map((chip) => {
    const [h, m] = chip.time.split(':').map(Number);
    return { label: dayPartLabel(t, chip.id), time: formatTimeOfDay(h, m, hourCycle) };
  });
  const { ref, columns } = useFitColumns(
    TIME_CHIP_MAX_COLUMNS,
    [...chipTexts.map((c) => `${c.label}\u0002${c.time}`), `${other?.label ?? ''}\u0002${other?.time ?? ''}`].join(
      '\u0001'
    )
  );
  const subgrid = !!other && supportsSubgrid();
  const chipRows = Math.ceil(MED_TIME_CHIPS.length / columns);
  const otherCell = gridCellPlacement(MED_TIME_CHIPS.length, columns);
  const tracks = `repeat(${columns}, minmax(0, 1fr))`;
  // One line per label/time while there is more than one column (so an overflow is measurable and the
  // column count drops instead); at one column the text may wrap.
  const line = columns > 1 ? 'whitespace-nowrap' : '';
  const selected = chipForTime(value);
  const tabbable = selected ?? MED_TIME_CHIPS[0].id;

  function move(from: number, delta: number): void {
    const next = MED_TIME_CHIPS[(from + delta + MED_TIME_CHIPS.length) % MED_TIME_CHIPS.length];
    onChange(next.id, next.time);
    requestAnimationFrame(() =>
      document.getElementById(`${id}-${next.id}`)?.focus({ preventScroll: true })
    );
  }

  const groupStyle: CSSProperties = subgrid
    ? {
        gridColumn: '1 / -1',
        gridRow: `1 / span ${chipRows}`,
        gridTemplateColumns: 'subgrid',
        gridTemplateRows: 'subgrid',
      }
    : { gridTemplateColumns: tracks };

  const group = (
    <div
      ref={other ? undefined : ref}
      id={id}
      role="radiogroup"
      aria-label={t('addEvent.timeChips.label')}
      aria-describedby={describedBy}
      data-columns={columns}
      className={subgrid ? 'grid' : 'grid gap-2'}
      style={groupStyle}
    >
      {MED_TIME_CHIPS.map((chip, index) => {
        const on = selected === chip.id;
        return (
          <button
            key={chip.id}
            id={`${id}-${chip.id}`}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={tabbable === chip.id ? 0 : -1}
            data-fit-cell=""
            onClick={() => onChange(on ? null : chip.id, chip.time)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                event.preventDefault();
                move(index, 1);
              } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                event.preventDefault();
                move(index, -1);
              }
            }}
            className={`${TIME_CHIP_BOX} ${on ? CHIP_SELECTED : CHIP_UNSELECTED}`}
          >
            <span className={`max-w-full text-base font-semibold ${line}`}>{chipTexts[index].label}</span>
            <span className={`max-w-full text-sm ${line} ${on ? 'text-cream/80' : 'text-ink-2'}`}>
              {chipTexts[index].time}
            </span>
          </button>
        );
      })}
    </div>
  );

  if (!other) return group;

  const otherButton = (
    <button
      type="button"
      aria-expanded={other.expanded}
      data-fit-cell=""
      data-testid="time-chip-other"
      onClick={other.onClick}
      className={`${TIME_CHIP_BOX} ${other.selected ? CHIP_SELECTED : CHIP_UNSELECTED}`}
      style={subgrid ? { gridRow: otherCell.row, gridColumn: otherCell.column } : undefined}
    >
      <span className={`max-w-full text-base font-semibold ${line}`}>{other.label}</span>
      {other.time ? (
        <span
          className={`max-w-full text-sm ${line} ${other.selected ? 'text-cream/80' : 'text-ink-2'}`}
          data-testid="time-chip-other-time"
        >
          {other.time}
        </span>
      ) : null}
    </button>
  );

  return (
    <div
      ref={ref}
      data-testid="time-chip-grid"
      data-columns={columns}
      className={subgrid ? 'grid gap-2' : 'flex flex-col gap-2'}
      // 1fr rows: every row as tall as the tallest cell, so a one-line "Other time" alone on its row
      // keeps the two-line chips' height.
      style={subgrid ? { gridTemplateColumns: tracks, gridAutoRows: '1fr' } : undefined}
    >
      {group}
      {subgrid ? (
        otherButton
      ) : (
        // No subgrid (older browsers): "Other time" takes the next row, still in the same columns.
        <div className="grid gap-2" style={{ gridTemplateColumns: tracks }}>
          {otherButton}
        </div>
      )}
    </div>
  );
}
