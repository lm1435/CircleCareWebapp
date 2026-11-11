import { type ReactElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { MED_TIME_CHIPS, chipForTime, minutesOfDay, type MedTimeChipId } from '@/lib/medTimeOfDay';
import { formatTimeOfDay } from '@/utils/timezone';
import type { HourCycle } from '@/utils/hourCycle';
import {
  CHOICE_TILE_LABEL,
  DOSE_CHIP_BODY,
  DOSE_CHIP_BOX,
  DOSE_CHIP_REMOVE,
  choiceTileClass,
  choiceTileSubClass,
} from '@/components/ui/inputStyles';
import { Icon } from '@/components/ui/Icon';
import { PickerTile } from '@/components/ui/PickerTile';

// The medication form's "What time?" (owner 2026-11-10, build 11 "A2", mobile parity): TIME-FIRST chips, the
// time large (tabular numerals) and its day part small under it: "8:00 AM / Morning", "12:00 PM / Midday",
// "6:00 PM / Evening", "9:00 PM / Bedtime", then "Other…". Times are the CARE RECIPIENT's clock (the form converts
// them to the viewer's fields). A custom time chosen through "Other…" is its own chip in the same style
// ("2:30 PM / Other"), after the four. A CUSTOM chip (owner 2026-11-10, Fix13) is not a toggle: its body is the
// time picker that changes THAT dose's time in place, and a trailing "×" (its own 44px button, "Remove 2:30 PM
// dose") removes it. The presets toggle.
//
// MULTI-SELECT on a new medication (filled = chosen; each extra time is saved as its own medication, as
// "+ Another dose" did): the chips are checkboxes. An EDIT holds one dose (it cannot see its siblings), so there
// the chips are a radiogroup with one answer.
//
// LAYOUT (owner 1.4.0, mobile StackedChoice parity): ONE wrapping row of content-sized tiles; large text only
// wraps onto more lines. The group is `display: contents` so its chips and "Other…" share the one flex row
// while "Other…" stays OUTSIDE the group in the DOM.

export interface TimeChipsProps {
  id: string;
  /**
   * The RECIPIENT's HH:MM times chosen, one per dose slot: index 0 the medication's own time, then the extra doses
   * ('' entries ignored). A custom chip reports its slot.
   */
  values: readonly string[];
  hourCycle: HourCycle;
  /** Checkboxes (a new medication) or one answer (an edit). */
  multiple: boolean;
  /** A chip was tapped: its recipient HH:MM, the preset it is (null for a custom chip), and whether it was on. */
  onToggle: (time: string, chip: MedTimeChipId | null, wasOn: boolean) => void;
  /** No more times fit (the dose limit): the chips not chosen are shown, not offered. */
  full?: boolean;
  describedBy?: string;
  /** The trailing "Other…" control, drawn as the last tile of the row (outside the group). */
  other?: ReactNode;
  /** A custom chip's picker changed its dose (slot = index in `values`) to `next` (the recipient's clock). */
  onChangeCustom?: (slot: number, next: string) => void;
  /** A custom chip's "×": remove that dose. */
  onRemoveCustom?: (slot: number, time: string) => void;
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

/** The chip's two lines: the time leads (tabular numerals), the day part under it. */
export function TimeChipContent({
  time,
  label,
  on,
}: {
  time: string;
  label: string;
  on: boolean;
}): ReactElement {
  return (
    <>
      <span className={`${CHOICE_TILE_LABEL} tabular-nums`}>{time}</span>
      {/* A space between the lines: the name reads "8:00 AM Morning" in every accessibility tree. */}{' '}
      <span className={choiceTileSubClass(on)}>{label}</span>
    </>
  );
}

function display(hhmm: string, hourCycle: HourCycle): string {
  const [h, m] = hhmm.split(':').map(Number);
  return formatTimeOfDay(h, m, hourCycle);
}

export function TimeChips({
  id,
  values,
  hourCycle,
  multiple,
  onToggle,
  full = false,
  describedBy,
  other,
  onChangeCustom,
  onRemoveCustom,
}: TimeChipsProps): ReactElement {
  const { t } = useTranslation('calendar');
  const chosen = values.filter(Boolean).map((v) => v.slice(0, 5));
  // One chip per custom time (a repeated value is one chip), keyed by its dose SLOT so the chip, and a picker open
  // on it, survives its own time changing; in time order.
  const seen = new Set<string>();
  const customs = values
    .map((v, slot) => ({ slot, time: v.slice(0, 5) }))
    .filter(({ time }) => {
      if (!time || chipForTime(time) !== null || seen.has(time)) return false;
      seen.add(time);
      return true;
    })
    .sort((a, b) => (minutesOfDay(a.time) ?? 0) - (minutesOfDay(b.time) ?? 0));
  const chips = MED_TIME_CHIPS.map((chip) => ({
    key: chip.id as string,
    domId: `${id}-${chip.id}`,
    time: chip.time as string,
    chip: chip.id as MedTimeChipId | null,
    label: dayPartLabel(t, chip.id),
  }));
  const isOn = (time: string): boolean => chosen.includes(time);
  // Radio mode: one roving tab stop (the chosen chip, else the first).
  const tabbable = chips.find((c) => isOn(c.time))?.key ?? chips[0].key;

  function move(from: number, delta: number): void {
    const next = chips[(from + delta + chips.length) % chips.length];
    onToggle(next.time, next.chip, isOn(next.time));
    requestAnimationFrame(() => document.getElementById(next.domId)?.focus({ preventScroll: true }));
  }

  const group = (
    <div
      id={id}
      role={multiple ? 'group' : 'radiogroup'}
      aria-label={t('addEvent.timeChips.label')}
      aria-describedby={describedBy}
      className={other ? 'contents' : 'flex flex-wrap gap-2'}
    >
      {chips.map((chip, index) => {
        const on = isOn(chip.time);
        const off = full && !on;
        return (
          <button
            key={chip.key}
            id={chip.domId}
            type="button"
            role={multiple ? 'checkbox' : 'radio'}
            aria-checked={on}
            disabled={off}
            tabIndex={multiple ? undefined : tabbable === chip.key ? 0 : -1}
            onClick={() => onToggle(chip.time, chip.chip, on)}
            onKeyDown={
              multiple
                ? undefined
                : (event) => {
                    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                      event.preventDefault();
                      move(index, 1);
                    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                      event.preventDefault();
                      move(index, -1);
                    }
                  }
            }
            className={`${choiceTileClass(on)}${off ? ' cursor-default opacity-50' : ' cursor-pointer'}`}
          >
            <TimeChipContent time={display(chip.time, hourCycle)} label={chip.label} on={on} />
          </button>
        );
      })}
    </div>
  );

  const customChips = customs.map(({ slot, time }) => {
    const shown = display(time, hourCycle);
    return (
      <div
        key={`custom-${slot}`}
        data-testid="time-chip-custom-box"
        className={DOSE_CHIP_BOX}
      >
        <PickerTile
          kind="time"
          inputId={`${id}-custom-${slot}`}
          inputLabel={t('addEvent.simple.changeDoseTime', { time: shown })}
          testId="time-chip-custom"
          value={time}
          onChange={(next) => {
            if (next) onChangeCustom?.(slot, next);
          }}
          className={DOSE_CHIP_BODY}
        >
          <TimeChipContent time={shown} label={t('addEvent.timeChips.other')} on />
        </PickerTile>
        <button
          type="button"
          aria-label={t('addEvent.simple.removeDoseTime', { time: shown })}
          data-testid="time-chip-custom-remove"
          onClick={() => onRemoveCustom?.(slot, time)}
          className={DOSE_CHIP_REMOVE}
        >
          <Icon name="close-outline" size="row" />
        </button>
      </div>
    );
  });

  if (!other && customChips.length === 0) return group;
  return (
    <div data-testid="time-chip-row" className="flex flex-wrap gap-2">
      {group}
      {customChips}
      {other}
    </div>
  );
}
