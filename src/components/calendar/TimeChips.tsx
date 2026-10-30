import { type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { MED_TIME_CHIPS, chipForTime, type MedTimeChipId } from '@/lib/medTimeOfDay';
import { formatTimeOfDay } from '@/utils/timezone';
import { useChipColumns } from '@/lib/largeText';
import type { HourCycle } from '@/utils/hourCycle';
import { CHIP_SELECTED, CHIP_UNSELECTED } from '@/components/ui/inputStyles';

// The four quick times under "When?" on the new-medication form (simple UI 1.3.1):
// Morning 8:00 AM, Midday 12:00 PM, Evening 6:00 PM, Bedtime 9:00 PM. "Other time"
// is a separate quiet button beside the group (it reveals the regular time field).
// The group is a radiogroup with a roving tab stop; the selected chip is the one
// whose time EXACTLY matches the form's time. Large text / narrow containers go to
// one column (see lib/largeText).

export interface TimeChipsProps {
  id: string;
  /** The form's viewer-frame HH:MM ('' = unset). */
  value: string;
  hourCycle: HourCycle;
  /** Pick a chip (its HH:MM), or null when the selected chip is tapped again. */
  onChange: (chip: MedTimeChipId | null, time: string) => void;
  describedBy?: string;
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

const COLUMN_CLASS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  4: 'grid-cols-4',
};

export function TimeChips({
  id,
  value,
  hourCycle,
  onChange,
  describedBy,
}: TimeChipsProps): ReactElement {
  const { t } = useTranslation('calendar');
  const { ref, columns } = useChipColumns(MED_TIME_CHIPS.length);
  const selected = chipForTime(value);
  const tabbable = selected ?? MED_TIME_CHIPS[0].id;

  function move(from: number, delta: number): void {
    const next = MED_TIME_CHIPS[(from + delta + MED_TIME_CHIPS.length) % MED_TIME_CHIPS.length];
    onChange(next.id, next.time);
    requestAnimationFrame(() =>
      document.getElementById(`${id}-${next.id}`)?.focus({ preventScroll: true })
    );
  }

  return (
    <div
      ref={ref}
      id={id}
      role="radiogroup"
      aria-label={t('addEvent.timeChips.label')}
      aria-describedby={describedBy}
      data-columns={columns}
      className={`grid gap-2 ${COLUMN_CLASS[columns] ?? 'grid-cols-4'}`}
    >
      {MED_TIME_CHIPS.map((chip, index) => {
        const on = selected === chip.id;
        const [h, m] = chip.time.split(':').map(Number);
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
            className={`flex min-h-[56px] flex-col items-start justify-center gap-px rounded-2xl border px-3.5 py-2 text-left transition-colors duration-fast ${
              on ? CHIP_SELECTED : CHIP_UNSELECTED
            }`}
          >
            <span className="text-base font-semibold">{dayPartLabel(t, chip.id)}</span>
            <span className={`text-sm ${on ? 'text-cream/80' : 'text-ink-2'}`}>
              {formatTimeOfDay(h, m, hourCycle)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
