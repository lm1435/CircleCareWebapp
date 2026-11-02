import { type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { MED_TIME_CHIPS, chipForTime, type MedTimeChipId } from '@/lib/medTimeOfDay';
import { formatTimeOfDay } from '@/utils/timezone';
import type { HourCycle } from '@/utils/hourCycle';
import { CHOICE_TILE_LABEL, choiceTileClass, choiceTileSubClass } from '@/components/ui/inputStyles';

// The four quick times under "When?" on the medication form (simple UI 1.3.1):
// Morning 8:00 AM, Midday 12:00 PM, Evening 6:00 PM, Bedtime 9:00 PM, on the CARE
// RECIPIENT's clock (mobile parity; the form converts them to the viewer's fields).
// "Other time" (it reveals the regular time field) is a button, not a radio, drawn as the
// SAME tile at the end of the same row: its label, and once a custom time is the answer,
// that time under it on the RECIPIENT's clock (one clock on the control).
//
// LAYOUT (owner 1.4.0, mobile StackedChoice parity): ONE wrapping row of content-sized tiles,
// always: never an equal-column grid and never a full-width list, whatever is selected and on
// add or edit alike. Large text only wraps onto more lines; a tile wider than the row wraps
// its own text. The radiogroup is `display: contents` so its radios and "Other time" share
// the one flex row while "Other time" stays OUTSIDE the radiogroup in the DOM (a radiogroup
// owns radios only). The group has a roving tab stop; the selected chip is the one whose
// time EXACTLY matches the recipient's clock for the form's time.

export interface TimeChipsProps {
  id: string;
  /** The RECIPIENT's HH:MM the form's time names ('' = unset), not the viewer-frame field. */
  value: string;
  hourCycle: HourCycle;
  /** Pick a chip (its recipient-frame HH:MM), or null when the selected chip is tapped again. */
  onChange: (chip: MedTimeChipId | null, time: string) => void;
  describedBy?: string;
  /** "Other time": the last tile of the row, same shape, a button that reveals the time field. */
  other?: TimeChipsOther;
}

export interface TimeChipsOther {
  label: string;
  /** The time field it reveals is open. */
  expanded: boolean;
  /** Lit like a selected chip: a custom (non-chip) time is the answer. */
  selected: boolean;
  /** That custom time on the RECIPIENT's clock, formatted: shown under the label as a chip shows its own. */
  time?: string;
  onClick: () => void;
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
  const selected = chipForTime(value);
  const tabbable = selected ?? MED_TIME_CHIPS[0].id;

  function move(from: number, delta: number): void {
    const next = MED_TIME_CHIPS[(from + delta + MED_TIME_CHIPS.length) % MED_TIME_CHIPS.length];
    onChange(next.id, next.time);
    requestAnimationFrame(() =>
      document.getElementById(`${id}-${next.id}`)?.focus({ preventScroll: true })
    );
  }

  const group = (
    <div
      id={id}
      role="radiogroup"
      aria-label={t('addEvent.timeChips.label')}
      aria-describedby={describedBy}
      // Alone: the wrapping row itself. With "Other time": its children join the outer row.
      className={other ? 'contents' : 'flex flex-wrap gap-2'}
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
            className={choiceTileClass(on)}
          >
            <span className={CHOICE_TILE_LABEL}>{chipTexts[index].label}</span>
            <span className={choiceTileSubClass(on)}>{chipTexts[index].time}</span>
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
      // Spoken like the mobile cell: "Other time, 7:15 AM" (the two lines run together otherwise).
      aria-label={other.time ? `${other.label}, ${other.time}` : undefined}
      data-testid="time-chip-other"
      onClick={other.onClick}
      className={choiceTileClass(other.selected)}
    >
      <span className={CHOICE_TILE_LABEL}>{other.label}</span>
      {other.time ? (
        <span className={choiceTileSubClass(other.selected)} data-testid="time-chip-other-time">
          {other.time}
        </span>
      ) : (
        // An empty second line (no width, no name): "Other time" alone is as tall as the two-line chips at
        // every text size, so a row it shares or a line it is alone on keeps their height.
        <span aria-hidden="true" className={`${choiceTileSubClass(false)} invisible`} data-testid="time-chip-other-spacer">
          {'\u00a0'}
        </span>
      )}
    </button>
  );

  return (
    <div data-testid="time-chip-row" className="flex flex-wrap gap-2">
      {group}
      {otherButton}
    </div>
  );
}
